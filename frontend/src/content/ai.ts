/**
 * AI 요약·질문 문구 (R2 13-23~13-27). AI 문장은 이 분석 자료로만 쓴다 — 순위·확률·추천·매출을 말하지 않는다(서버 시스템 프롬프트).
 * 고지: 질문·답변·조건(업종·구·반경) 원문을 30일 보관, 위치 좌표·IP·식별자는 남기지 않는다(backend app/ai.py).
 */
export const AI_TEXT = {
  summaryTitle: 'AI 요약',
  summaryNote: 'AI가 이 분석 자료만 보고 쓴 요약입니다. 틀릴 수 있으니 숫자는 위 카드와 상세 근거에서 확인하세요.',
  good: '좋은 점',
  bad: '주의할 점',
  check: '결정 전에 확인할 것',
  loading: 'AI 요약을 쓰는 중…',
  askOpen: 'AI에게 질문',
  askTitle: '이 분석에 대해 질문하기',
  askLead: '이 위치·업종의 분석 자료 안에서만 답합니다. 자료 밖 질문에는 확인 방법을 알려 드려요.',
  askPlaceholder: '예: 경쟁성이 왜 낮아요?',
  askSend: '질문하기',
  privacy: '질문과 답변, 분석 조건(업종·구·반경)은 서비스 개선을 위해 30일 보관합니다. 위치 좌표·IP는 남기지 않습니다.',
  profileTitle: '내 상황(선택)',
  profileNote: '이 브라우저에만 저장되고 질문할 때만 함께 보냅니다.',
  suggestionLead: 'AI가 대화에서 알게 된 내 상황입니다. 맞으면 저장하세요.',
} as const

/** 추천 질문 칩 3개 (13-24) */
export const SUGGESTED_QUESTIONS = ['왜 이 점수가 나왔나요?', '가장 약한 점을 보완하려면 무엇을 확인해야 하나요?', '같은 업종이 많은 건 얼마나 문제인가요?'] as const

/** AI 오류 코드 → 화면 문구(서버 message 대신 — 오류 분기는 code 로만, D-014) */
export const AI_ERROR_TEXT: Record<string, string> = {
  ai_limited: '오늘 이 기기에서 쓸 수 있는 AI 횟수를 다 썼어요. 내일 다시 이용해 주세요.',
  ai_budget: '이번 달 AI 사용량이 모두 소진되었어요. 위의 기본 요약은 그대로 볼 수 있어요.',
  ai_upstream: 'AI가 지금 답하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  ai_unavailable: '이 서버에는 AI 설명이 설정되어 있지 않아요.',
  invalid_question: '질문은 1~300자로 써 주세요.',
  rate_limited: '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.',
}
