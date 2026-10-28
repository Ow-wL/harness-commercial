/**
 * 주의 요약 띠 (8-C1a, docs/UX_REDESIGN.md 2.2). 판단에 중요한 사실을 헤드라인 바로 아래에 항상 1줄씩 요약한다.
 * 설명은 기존 섹션(주의할 점·세부 분석·초보자 접근성 / 비교의 점수 비교·미산출·주의할 점)에 그대로 있고, 띠는 그 위의 요약이다.
 * 문장은 구조화 필드로 새로 만든다. 병목은 병목_지표·score 로만 — 엔진 병목 원문은 띠에 올리지 않는다(§8.3).
 * 순서: 학교구역(v0.5) → † → 병목 → 미산출 → 학교 → 신뢰도 → 기타 엔진 경고 (→ 비교: 같은 지역·반경 겹침). 최대 5줄, 넘치면 "N건 더 보기".
 * 학교구역(D-028): 엔진 v0.5 가 경고[0]에 넣는 "학교 주변 영업 규제 업종 + 200m 안 초·중·고" 경고를 맨 위에 요약한다.
 * 주의 안내이며 영업 가능 여부를 확정하지 않는다 — 원문은 주의할 점 섹션에 엔진 순서대로 그대로 있다.
 */
import type { AnalyzeResponse, EngineResult } from '../api/schemas.ts'
import type { CompareSide } from './compare.ts'
import { areaRelation, compareAppliedWeights, radiusOverlap, sharedPerspectives } from './compare.ts'
import { BOTTLENECK_WARN_BELOW, formatRadius, formatScore } from './format.ts'
import { displayWarnings, isSchoolZoneWarning } from './warnings.ts'

export const BAND_MAX = 5

/** 줄을 누르면 옮겨 갈 기존 섹션 */
export type BandTarget =
  | 'warnings'
  | 'details'
  | 'access'
  | 'compare-score'
  | 'compare-not-computed'
  | 'compare-warnings'

export type BandKind =
  | 'school-zone'
  | 'composition'
  | 'bottleneck'
  | 'not-computed'
  | 'school'
  | 'confidence'
  | 'other'
  | 'area'

export type BandLine = {
  kind: BandKind
  tone: 'warning' | 'info'
  /** 모양 아이콘: 경고 !, 정보 i, 계산 구성 차이 † */
  mark: '!' | 'i' | '†'
  text: string
  target: BandTarget
}

const ORDER: readonly BandKind[] = [
  'school-zone',
  'composition',
  'bottleneck',
  'not-computed',
  'school',
  'confidence',
  'other',
  'area',
]

/** 경쟁성 0곳(엔진이 일부러 점수를 내지 않음) */
const isVacantCompetition = (ind: EngineResult['지표'][number]) =>
  ind.key === 'competition' && (ind.raw as Readonly<Record<string, unknown>>).동종점포수 === 0

/** 띠가 이미 구조화 필드로 요약하는 엔진 경고 — '기타'로 다시 올리지 않는다 */
function coveredByBand(warning: string): boolean {
  return (
    warning.includes('병목') ||                         // 병목 원문·구조화 문장·가중치 안내 — 병목은 구조화 필드로만
    warning.startsWith('계산 불가 지표') ||               // 미산출 줄
    warning.startsWith('반경 내 동종업종이 0개') ||        // 경쟁성 0곳 미산출 줄
    warning.includes('학교 주변 입지 규제 업종') ||         // 학교 줄
    isSchoolZoneWarning(warning)                          // 학교구역 줄(v0.5)
  )
}

type Context = { side?: CompareSide; compare: boolean }

function linesOf(analysis: AnalyzeResponse, { side, compare }: Context): BandLine[] {
  const { result } = analysis
  const p = side ? `${side} ` : ''
  const t = (single: BandTarget, cmp: BandTarget) => (compare ? cmp : single)
  const lines: BandLine[] = []

  const zone = result.초보자_접근성.학교구역_200m_학교수
  if (zone !== undefined && result.경고.some(isSchoolZoneWarning)) {
    lines.push({
      kind: 'school-zone',
      tone: 'warning',
      mark: '!',
      text: compare
        ? `${p}학교 200m 안 초·중·고 ${zone}곳 · 학교 주변 영업 규제 업종`
        : `학교 200m 안 초·중·고 ${zone}곳 · 학교 주변 영업 규제 업종 — 점수와 별개로 영업 가능 여부를 먼저 확인하세요`,
      target: t('warnings', 'compare-warnings'),
    })
  }

  const bottleneck = result.지표.find((i) => i.key === result.종합.병목_지표)
  if (bottleneck?.score != null && bottleneck.score < BOTTLENECK_WARN_BELOW) {
    lines.push({
      kind: 'bottleneck',
      tone: 'warning',
      mark: '!',
      text: compare
        ? `${p}${bottleneck.label} ${formatScore(bottleneck.score)} · 병목`
        : `${bottleneck.label} ${formatScore(bottleneck.score)}점 · 병목 기준(${BOTTLENECK_WARN_BELOW}점 미만) — 종합과 별개 위험 요인`,
      target: t('warnings', 'compare-warnings'),
    })
  }

  for (const ind of result.지표) {
    if (ind.score !== null) continue
    const low = ind.confidence === 'low' ? ' · 자료 등급 낮음' : ''
    const text = isVacantCompetition(ind)
      ? `${p}반경 ${formatRadius(result.meta.분석반경_m)} 안 ${result.meta.업종} 0곳 · 경쟁성 미산출${low}`
      : `${p}${ind.label} 미산출 · 종합에서 제외${low}`
    lines.push({ kind: 'not-computed', tone: 'warning', mark: '!', text, target: t('details', 'compare-not-computed') })
  }

  const access = result.초보자_접근성
  const schools = access?.주변_학교?.학교수
  if (access && (access.입지_규제 || (schools ?? 0) > 0)) {
    lines.push(
      schools == null
        ? { kind: 'school', tone: 'info', mark: 'i', text: `${p}학교 주변 규제 업종 · 주변 학교 정보 없음`, target: t('access', 'compare-warnings') }
        : schools === 0
          ? { kind: 'school', tone: 'info', mark: 'i', text: `${p}학교 주변 규제 업종 · 300m 안 초·중·고 0곳`, target: t('access', 'compare-warnings') }
          : { kind: 'school', tone: 'warning', mark: '!', text: `${p}300m 안 초·중·고 ${schools}곳 · 교육지원청 확인 필요`, target: t('access', 'compare-warnings') },
    )
  }

  for (const ind of result.지표) {
    if (ind.confidence === 'low' && ind.score !== null) {
      // 원인을 적지 않는다 — 엔진 자료 등급(confidence)은 폴백·입력·coverage 를 합친 판정이라 응답만으로 원인을 가를 수 없다(2.2)
      lines.push({ kind: 'confidence', tone: 'warning', mark: '!', text: `${p}${ind.label} 자료 등급 낮음(엔진 판정)`, target: t('details', 'compare-warnings') })
    }
  }

  for (const w of displayWarnings(analysis)) {
    if (!coveredByBand(w)) {
      lines.push({ kind: 'other', tone: 'warning', mark: '!', text: `${p}${w}`, target: t('warnings', 'compare-warnings') })
    }
  }
  return lines
}

const byOrder = (lines: BandLine[]) =>
  [...lines].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind))   // 안정 정렬 — 같은 종류는 A, B 순

/** 단일 결과의 띠 줄 전체(잘라내기 전). 0줄이면 띠를 두지 않는다 */
export function singleBand(analysis: AnalyzeResponse): BandLine[] {
  return byOrder(linesOf(analysis, { compare: false }))
}

/** 비교 요약의 띠 줄 전체: † 계산 구성 차이 → A·B 위치별(같은 규칙, 접두 "A "·"B ") → 같은 지역·반경 겹침 */
export function compareBand(a: AnalyzeResponse, b: AnalyzeResponse): BandLine[] {
  const lines: BandLine[] = []
  const weights = compareAppliedWeights(a.result.종합, b.result.종합)
  if (weights.kind === 'different-perspectives') {
    const part = (r: EngineResult) => {
      const missing = r.지표.filter((i) => i.score === null).map((i) => i.label)
      const n = r.지표.length - missing.length
      return { n, missing: missing.length > 0 ? `(${missing.join('·')} 미산출)` : '' }
    }
    const pa = part(a.result)
    const pb = part(b.result)
    lines.push({
      kind: 'composition',
      tone: 'info',
      mark: '†',
      text: `종합 계산 구성이 다릅니다 · A ${pa.n}개 관점${pa.missing}, B ${pb.n}개${pb.missing}`,
      target: 'compare-score',
    })
  } else if (weights.kind === 'different-weights') {
    lines.push({ kind: 'composition', tone: 'info', mark: '†', text: '종합에 적용된 가중치가 다릅니다', target: 'compare-score' })
  }
  lines.push(...linesOf(a, { side: 'A', compare: true }), ...linesOf(b, { side: 'B', compare: true }))

  const relation = areaRelation(a.context, b.context)
  if (relation !== 'different-gu') {
    const shared = sharedPerspectives(a, b).map((s) => s.label)
    const where = relation === 'same-dong' ? '같은 행정동' : '같은 구'
    lines.push({
      kind: 'area',
      tone: 'info',
      mark: 'i',
      text: shared.length > 0 ? `${where} · ${shared.join('·')}은 같은 데이터` : where,
      target: 'compare-score',
    })
  }
  const overlap = radiusOverlap(a.context, b.context, a.result.meta.분석반경_m)
  if (overlap.overlaps) {
    lines.push({
      kind: 'area',
      tone: 'info',
      mark: 'i',
      text: `반경 겹침 · 직선거리 ${overlap.distanceM.toLocaleString('ko-KR')}m`,
      target: 'compare-score',
    })
  }
  return byOrder(lines)
}
