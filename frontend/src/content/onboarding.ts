/**
 * 첫 방문 안내 문구 (묶음 D, docs/ONBOARDING_DESIGN.md §1). 어미는 "~합니다"로 통일(사용자 결정 2026-10-19).
 * 점수 해석·관점·데이터 설명은 넣지 않는다 — "이 점수는?"·설명 펼침·상세 근거 탭과 중복하지 않는다.
 */
import type { TourStep } from '../lib/onboarding.ts'

export const TOUR_TEXT: Record<Exclude<TourStep, 'result'>, string> = {
  location: '지도를 누르거나 주소·좌표로 위치를 고릅니다. 인천 안에서만 분석됩니다.',
  business: '29개 업종 중 하나를 고릅니다.',
  analyze: '다섯 관점 점수로 봅니다. 순위·매출 예측이 아닌 참고 지표입니다.',
}

/** 결과 안내: 반경 선택이 있는 서버(v0.4)와 없는 서버(v0.3) */
export const RESULT_TEXT = {
  withRadius: '반경(300·500m·1km)을 바꾸거나, 다른 위치와 비교해 볼 수 있습니다.',
  compareOnly: '다른 위치와 비교해 볼 수 있습니다.',
} as const

export const TOUR_LABELS = {
  next: '다음',
  done: '확인',
  skip: '건너뛰기',
  replay: '사용 방법 다시 보기',
  region: '사용 방법 안내',
} as const
