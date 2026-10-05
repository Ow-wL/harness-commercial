// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AnalyzeResponseSchema,
  BusinessCatalogSchema,
  EngineResultSchema,
  ErrorResponseSchema,
  USER_ERROR_CODES,
} from './schemas.ts'

// 루트 golden을 그 자리에서 읽는다 (frontend로 복사하지 않는다)
const GOLDEN_DIR = fileURLToPath(new URL('../../../tests/golden/v0.3/json/', import.meta.url))
const GOLDEN_COUNT = 29

const goldenFiles = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()

function readGolden(file: string): unknown {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf-8'))
}

/** 변형 테스트용 사본. 기준은 PC방(기본 가중치, 5개 관점 모두 점수 있음, 입지 규제 업종). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 계약을 일부러 깨뜨리는 변형이라 타입을 풀어 둔다
function pcBang(): any {
  return structuredClone(readGolden('full_PC방.json'))
}

const CONTEXT = {
  lat: 37.4894,
  lng: 126.7246,
  gu_code: '28237',
  gu_name: '부평구',
  dong_name: '부평1동',
  label: '부평구 부평1동',
  rent_area: null,
}

describe('EngineResultSchema — golden v0.3', () => {
  it(`golden JSON ${GOLDEN_COUNT}개를 모두 읽는다`, () => {
    expect(goldenFiles).toHaveLength(GOLDEN_COUNT)
  })

  it.each(goldenFiles)('%s 가 schema를 통과한다', (file) => {
    const parsed = EngineResultSchema.safeParse(readGolden(file))
    expect(parsed.success, parsed.error?.message).toBe(true)
  })

  it('파싱은 값을 바꾸지 않는다 (coercion·transform 없음)', () => {
    for (const file of goldenFiles) {
      const raw = readGolden(file)
      expect(EngineResultSchema.parse(raw)).toEqual(raw)
    }
  })
})

describe('EngineResultSchema — 계약 파손을 잡는다', () => {
  const mutations: [string, (r: ReturnType<typeof pcBang>) => void][] = [
    ['필수 필드 삭제 (meta.엔진버전)', (r) => delete r.meta.엔진버전],
    ['필수 필드 삭제 (종합.병목_지표)', (r) => delete r.종합.병목_지표],
    ['필수 필드 삭제 (지표 raw)', (r) => delete r.지표[1].raw],
    ['종합 점수를 문자열로', (r) => (r.종합.점수 = '64.1')],
    ['관점 score를 문자열로', (r) => (r.지표[0].score = '61.6')],
    ['세부지표 원시값을 문자열로', (r) => (r.지표[1].breakdown[0].원시값 = '5290')],
    ['알 수 없는 top-level 필드', (r) => (r.extra = 1)],
    ['알 수 없는 raw 필드', (r) => (r.지표[1].raw.새_지표 = 1)],
    ['알 수 없는 세부지표 필드', (r) => (r.지표[0].breakdown[0].비고 = '')],
    ['엔진 버전 변경', (r) => (r.meta.엔진버전 = 'mvp-0.4')],
    ['관점 순서 변경', (r) => r.지표.reverse()],
    ['관점 4개', (r) => r.지표.pop()],
    ['점수 범위 밖 (101)', (r) => (r.지표[0].score = 101)],
    ['score 결측인데 상태가 계산', (r) => (r.지표[0].breakdown[3].상태 = '계산')],
    ['score는 있는데 기여도 null', (r) => (r.지표[0].breakdown[0].기여도 = null)],
    ['알 수 없는 세부지표 key', (r) => (r.지표[0].breakdown[0].key = 'c1')],
    ['경고를 null로', (r) => (r.경고 = null)],
    ['초보자_접근성 null', (r) => (r.초보자_접근성 = null)],
    ['알 수 없는 관점 key의 적용 가중치', (r) => (r.종합.적용_가중치.price = 0.1)],
  ]

  it('변형 전 기준 fixture는 통과한다', () => {
    expect(EngineResultSchema.safeParse(pcBang()).success).toBe(true)
  })

  it.each(mutations)('%s → 실패', (_, mutate) => {
    const r = pcBang()
    mutate(r)
    expect(EngineResultSchema.safeParse(r).success).toBe(false)
  })
})

describe('EngineResultSchema — golden에 없지만 엔진 코드가 내는 형태', () => {
  it('중요도 사용: 중요도·하한_적용·기본가중치_종합점수 (scoring.analyze 종합)', () => {
    const r = pcBang()
    r.종합.가중치_출처 = '사용자(중요도 1~5)'
    r.종합.중요도 = { market: 5, customer: 3, competition: 3, location: 3, stability: 1 }
    r.종합.하한_적용 = ['stability']
    r.종합.기본가중치_종합점수 = 64.1
    expect(EngineResultSchema.safeParse(r).success).toBe(true)

    r.종합.중요도.market = 6
    expect(EngineResultSchema.safeParse(r).success).toBe(false)
  })

  it('동종점포 0개: 경쟁성 점수 없음 + 수요 백분위 raw (scoring.score_competition)', () => {
    const r = pcBang()
    r.지표[2] = {
      ...r.지표[2],
      score: null,
      raw: { 반경m: 500, 동종점포수: 0, 전체점포수: 120, 점포당_잠재수요: null, 해당지역_수요_백분위: 71.2 },
      confidence: 'low',
      coverage: 0,
      flags: ['미개척_동종점포_0개'],
      breakdown: [],
    }
    expect(EngineResultSchema.safeParse(r).success).toBe(true)

    r.지표[2].raw.동종점포수 = 3   // 0개 경로 raw에 동종점포가 있으면 계약 위반
    expect(EngineResultSchema.safeParse(r).success).toBe(false)
  })

  it('좌표 요청: 임대료 상권·임대료 null (rent_area = null)', () => {
    const r = pcBang()
    r.지표[4].raw.임대료_상권 = null
    r.지표[4].raw['임대료_천원_㎡'] = null
    expect(EngineResultSchema.safeParse(r).success).toBe(true)
  })

  it('점수 낸 관점이 없으면 종합 점수·최고·병목 null', () => {
    const r = pcBang()
    r.종합.점수 = null
    r.종합.최고_지표 = null
    r.종합.병목_지표 = null
    r.종합.적용_가중치 = {}
    expect(EngineResultSchema.safeParse(r).success).toBe(true)
  })
})

describe('AnalyzeResponseSchema', () => {
  it('context 7개 필드 + golden result를 통과한다', () => {
    const parsed = AnalyzeResponseSchema.safeParse({ context: CONTEXT, result: pcBang() })
    expect(parsed.success, parsed.error?.message).toBe(true)
  })

  it.each([
    ['context 필드 누락 (rent_area)', { context: { ...CONTEXT, rent_area: undefined }, result: pcBang() }],
    ['context 알 수 없는 필드', { context: { ...CONTEXT, dong_code: 'x' }, result: pcBang() }],
    ['좌표를 문자열로', { context: { ...CONTEXT, lat: '37.4894' }, result: pcBang() }],
    ['result 누락', { context: CONTEXT }],
    ['알 수 없는 top-level 필드', { context: CONTEXT, result: pcBang(), warm: true }],
  ])('%s → 실패', (_, data) => {
    expect(AnalyzeResponseSchema.safeParse(data).success).toBe(false)
  })
})

describe('ErrorResponseSchema (D-014)', () => {
  it.each(USER_ERROR_CODES)('422 %s 를 통과한다', (code) => {
    expect(ErrorResponseSchema.safeParse({ error: { code, message: '…' } }).success).toBe(true)
  })

  it('500 internal_error + request_id 를 통과한다', () => {
    const data = {
      error: { code: 'internal_error', message: '서버 내부 오류가 발생했습니다.', request_id: '3f2a'.repeat(8) },
    }
    expect(ErrorResponseSchema.safeParse(data).success).toBe(true)
  })

  it.each([
    ['internal_error에 request_id 없음', { error: { code: 'internal_error', message: 'x' } }],
    ['사용자 오류에 request_id', { error: { code: 'location_outside', message: 'x', request_id: 'a'.repeat(32) } }],
    ['알 수 없는 code', { error: { code: 'not_found', message: 'x' } }],
    ['message 누락', { error: { code: 'invalid_request' } }],
    ['FastAPI 기본 검증 오류 형태', { detail: [{ loc: ['body', 'lat'], msg: 'x', type: 'x' }] }],
  ])('%s → 실패', (_, data) => {
    expect(ErrorResponseSchema.safeParse(data).success).toBe(false)
  })
})

describe('BusinessCatalogSchema', () => {
  /** golden meta(업종코드·업종·업종그룹)로 만든 29개 업종 카탈로그 — backend business_catalog()와 같은 모양. */
  function catalogFromGolden() {
    const groups = new Map<string, { code: string; name: string; businesses: object[] }>()
    for (const file of goldenFiles) {
      const { meta } = EngineResultSchema.parse(readGolden(file))
      const group = groups.get(meta.업종그룹) ?? {
        code: meta.업종그룹,
        name: meta.업종그룹.split('_').slice(1).join('_'),
        businesses: [],
      }
      group.businesses.push({ code: meta.업종코드, name: meta.업종, group: meta.업종그룹 })
      groups.set(meta.업종그룹, group)
    }
    return { groups: [...groups.values()], total: GOLDEN_COUNT }
  }

  it('29개 업종·4개 그룹 카탈로그를 통과한다', () => {
    const data = catalogFromGolden()
    expect(data.groups).toHaveLength(4)
    const parsed = BusinessCatalogSchema.safeParse(data)
    expect(parsed.success, parsed.error?.message).toBe(true)
  })

  it.each([
    ['total 불일치', (c: ReturnType<typeof catalogFromGolden>) => (c.total = 30)],
    ['업종 group이 소속 그룹과 다름', (c: ReturnType<typeof catalogFromGolden>) =>
      ((c.groups[0]!.businesses[0] as { group: string }).group = c.groups[1]!.code)],
    ['알 수 없는 그룹 code', (c: ReturnType<typeof catalogFromGolden>) => (c.groups[0]!.code = 'E_기타')],
  ])('%s → 실패', (_, mutate) => {
    const c = catalogFromGolden()
    mutate(c)
    expect(BusinessCatalogSchema.safeParse(c).success).toBe(false)
  })
})
