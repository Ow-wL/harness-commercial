/**
 * 한 줄 결론 (13-12, 팀 점검 보고서 B1 — 2026-10-30, Codex R1-5 반영): 강점 = 산출된 관점 중 최고점, 약점 = 최저점. LLM 없이 템플릿으로 만든다.
 * 최고점의 **절대 수준**(등급 경계 lib/grade)을 먼저 본다 — 모두 낮은데 "좋다"고 말하지 않는다.
 *   최고 < 40(모두 약함·주의)  → "전반적으로 점수가 낮은 자리예요. {강점}이 그중 높은 편이고, {약점}이 가장 낮아요(참고: …)."   all-low
 *   약점 < 25 (최고 ≥ 40)      → "{강점}은 좋은/보통인 편이지만, {약점}이 매우 낮아요(참고: …)."                            weak-alert
 *   최고 ≥ 70 · 약점 < 40       → "{강점}은 좋은 편이지만, {약점}이 약한 자리예요(참고: …)."                                strong-weak
 *   모든 관점 40~70             → "전반적으로 무난한 자리예요. 특별히 강하거나 약한 관점이 없어요."                          flat
 *   최고 ≥ 70 · 최저 ≥ 40       → "{강점}이 특히 좋은 자리예요({무엇을 본 점수})."                                        strong-only
 *   최고 40~70 · 최저 25~40     → "{강점}이 가장 높고, {약점}은 약한 편이에요(참고: …)."                                    mixed
 * 약점 쪽 "참고"는 엔진 raw 사실(반경 안 같은 업종 수·최근접역 거리·3년 생존율·주요 손님층 거주 인구)만 — 원인을 단정하지 않는다.
 * "높다/낮다"는 그 위치 안 관점끼리의 비교 — 순위·확률·추천을 말하지 않는다. R2 의 AI 요약은 이 문장을 대체·보강하는 자리다.
 */
import type { AnalyzeResponse, PerspectiveKey } from '../api/schemas.ts'
import { EASY_WORDS } from '../content/conclusion.ts'
import { formatRadius, formatScore, type Indicator } from './format.ts'
import { GRADE_FLOOR } from './grade.ts'
import { withJosa } from './josa.ts'

export type Conclusion = {
  text: string
  strongest: { key: PerspectiveKey; label: string; score: number } | null
  weakest: { key: PerspectiveKey; label: string; score: number } | null
  /** 어느 규칙으로 만들었는지(테스트·AI 요약 입력용) */
  rule: 'all-low' | 'weak-alert' | 'strong-weak' | 'flat' | 'strong-only' | 'mixed' | 'none' | 'single'
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const fmt = (v: number) => Math.round(v).toLocaleString('ko-KR')

/** 약한 관점 옆 "(참고: …)" — 엔진 raw 사실만. 숫자가 없으면 빈 문자열 */
function fact(ind: Indicator, radiusM: number): string {
  const raw = ind.raw as Readonly<Record<string, unknown>>
  let text: string | null
  switch (ind.key) {
    case 'customer': {
      const pop = n(raw.타겟연령_거주인구)                         // v0.5: 반경 면적 배분, v0.3·v0.4: 행정동 전체(인구_기준 참고)
      text = pop === null ? null : `주요 손님층 연령 거주 ${fmt(pop)}명`
      break
    }
    case 'competition': {
      const cnt = n(raw.동종점포수)
      text = cnt === null ? null : `반경 ${formatRadius(radiusM)} 안 같은 업종 ${fmt(cnt)}곳`
      break
    }
    case 'location': {
      const d = n(raw.최근접역_거리m)
      text = d === null ? null : `가장 가까운 역까지 ${fmt(d)}m`
      break
    }
    case 'stability': {
      const s = n(raw['3년_생존율'])                              // 비율(0~1)
      text = s === null ? null : `이 업종 3년 생존율 ${Math.round(s * 100)}%`
      break
    }
    default:
      text = null
  }
  return text ? `(참고: ${text})` : ''
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
  const sLabel = strong.label
  const wLabel = weak.label
  const ref = fact(weak, ctx.radiusM)
  if (strong.score < GRADE_FLOOR.mid) {
    return { text: `전반적으로 점수가 낮은 자리예요. ${withJosa(sLabel, '이')} 그중 높은 편이고, ${withJosa(wLabel, '이')} 가장 낮아요${ref}.`, strongest: S, weakest: W, rule: 'all-low' }
  }
  if (weak.score < GRADE_FLOOR.weak) {
    const level = strong.score >= GRADE_FLOOR.good ? '좋은' : '보통인'
    return { text: `${withJosa(sLabel, '은')} ${level} 편이지만, ${withJosa(wLabel, '이')} 매우 낮아요${ref}.`, strongest: S, weakest: W, rule: 'weak-alert' }
  }
  if (strong.score >= GRADE_FLOOR.good && weak.score < GRADE_FLOOR.mid) {
    return { text: `${withJosa(sLabel, '은')} 좋은 편이지만, ${withJosa(wLabel, '이')} 약한 자리예요${ref}.`, strongest: S, weakest: W, rule: 'strong-weak' }
  }
  if (scored.every((i) => i.score >= GRADE_FLOOR.mid && i.score < GRADE_FLOOR.good)) {
    return { text: '전반적으로 무난한 자리예요. 특별히 강하거나 약한 관점이 없어요.', strongest: S, weakest: W, rule: 'flat' }
  }
  if (strong.score >= GRADE_FLOOR.good) {
    return { text: `${withJosa(sLabel, '이')} 특히 좋은 자리예요(${EASY_WORDS[strong.key].noun}).`, strongest: S, weakest: W, rule: 'strong-only' }
  }
  return { text: `${withJosa(sLabel, '이')} 가장 높고, ${withJosa(wLabel, '은')} 약한 편이에요${ref}.`, strongest: S, weakest: W, rule: 'mixed' }
}
