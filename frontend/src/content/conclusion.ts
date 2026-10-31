/**
 * 한 줄 결론의 관점별 쉬운말 (13-12, 팀 점검 보고서 5장 표를 Codex R1-5 에 맞게 고침).
 * - noun: 관점이 무엇을 보는지(강점 문장의 괄호). 복합 점수 하나로 원인을 단정하지 않도록 "무엇이 좋다/나쁘다"가 아니라 "무엇을 본 점수"만 쓴다.
 * - fact: 약한 관점 옆에 붙이는 엔진 raw 근거의 이름(숫자는 lib/conclusion 이 raw 에서 채운다). 원인 해석 없이 사실만.
 * 표현 규칙: 그 위치 안 관점끼리의 비교 — 순위·확률·추천·"비싸다" 같은 단정을 쓰지 않는다(테스트가 고정).
 */
import type { PerspectiveKey } from '../api/schemas.ts'

export type EasyWords = { noun: string }

export const EASY_WORDS: Record<PerspectiveKey, EasyWords> = {
  market: { noun: '지역 소비·유입 흐름' },
  customer: { noun: '주요 손님층 거주' },
  competition: { noun: '같은 업종과의 경쟁 여건' },
  location: { noun: '역·시설 접근성' },
  stability: { noun: '이 업종의 지역 생존 여건' },
}
