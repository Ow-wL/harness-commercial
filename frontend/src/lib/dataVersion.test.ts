import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyze } from '../api/client.ts'
import { fillDataDates, PERSPECTIVE_GUIDE } from '../content/scoreGuide.ts'
import fixture from '../fixtures/bupyeong-pcbang.json'
import { asOfFor, dataVersionLabel, dataVersionOf, formatAsOf, stampDataVersion } from './dataVersion.ts'
import { ResultCache } from './resultCache.ts'

const AS_OF = { shops: '2026-06-30', panel: '2026-08-31', market_panel: '2026-08', rent: '2026Q2' }

describe('데이터 버전 (9-C4, D-033)', () => {
  it('응답 객체에 버전을 붙이고 읽는다 — 헤더가 없으면 null', () => {
    const a = {}
    expect(stampDataVersion(a, '2026-06')).toBe(a)
    expect(dataVersionOf(a)).toBe('2026-06')
    expect(dataVersionOf(stampDataVersion({}, null))).toBeNull()
  })

  it('표기: "데이터 묶음 2026-06"(기준월이 아니라 묶음 이름, 12-19), 분기 "2026Q2" → "2026년 2분기", 날짜는 그대로', () => {
    expect(dataVersionLabel('2026-06')).toBe('데이터 묶음 2026-06')
    expect(formatAsOf('2026Q2')).toBe('2026년 2분기')
    expect(formatAsOf('2026-06-30')).toBe('2026-06-30')
  })

  it('기준일은 서버 메타가 있고 결과 버전과 같을 때만(결과 버전을 모르면 서버 메타)', () => {
    const info = { version: '2026-06', as_of: AS_OF }
    expect(asOfFor(info, '2026-06')).toBe(AS_OF)
    expect(asOfFor(info, null)).toBe(AS_OF)
    expect(asOfFor(info, '2026-09')).toBeNull()
    expect(asOfFor(null, '2026-06')).toBeNull()
  })

  it('API 클라이언트는 성공 응답 헤더 X-Data-Version 을 응답 객체에 붙인다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fixture), {
      status: 200, headers: { 'Content-Type': 'application/json', 'X-Data-Version': '2026-09' },
    })))
    const r = await analyze({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
    vi.unstubAllGlobals()
    expect(r.ok && dataVersionOf(r.data)).toBe('2026-09')
  })

  it('결과 캐시는 데이터 버전이 바뀌면 전체를 버린다(엔진버전과 같은 규칙)', () => {
    const cache = new ResultCache()
    const req = (lat: number) => ({ lat, lng: 126.7246, biz_code: 'R10406' })
    const resp = (version: string) => stampDataVersion(structuredClone(fixture) as never, version)
    cache.putAnalyze(req(37.1), resp('2026-06'))
    cache.putAnalyze(req(37.2), resp('2026-06'))
    expect(cache.sizeNow).toBe(2)
    expect(cache.dataVersion).toBe('2026-06')
    cache.putAnalyze(req(37.3), resp('2026-09'))
    expect(cache.sizeNow).toBe(1)
    expect(cache.get(req(37.1))).toBeUndefined()
    expect(cache.dataVersion).toBe('2026-09')
  })

  it('관점 설명의 사용 데이터 문장: 기준일을 채우고, 모르면 괄호·쉼표째 지운다', () => {
    const market = PERSPECTIVE_GUIDE.market.data
    expect(fillDataDates(market, AS_OF)).toContain('수도권 생활이동(KT, 2026-08)의')
    expect(fillDataDates(market, null)).toContain('수도권 생활이동(KT)의')
    const customer = PERSPECTIVE_GUIDE.customer.data
    expect(fillDataDates(customer, AS_OF)).toContain('성·연령별 인구(2026-08), SGIS 종사자·1인 가구(2024)')
    expect(fillDataDates(customer, null)).toContain('성·연령별 인구, SGIS 종사자·1인 가구(2024)')
    expect(fillDataDates(PERSPECTIVE_GUIDE.competition.data, AS_OF)).toContain('상가(상권)정보(2026-06-30)와')
    for (const g of Object.values(PERSPECTIVE_GUIDE)) expect(fillDataDates(g.data, null)).not.toMatch(/\{\w+\}/)
  })

  it('정적 날짜 제거: 데이터 출처 표·관점 설명 소스에 데이터 버전 역할의 기준일을 직접 쓰지 않는다', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), 'src', ...f.split('/')), 'utf-8')
    const sources = [read('components/DataSources.tsx'), read('content/scoreGuide.ts')]
    // 2026-06 데이터 버전의 역할 기준일(shops·panel·market_panel·stability·stations·schools·rent)
    for (const date of ['2026-06-30', '2026-08-31', '2026-08', '2026-05-07', '2026-09-29', '2024-12', '2026-03', '2026년 2분기']) {
      for (const src of sources) expect(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toContain(date)
    }
  })
})
