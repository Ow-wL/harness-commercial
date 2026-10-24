/**
 * 두 위치 비교(5차) 표시 규칙 (docs/COMPARE_DESIGN.md 5장). 엔진·API 값은 다시 계산하지 않는다.
 * 여기서 만드는 값은 모두 표시용이다: 점수 차이·반경 겹침 거리는 점수에 쓰이지 않는다.
 */
import { PERSPECTIVE_KEYS, type AnalyzeContext, type AnalyzeResponse, type EngineResult } from '../api/schemas.ts'
import { formatRadius, notComputedText, type Indicator } from './format.ts'

type PerspectiveKey = (typeof PERSPECTIVE_KEYS)[number]
type Summary = EngineResult['종합']
export type CompareSide = 'A' | 'B'

/** 엔진 관점 순서대로 라벨 (지표 배열은 항상 이 순서, schema tuple) */
function labelOf(result: EngineResult, key: PerspectiveKey): string {
  return result.지표.find((i) => i.key === key)!.label
}

// ─── 표시용 점수 차이 (A−B) ───────────────────────────────────────────

export type ScoreDiff = {
  /** A − B, 소수 1자리. -0은 0 */
  value: number
  /** 화면 표기: "+6.7", "−7.1"(U+2212), "0.0" */
  text: string
  /** 스크린리더용 (U+2212를 "마이너스"로 읽지 않을 수 있어서 말로 쓴다) */
  spoken: string
}

/**
 * 표시용 차이 A−B (§5.2). 두 점수가 모두 있을 때만 계산하고, 하나라도 미산출(null)이면 null.
 * 순위·우열이 아니라 두 엔진 점수(소수 1자리)를 뺀 값이다. ×10 정수로 빼서 부동소수 오차(30.2−24.4=5.799…)를 없앤다.
 */
export function displayScoreDiff(a: number | null, b: number | null): ScoreDiff | null {
  if (a === null || b === null) return null
  const value = Math.round(a * 10 - b * 10) / 10 + 0   // + 0: -0 → 0
  const abs = Math.abs(value).toFixed(1)
  if (value > 0) return { value, text: `+${abs}`, spoken: `A에서 B를 뺀 값 플러스 ${abs}` }
  if (value < 0) return { value, text: `−${abs}`, spoken: `A에서 B를 뺀 값 마이너스 ${abs}` }
  return { value, text: '0.0', spoken: 'A에서 B를 뺀 값 0.0' }
}

// ─── 같은 구·동 ──────────────────────────────────────────────────────

export type AreaRelation = 'same-dong' | 'same-gu' | 'different-gu'

/** context의 시군구 코드·행정동 이름으로만 판단한다 (점수가 같은지로 추측하지 않는다, §5.3) */
export function areaRelation(a: AnalyzeContext, b: AnalyzeContext): AreaRelation {
  if (a.gu_code !== b.gu_code) return 'different-gu'
  return a.dong_name === b.dong_name ? 'same-dong' : 'same-gu'
}

/**
 * 분석 지점 값의 공간 단위 (docs/SCORE_EXPLANATION_AUDIT.md 4장). 같은 구면 시장성·안정성,
 * 같은 동이면 고객성까지 두 위치가 같은 값을 쓴다. 경쟁성(반경)·입지성(좌표)은 위치마다 다르다.
 * 엔진 v0.5(D-028)는 고객성 인구도 지점 반경 값(raw.인구_기준 "반경 …")이라 같은 동이어도 같은 값이 아니다 → radiusCustomer.
 */
const SHARED_BY: Record<'gu' | 'dong', readonly PerspectiveKey[]> = {
  gu: ['market', 'stability'],
  dong: ['customer'],
}

export type SharedPerspective = { key: PerspectiveKey; label: string; unit: '구' | '행정동' }

/** 고객성 인구가 지점 반경 값인 응답(엔진 v0.5)인지 — 같은 행정동이어도 고객성이 달라진다 */
const radiusCustomer = (r: AnalyzeResponse) => (r.result.지표[1].raw.인구_기준 ?? '').startsWith('반경')

/** 같은 구·동이라 두 위치 점수가 구조적으로 같은 관점. 한쪽이라도 미산출이면 넣지 않는다 */
export function sharedPerspectives(a: AnalyzeResponse, b: AnalyzeResponse): SharedPerspective[] {
  const relation = areaRelation(a.context, b.context)
  if (relation === 'different-gu') return []
  const sameDong = relation === 'same-dong' && !radiusCustomer(a) && !radiusCustomer(b)
  const units: [PerspectiveKey, '구' | '행정동'][] = [
    ...SHARED_BY.gu.map((k): [PerspectiveKey, '구'] => [k, '구']),
    ...(sameDong ? SHARED_BY.dong.map((k): [PerspectiveKey, '행정동'] => [k, '행정동']) : []),
  ]
  return PERSPECTIVE_KEYS.flatMap((key) => {
    const unit = units.find(([k]) => k === key)?.[1]
    if (!unit) return []
    const ia = a.result.지표.find((i) => i.key === key)!
    const ib = b.result.지표.find((i) => i.key === key)!
    return ia.score === null || ib.score === null ? [] : [{ key, label: ia.label, unit }]
  })
}

/** 같은 구·동 안내 한 단락 (§5.3). 다른 구면 null. 관점 라벨은 모두 받침 있는 "…성"이라 조사는 "은" */
export function sameAreaNotice(a: AnalyzeResponse, b: AnalyzeResponse): string | null {
  const relation = areaRelation(a.context, b.context)
  if (relation === 'different-gu') return null
  const shared = sharedPerspectives(a, b)
  const byUnit = (unit: '구' | '행정동') =>
    shared.filter((s) => s.unit === unit).map((s) => s.label).join('·')
  const parts = [byUnit('구') && `${byUnit('구')}은 구 단위`, byUnit('행정동') && `${byUnit('행정동')}은 행정동 단위`]
    .filter(Boolean)
    .join(', ')
  const where =
    relation === 'same-dong'
      ? `두 위치가 같은 행정동(${a.context.gu_name} ${a.context.dong_name})에 있습니다.`
      : `두 위치가 같은 구(${a.context.gu_name})에 있습니다.`
  const same = parts ? ` ${parts} 데이터라 두 위치 점수가 같습니다.` : ''
  // 반경은 응답의 분석 반경(8-D3 이후 300·500·1,000m) — 고정값을 쓰지 않는다
  const radius = formatRadius(a.result.meta.분석반경_m)
  const differs =
    relation !== 'same-dong'
      ? ''
      : radiusCustomer(a) || radiusCustomer(b)
        ? ` 이 비교에서 위치 차이는 고객성·경쟁성(반경 ${radius})과 입지성(좌표)에 나타납니다.`
        : ` 이 비교에서 위치 차이는 경쟁성(반경 ${radius})과 입지성(좌표)에만 나타납니다.`
  return where + same + differs
}

// ─── 반경 겹침 ───────────────────────────────────────────────────────

type Point = { lat: number; lng: number }

/** 직선거리(m). 엔진 radius_demand.haversine_m과 같은 식(R = 6,371,000m). 표시용 */
export function straightDistanceM(a: Point, b: Point): number {
  const R = 6_371_000
  const rad = (d: number) => (d * Math.PI) / 180
  const h =
    Math.sin((rad(b.lat) - rad(a.lat)) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * 두 분석 반경 원이 겹치는지 (§5.3, D8). 중심 거리 < 2 × 반경이면 겹친다(딱 2 × 반경이면 맞닿을 뿐).
 * distanceM은 표시용 반올림(m). 판정은 반올림 전 거리로 한다.
 */
export function radiusOverlap(a: Point, b: Point, radiusM: number): { distanceM: number; overlaps: boolean } {
  const d = straightDistanceM(a, b)
  return { distanceM: Math.round(d), overlaps: d < 2 * radiusM }
}

// ─── 적용 가중치 (종합 계산 구성) ─────────────────────────────────────

export type WeightComparison =
  | { kind: 'same' }
  /** 종합에 쓰인 관점이 다르다 (미산출 관점이 다름) */
  | { kind: 'different-perspectives'; a: PerspectiveKey[]; b: PerspectiveKey[] }
  /** 같은 관점이지만 적용 가중치 값이 다르다 */
  | { kind: 'different-weights'; perspectives: PerspectiveKey[] }

/** 종합.적용_가중치의 키 = 종합에 쓰인 관점(엔진이 미산출 관점을 빼고 재정규화). 엔진 관점 순서로 돌려준다 */
function usedPerspectives(summary: Summary): PerspectiveKey[] {
  return PERSPECTIVE_KEYS.filter((k) => summary.적용_가중치[k] !== undefined)
}

export function compareAppliedWeights(a: Summary, b: Summary): WeightComparison {
  const ka = usedPerspectives(a)
  const kb = usedPerspectives(b)
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) {
    return { kind: 'different-perspectives', a: ka, b: kb }
  }
  return ka.every((k) => a.적용_가중치[k] === b.적용_가중치[k])
    ? { kind: 'same' }
    : { kind: 'different-weights', perspectives: ka }
}

/**
 * 두 종합 점수의 계산 구성이 다를 때의 안내 (§5.4). 같으면 null.
 * null이 아니면 종합 행 차이에 주의 표시(†)를 붙이고 이 문장을 각주로 연결한다.
 */
export function overallCompositionNotice(a: EngineResult, b: EngineResult): string | null {
  const cmp = compareAppliedWeights(a.종합, b.종합)
  const caution = '종합 점수 차이는 같은 기준끼리의 차이가 아닙니다.'
  switch (cmp.kind) {
    case 'same':
      return null
    case 'different-weights':
      return `두 종합 점수에 적용된 가중치가 다릅니다. ${caution}`
    case 'different-perspectives': {
      const list = (r: EngineResult, keys: PerspectiveKey[]) =>
        `${keys.map((k) => labelOf(r, k)).join('·')} ${keys.length}개 관점`
      return (
        `두 종합 점수의 계산 구성이 다릅니다. A는 ${list(a, cmp.a)}, B는 ${list(b, cmp.b)}의 가중평균입니다` +
        `(미산출 관점은 빼고 나머지 가중치를 다시 나눴습니다). ${caution}`
      )
    }
  }
}

// ─── 미산출 안내 ─────────────────────────────────────────────────────

/** 경쟁성 raw가 "반경 안 동종 점포 0곳" 형태인지 (schema competitionVacantRawSchema) */
function isVacantCompetition(ind: Indicator): boolean {
  return ind.key === 'competition' && (ind.raw as Readonly<Record<string, unknown>>).동종점포수 === 0
}

/**
 * 위치 하나의 미산출 관점 안내 (§5.4). 특정 관점을 가정하지 않고 실제 score === null인 관점마다 한 줄.
 * 경쟁성 0곳은 엔진이 일부러 점수를 내지 않은 경우라 충족률 문구 대신 0곳 이유를 쓴다.
 */
export function notComputedNotices(side: CompareSide, analysis: AnalyzeResponse): string[] {
  const { context, result } = analysis
  return result.지표
    .filter((ind) => ind.score === null)
    .map((ind) => {
      const reason = isVacantCompetition(ind)
        ? `반경 ${result.meta.분석반경_m}m 안에 같은 업종 점포가 없어 점수를 내지 않았고, 종합점수에서 제외했습니다`
        : notComputedText(ind)
      return `${side} ${context.gu_name} ${context.dong_name}: ${ind.label} 미산출 — ${reason}`
    })
}

// ─── 핵심 원시값 ─────────────────────────────────────────────────────

/**
 * 원시값 칸 상태 (§5.6). 응답에 키가 없으면 'absent'("해당 없음") — 0이나 정상 값으로 다루지 않는다.
 * 경쟁성 raw는 동종 점포 0곳이면 다른 형태라(동종업종_비중 등 키 없음) 이 구분이 필요하다.
 */
export type RawCell = { status: 'value'; text: string } | { status: 'null' } | { status: 'absent' }

export function rawCellText(cell: RawCell): string {
  return cell.status === 'value' ? cell.text : cell.status === 'null' ? '데이터 없음' : '해당 없음'
}

export type RawRow = { perspective: PerspectiveKey; label: string; read: (raw: Readonly<Record<string, unknown>>) => RawCell }

const people = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}명`       // 인원: 표시 단위 정수
const percent1 = (v: number) => `${(v * 100).toFixed(1)}%`                          // 0~1 비율 → 소수 1자리 %
const plain = (v: number) => String(v)                                               // 엔진 값 그대로

function field(name: string, format: (v: number) => string) {
  return (raw: Readonly<Record<string, unknown>>): RawCell => {
    if (!Object.hasOwn(raw, name)) return { status: 'absent' }
    const v = raw[name]
    if (v === null || v === undefined) return { status: 'null' }
    return typeof v === 'number' ? { status: 'value', text: format(v) } : { status: 'value', text: String(v) }
  }
}

/** 최근접역 + 직선거리 (format.nearestStation과 같은 표기: 엔진은 "역"을 떼어 둔다) */
function station(raw: Readonly<Record<string, unknown>>): RawCell {
  if (!Object.hasOwn(raw, '최근접역') || !Object.hasOwn(raw, '최근접역_거리m')) return { status: 'absent' }
  const name = raw.최근접역
  const m = raw.최근접역_거리m
  if (typeof name !== 'string' || typeof m !== 'number') return { status: 'null' }
  return { status: 'value', text: `${name}역 · 직선거리 ${m.toLocaleString('ko-KR')}m` }
}

/** 관점별 대표 원시값 (§5.6). 차이 열은 두지 않는다(D10) */
export const RAW_ROWS: readonly RawRow[] = [
  { perspective: 'market', label: '일평균 유입인구', read: field('일평균_유입인구', people) },
  { perspective: 'market', label: '시간대 적합도 (1.0 = 24시간 균등 기준)', read: field('시간대_적합도', plain) },
  { perspective: 'market', label: '상권 성격 적합도', read: field('상권성격_적합도', plain) },
  { perspective: 'customer', label: '타겟 연령 거주인구', read: field('타겟연령_거주인구', people) },
  { perspective: 'customer', label: '타겟 연령 비중', read: field('타겟연령_비중', percent1) },
  { perspective: 'customer', label: '종사자 수', read: field('종사자수', people) },
  { perspective: 'customer', label: '1인 세대 비중', read: field('1인세대_비중', percent1) },
  { perspective: 'competition', label: '반경 안 같은 업종 점포 수', read: field('동종점포수', (v) => `${v.toLocaleString('ko-KR')}곳`) },
  { perspective: 'competition', label: '점포당 잠재수요', read: field('점포당_잠재수요', people) },
  { perspective: 'competition', label: '같은 업종 비중', read: field('동종업종_비중', percent1) },
  { perspective: 'location', label: '가장 가까운 역', read: station },
  { perspective: 'location', label: '역세권 강도', read: field('역세권_강도', plain) },
  { perspective: 'location', label: '유인시설 근접도', read: field('유인시설_근접도', plain) },
  { perspective: 'stability', label: '3년 생존율', read: field('3년_생존율', percent1) },
  { perspective: 'stability', label: '최근 폐업률', read: field('최근_폐업률', percent1) },
  { perspective: 'stability', label: '평균 업력', read: field('평균_업력_년', (v) => `${v}년`) },
]

/** 원시값 한 칸: 해당 관점의 raw에서 읽는다 */
export function rawCell(result: EngineResult, row: RawRow): RawCell {
  const ind = result.지표.find((i) => i.key === row.perspective)!
  return row.read(ind.raw as Readonly<Record<string, unknown>>)
}

/** 분석 지점 값의 단위 (§5.2 해상도 열). 반경은 meta.분석반경_m */
export function perspectiveUnit(key: PerspectiveKey, radiusM: number): string {
  const units: Record<PerspectiveKey, string> = {
    market: '구',
    customer: '행정동',
    competition: `반경 ${radiusM.toLocaleString('ko-KR')}m`,
    location: '좌표',
    stability: '구 × 업종',
  }
  return units[key]
}
