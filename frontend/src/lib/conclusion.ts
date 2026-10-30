/**
 * 한 줄 결론 (13-12, 팀 점검 보고서 B1 — 2026-10-30): 강점 = 산출된 관점 중 최고점, 약점 = 최저점. LLM 없이 템플릿으로 만든다.
 * 규칙(보고서 5장 그대로):
 *   약점 < 25            → "{강점}은 좋지만, {약점 이유}로 {약점}이 매우 낮아요."
 *   강점 ≥ 70 · 약점 < 40 → "{강점 쉬운말}은 좋지만, {약점 쉬운말}이 약한 자리예요."
 *   모든 관점 40~70       → "전반적으로 무난한 자리예요. 특별히 강하거나 약한 관점이 없어요."
 *   그 밖                 → "{강점 쉬운말}이 가장 좋은 자리예요."
 * 쉬운말은 content/conclusion.ts 표(근거 숫자는 엔진 raw 인용). "높다/낮다"는 그 위치 안 관점끼리의 비교 — 순위·확률·추천을 말하지 않는다.
 * R2 의 AI 요약은 이 문장을 대체·보강하는 자리다(문장 자체는 그대로 둔다).
 */
import type { AnalyzeResponse, PerspectiveKey } from '../api/schemas.ts'
import { EASY_WORDS, type EasyWords } from '../content/conclusion.ts'
import { formatRadius, formatScore, type Indicator } from './format.ts'
import { GRADE_FLOOR } from './grade.ts'

export type Conclusion = {
  text: string
  strongest: { key: PerspectiveKey; label: string; score: number } | null
  weakest: { key: PerspectiveKey; label: string; score: number } | null
  /** 어느 규칙으로 만들었는지(테스트·AI 요약 입력용) */
  rule: 'weak-alert' | 'strong-weak' | 'flat' | 'strong-only' | 'none' | 'single'
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const fmt = (v: number) => Math.round(v).toLocaleString('ko-KR')

/** 쉬운말 표의 {자리}를 엔진 raw 숫자로 채운다. 숫자가 없으면 숫자 없는 문구 */
function easy(words: EasyWords, ind: Indicator, side: 'strong' | 'weak', ctx: { business: string; radiusM: number }): string {
  const raw = ind.raw as Readonly<Record<string, unknown>>
  const base = words[side]
  if (side === 'strong') return base
  switch (ind.key) {
    case 'customer': {
      const pop = n(raw.타겟연령_거주인구)                         // v0.5: 반경 면적 배분, v0.3·v0.4: 행정동 전체(인구_기준 참고)
      return pop === null ? base : `${base}(타겟 인구 ${fmt(pop)}명)`
    }
    case 'competition': {
      const cnt = n(raw.동종점포수)
      return cnt === null ? `${ctx.business}이(가) 이미 많은` : `${ctx.business}이(가) 이미 많은(반경 ${formatRadius(ctx.radiusM)} ${fmt(cnt)}곳)`
    }
    case 'location': {
      const d = n(raw.최근접역_거리m)
      return d === null ? base : `${base}(최근접역 ${fmt(d)}m)`
    }
    case 'stability': {
      const s = n(raw['3년_생존율'])                              // 비율(0~1)
      return s === null ? base : `${base}(3년 생존율 ${Math.round(s * 100)}%)`
    }
    default:
      return base
  }
}

export function conclusion({ result }: AnalyzeResponse): Conclusion {
  const scored = result.지표.filter((i): i is Indicator & { score: number } => i.score !== null)
  const ctx = { business: result.meta.업종, radiusM: result.meta.분석반경_m }
  if (result.종합.점수 === null || scored.length === 0) {
    return { text: '산출한 관점이 없어 종합 점수를 내지 않았습니다.', strongest: null, weakest: null, rule: 'none' }
  }
  // 엔진이 고른 최고·병목 지표를 우선, 없으면 점수로
  const byScore = [...scored].sort((a, b) => b.score - a.score)
  const strong = scored.find((i) => i.key === result.종합.최고_지표) ?? byScore[0]!
  const weak = scored.find((i) => i.key === result.종합.병목_지표) ?? byScore[byScore.length - 1]!
  const S = { key: strong.key, label: strong.label, score: strong.score }
  const W = { key: weak.key, label: weak.label, score: weak.score }
  if (scored.length === 1) {
    return { text: `${strong.label}만 산출했습니다(${formatScore(strong.score)}점). 나머지 관점은 자료가 없어요.`, strongest: S, weakest: W, rule: 'single' }
  }
  const sw = EASY_WORDS[strong.key]
  const ww = EASY_WORDS[weak.key]
  if (weak.score < GRADE_FLOOR.weak) {
    return { text: `${strong.label}은 좋지만, ${easy(ww, weak, 'weak', ctx)} 탓에 ${weak.label}이 매우 낮아요.`, strongest: S, weakest: W, rule: 'weak-alert' }
  }
  if (strong.score >= GRADE_FLOOR.good && weak.score < GRADE_FLOOR.mid) {
    return { text: `${easy(sw, strong, 'strong', ctx)}은 좋지만, ${easy(ww, weak, 'weak', ctx)} 편이라 ${weak.label}이 약한 자리예요.`, strongest: S, weakest: W, rule: 'strong-weak' }
  }
  if (scored.every((i) => i.score >= GRADE_FLOOR.mid && i.score < GRADE_FLOOR.good)) {
    return { text: '전반적으로 무난한 자리예요. 특별히 강하거나 약한 관점이 없어요.', strongest: S, weakest: W, rule: 'flat' }
  }
  return { text: `${easy(sw, strong, 'strong', ctx)}이 가장 좋은 자리예요.`, strongest: S, weakest: W, rule: 'strong-only' }
}
