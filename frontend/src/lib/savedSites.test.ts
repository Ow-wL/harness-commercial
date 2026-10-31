import { AnalyzeResponseSchema } from '../api/schemas.ts'
import fixture from '../fixtures/bupyeong-pcbang-v05.json'
import guwol from '../fixtures/compare-guwol-pcbang.json'
import songdo from '../fixtures/compare-songdo-pcbang.json'
import { stampDataVersion } from './dataVersion.ts'
import { RankResponseSchema } from '../api/schemas.ts'
import { isSite, rankSummary, readSavedSites, removeSite, SAVED_SITES_KEY, SAVED_SITES_MAX, saveSite, siteFrom, updateSiteMemo } from './savedSites.ts'

const bupyeong = stampDataVersion(AnalyzeResponseSchema.parse(fixture), '2026-06')
const req = { lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 500 }

beforeEach(() => window.localStorage.removeItem(SAVED_SITES_KEY))

describe('후보 보관함 (12-25, 계획 1-2) — 로컬 저장 최대 3곳, 스냅샷은 저장 당시 결과', () => {
  it('항목은 조건 + 저장 당시 스냅샷(엔진 값 그대로) + 데이터 묶음·엔진 + 빈 메모', () => {
    const site = siteFrom(req, bupyeong, new Date('2026-10-29T03:00:00Z'))
    expect(site.key).toBe('37.4894,126.7246,R10406,500')
    expect(site.savedAt).toBe('2026-10-29T03:00:00.000Z')
    expect(site.conditions).toEqual({ lat: 37.4894, lng: 126.7246, biz: 'R10406', bizName: 'PC방', radius: 500 })
    expect(site.snapshot.locationName).toBe('부평구 부평1동')
    expect(site.snapshot.overall).toBe(bupyeong.result.종합.점수)
    expect(site.snapshot.perspectives.map((p) => p.label)).toEqual(['시장성', '고객성', '경쟁성', '입지성', '안정성'])
    expect(site.snapshot.stores).toBe(12)
    expect(site.snapshot.gaps).toHaveLength(4)
    expect(site.versions).toEqual({ data: '2026-06', engine: bupyeong.result.meta.엔진버전 })   // 팀 v0.5 fixture 는 mvp-0.5
    expect(site.memo).toBe('')
  })

  it('저장·읽기, 같은 조건은 스냅샷만 갱신(id·메모 유지), 가득 차면 거절, 삭제', () => {
    const a = siteFrom(req, bupyeong)
    let r = saveSite([], a)
    expect(r).toMatchObject({ ok: true, updated: false })
    let sites = (r as { sites: typeof a[] }).sites
    sites = updateSiteMemo(sites, a.id, '역 앞 상가')
    expect(readSavedSites()[0]).toMatchObject({ id: a.id, memo: '역 앞 상가' })

    // 같은 조건 다시 저장 → 갱신(새 저장 시각·스냅샷), id·메모 유지
    const again = siteFrom(req, bupyeong, new Date('2027-01-01T00:00:00Z'))
    r = saveSite(sites, again)
    expect(r).toMatchObject({ ok: true, updated: true })
    sites = (r as { sites: typeof a[] }).sites
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ id: a.id, memo: '역 앞 상가', savedAt: '2027-01-01T00:00:00.000Z' })

    const b = siteFrom({ lat: 37.4475, lng: 126.7015, biz_code: 'R10406' }, AnalyzeResponseSchema.parse(guwol))
    const c = siteFrom({ lat: 37.3925, lng: 126.639, biz_code: 'R10406' }, AnalyzeResponseSchema.parse(songdo))
    sites = (saveSite(sites, b) as { sites: typeof a[] }).sites
    sites = (saveSite(sites, c) as { sites: typeof a[] }).sites
    expect(sites.map((s) => s.snapshot.locationName)).toEqual(['연수구 송도2동', '남동구 구월3동', '부평구 부평1동'])   // 최근 저장이 앞
    expect(sites).toHaveLength(SAVED_SITES_MAX)
    const d = siteFrom({ lat: 37.5, lng: 126.7, biz_code: 'R10406' }, bupyeong)
    expect(saveSite(sites, d)).toEqual({ ok: false, reason: 'full' })
    expect(readSavedSites()).toHaveLength(3)

    expect(removeSite(sites, b.id).map((s) => s.id)).toEqual([c.id, a.id])
    expect(readSavedSites().map((s) => s.id)).toEqual([c.id, a.id])
  })

  it('깨진 저장값·형식이 다른 항목은 버리고, 3개까지만 읽는다', () => {
    window.localStorage.setItem(SAVED_SITES_KEY, 'nope')
    expect(readSavedSites()).toEqual([])
    const good = siteFrom(req, bupyeong)
    window.localStorage.setItem(SAVED_SITES_KEY, JSON.stringify([{ id: 'x' }, good, { ...good, id: 'g2' }, { ...good, id: 'g3' }, { ...good, id: 'g4' }]))
    expect(readSavedSites().map((s) => s.id)).toEqual([good.id, 'g2', 'g3'])
  })

  it('손상·부분 항목은 필드 하나만 어긋나도 버린다 — 관점 원소 null·점수 누락·점포 수 누락·좌표 범위 밖·버전 없음 (12-28-R4, Codex 재현)', () => {
    const good = siteFrom(req, bupyeong)
    expect(isSite(good)).toBe(true)
    const broken: Record<string, unknown>[] = [
      { ...good, snapshot: { ...good.snapshot, perspectives: [null] } },
      { ...good, snapshot: { ...good.snapshot, perspectives: [{ key: 'market' }] } },
      { ...good, snapshot: { locationName: '부평구 부평1동', perspectives: [], gaps: [] } },      // overall·stores 누락(Codex 사례)
      { ...good, snapshot: { ...good.snapshot, overall: 'high' } },
      { ...good, snapshot: { ...good.snapshot, stores: null } },
      { ...good, snapshot: { ...good.snapshot, gaps: [1] } },
      { ...good, conditions: { ...good.conditions, lat: 95 } },
      { ...good, conditions: { ...good.conditions, lat: Number.NaN } },
      { ...good, conditions: { ...good.conditions, radius: 0 } },
      { ...good, versions: { engine: 'mvp-0.5.1' } },
      { ...good, versions: null },
      { ...good, memo: 3 },
      { ...good, conditions: [] },
    ]
    for (const b of broken) expect(isSite(b), JSON.stringify(b).slice(0, 80)).toBe(false)
    window.localStorage.setItem(SAVED_SITES_KEY, JSON.stringify([broken[0], good, broken[2]]))
    expect(readSavedSites().map((s) => s.id)).toEqual([good.id])
    // null 점수(미산출)·null 반경(서버 기본)·null 데이터 묶음은 정상
    const nullish = {
      ...good,
      snapshot: { ...good.snapshot, overall: null, perspectives: [{ key: 'market', label: '시장성', score: null }] },
      conditions: { ...good.conditions, radius: null },
      versions: { data: null, engine: 'mvp-0.3' },
    }
    expect(isSite(nullish)).toBe(true)
  })

  it('저장소가 막혀 있으면 storage 사유로 거절한다', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(saveSite([], siteFrom(req, bupyeong))).toEqual({ ok: false, reason: 'storage' })
    setItem.mockRestore()
  })
})

describe('보관함 스냅샷의 R1 카드 (13-21) — 한 줄 결론·규제·업종 순위 요약, 선택 필드라 예전 항목도 그대로', () => {
  const item = (biz_code: string, name: string, overall: number | null) => ({
    biz_code, name, group: '목적방문형', overall, weakest: null, coverage: 1, regulated: false, warnings: 0,
  })
  const RANK = RankResponseSchema.parse({
    lat: 37.4894, lng: 126.7246, radius_m: 500, gu_name: '부평구', dong_name: '부평1동', count: 5, engine_version: 'mvp-0.5',
    items: [item('R10404', '노래방', 72.3), item('P10501', '독서실/스터디 카페', 72.1), item('R10402', '당구장', 71.1), item('I21201', '카페', 69.7), item('R10406', 'PC방', 62.3)],
  })

  it('저장 당시 한 줄 결론·규제 여부·순위 상위 3과 지금 업종 자리(5개 중 5위)를 담는다', () => {
    const site = siteFrom(req, bupyeong, new Date(), RANK)
    expect(site.snapshot.conclusion).toMatch(/자리예요|자리예요\(|편이에요/)
    expect(site.snapshot.regulated).toBe(false)
    expect(site.snapshot.rank).toEqual({ top: [{ name: '노래방', overall: 72.3 }, { name: '독서실/스터디 카페', overall: 72.1 }, { name: '당구장', overall: 71.1 }], current: 5, count: 5 })
    expect(isSite(site)).toBe(true)
  })

  it('다른 좌표·반경의 순위나 순위가 없으면 rank 를 넣지 않는다', () => {
    expect(rankSummary(RANK, { ...req, radius_m: 300 })).toBeUndefined()
    expect(rankSummary(RANK, { ...req, lat: 37.5 })).toBeUndefined()
    expect(rankSummary(null, req)).toBeUndefined()
    expect(siteFrom(req, bupyeong).snapshot.rank).toBeUndefined()
    expect(rankSummary({ ...RANK, items: RANK.items.slice(0, 2) }, req)?.current).toBeNull()       // 지금 업종이 목록에 없으면 자리 null
  })

  it('예전 항목(새 필드 없음)은 그대로 읽히고, 새 필드가 깨졌으면 그 항목만 버린다', () => {
    const site = siteFrom(req, bupyeong, new Date(), RANK)
    const oldSnap: typeof site.snapshot = { ...site.snapshot }
    delete oldSnap.conclusion
    delete oldSnap.regulated
    delete oldSnap.rank
    const old = { ...site, id: 'old', snapshot: oldSnap }
    expect(isSite(old)).toBe(true)
    expect(isSite({ ...site, snapshot: { ...site.snapshot, conclusion: 3 } })).toBe(false)
    expect(isSite({ ...site, snapshot: { ...site.snapshot, regulated: 'yes' } })).toBe(false)
    expect(isSite({ ...site, snapshot: { ...site.snapshot, rank: { top: [{ name: '노래방' }], current: 1, count: 29 } } })).toBe(false)
    expect(isSite({ ...site, snapshot: { ...site.snapshot, rank: { top: [], current: '1', count: 29 } } })).toBe(false)
    window.localStorage.setItem(SAVED_SITES_KEY, JSON.stringify([old, { ...site, id: 'bad', snapshot: { ...site.snapshot, regulated: 1 } }]))
    expect(readSavedSites().map((x) => x.id)).toEqual(['old'])
  })
})
