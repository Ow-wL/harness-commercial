/**
 * 한 줄 결론의 관점별 쉬운말 (13-12, 팀 점검 보고서 5장 표). 강점일 때 / 약점일 때. 약점 쪽 근거 숫자는 lib/conclusion 이 엔진 raw 에서 붙인다.
 * 표현 규칙: 그 위치 안 관점끼리의 비교 — 순위·확률·추천·"비싸다" 같은 단정을 쓰지 않는다(테스트가 고정).
 */
import type { PerspectiveKey } from '../api/schemas.ts'

export type EasyWords = { strong: string; weak: string }

export const EASY_WORDS: Record<PerspectiveKey, EasyWords> = {
  market: { strong: '지역 소비가 활발한 편', weak: '지역 소비 흐름이 약한' },
  customer: { strong: '타겟 손님층이 많이 사는 편', weak: '타겟 손님층이 적은' },
  competition: { strong: '같은 업종이 적은 편', weak: '같은 업종이 이미 많은' },
  location: { strong: '역·시설과 가까운 편', weak: '역·시설과 먼' },
  stability: { strong: '이 업종이 오래 버티는 지역인 편', weak: '이 업종 폐업이 잦은' },
}
