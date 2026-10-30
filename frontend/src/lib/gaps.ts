/**
 * "확인 필요" 한 줄 (12-20, 계획 0-6 안 B): 이 결과의 flag·fallback·raw 에서 규칙으로 만든 빠진 자료·공간 단위 안내.
 * 종합 점수 아래에 기본 노출한다 — 정밀한 핀과 소수 1자리 점수가 모든 자료가 지점 단위로 완전한 것처럼 보이지 않게.
 * - 엔진 값을 읽어 사실만 적는다(재계산·순위 표현 없음). 지표가 확인하지 않은 사실(예: "임대료가 비싸다")은 단정하지 않는다.
 * - 산출된 관점의 자료만 다룬다 — 미산출 관점은 주의 띠(attentionBand)가 맡는다.
 * - 규칙 순서: 임대료 미반영(S4 제외) → 구 단위 자료(시장성·안정성) → 반경 인구 면적 배분(v0.5 고객성) → 잠재수요의 유동 미반영(경쟁성)
 */
import type { AnalyzeResponse } from '../api/schemas.ts'
import { demandIncludesWorkers, isRadiusPopulation } from './evidence.ts'
import type { Indicator } from './format.ts'

/** 점수가 산출됐고 자료가 구 단위인가 (시장성 해상도_시군구 flag / 안정성 gugu_sobun 폴백) */
const guLevel = (ind: Indicator) =>
  ind.score !== null &&
  (ind.fallback === 'gugu' || ind.fallback === 'gugu_sobun' || ind.flags.includes('해상도_시군구'))

export function gapLines({ context, result }: AnalyzeResponse): string[] {
  const [market, customer, competition, , stability] = result.지표
  const out: string[] = []

  // rent_area=null → S4 제외 (lib/warnings.dataLimits 와 같은 조건 — 산출된 안정성에만)
  const s4 = stability.breakdown.find((b) => b.key === 's4')
  if (stability.score !== null && context.rent_area === null && s4 && s4.score === null) out.push('임대료 미반영')

  const gu = [guLevel(market) && '유입', guLevel(stability) && '생존율'].filter((s): s is string => Boolean(s))
  if (gu.length > 0) out.push(`${gu.join('·')}은 구 단위 자료`)

  if (customer.score !== null && isRadiusPopulation(customer)) out.push('반경 안 인구는 동 면적 비율로 나눠 추정')

  if (competition.score !== null) {
    // 팀 점검 보고서 6장 제안 문구: 번화가·신도시 상업지는 외부 방문객이 많아 경쟁성이 실제보다 낮게 나올 수 있다
    out.push(demandIncludesWorkers(competition) ? '잠재수요에 방문객 유동 없음(번화가는 경쟁성이 실제보다 낮게 나올 수 있음)' : '잠재수요는 거주 인구만(방문객 유동 없음)')
  }
  return out
}
