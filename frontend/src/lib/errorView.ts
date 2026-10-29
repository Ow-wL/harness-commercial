import type { ApiFailure } from '../api/client.ts'

/** 오류 다음 행동 — App이 처리한다 */
export type ErrorAction = 'reselect-conditions' | 'reselect-business' | 'reselect-location' | 'retry'

/** 오류가 보이는 자리 (DESIGN.md §10.3 "위치") */
export type ErrorPlacement = 'top' | 'business' | 'location' | 'result'

type ErrorView = {
  tone: 'info' | 'warning' | 'danger'
  placement: ErrorPlacement
  title: string
  body?: string
  action: { kind: ErrorAction; label: string; primary?: boolean }
  requestId?: string
}

/**
 * 실패 → 화면 (DESIGN.md §10.3 표). backend 오류는 error.code로만 분기한다(message로 분기하지 않는다).
 * schema 불일치는 §10.3 표에 없는 경우라 서버 문제(500)와 같은 톤으로 보여 준다.
 */
export function errorView(failure: ApiFailure): ErrorView {
  if (failure.kind === 'network') {
    return {
      tone: 'danger',
      placement: 'result',
      title: '서버에 연결할 수 없습니다',
      body: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
      action: { kind: 'retry', label: '다시 시도', primary: true },
    }
  }
  if (failure.kind === 'schema') {
    return {
      tone: 'danger',
      placement: 'result',
      title: '분석 결과를 표시할 수 없습니다',
      body: '서버 응답 형식이 화면이 기대하는 형식과 다릅니다. 잠시 후 다시 시도해 주세요.',
      action: { kind: 'retry', label: '다시 시도', primary: true },
    }
  }
  const { error } = failure
  switch (error.code) {
    case 'invalid_request':
      return {
        tone: 'info',
        placement: 'top',
        title: '요청 값이 올바르지 않습니다',
        body: '위치와 업종을 다시 선택해 주세요.',
        action: { kind: 'reselect-conditions', label: '조건 다시 선택' },
      }
    case 'invalid_business':
      return {
        tone: 'info',
        placement: 'business',
        title: '지원하지 않는 업종입니다',
        action: { kind: 'reselect-business', label: '업종 다시 선택' },
      }
    case 'invalid_analysis_options':
      return {
        tone: 'info',
        placement: 'top',
        title: '분석 옵션을 확인해 주세요',
        body: error.message,   // 엔진 규칙 문장 그대로 (§10.3)
        action: { kind: 'reselect-conditions', label: '조건 다시 선택' },
      }
    case 'invalid_coordinate':
      return {
        tone: 'info',
        placement: 'location',
        title: '좌표를 확인할 수 없습니다',
        action: { kind: 'reselect-location', label: '지도에서 다시 선택' },
      }
    case 'location_outside':
      return {
        tone: 'warning',
        placement: 'result',
        title: '인천 안의 위치를 선택해 주세요',
        body: '현재 인천 158개 행정동만 분석합니다.',
        action: { kind: 'reselect-location', label: '지도에서 다시 선택' },
      }
    case 'no_data_nearby':
      return {
        tone: 'warning',
        placement: 'result',
        title: '주변 500m 안에 상가 데이터가 없어요',
        body: '바다·산·공터처럼 점포가 없는 곳은 분석하지 않습니다. 근처 상가 쪽으로 옮겨 보세요.',
        action: { kind: 'reselect-location', label: '위치 다시 선택' },
      }
    case 'invalid_radius':
      // 8-D3: 서버가 그 반경을 받지 않는다. 서버가 바뀐 경우는 App이 /health 를 다시 보고 500m로 복구한다(4.6 R2) —
      // 이 화면은 복구하지 않는 경우(다시 봐도 그 반경을 광고) 남는다
      return {
        tone: 'warning',
        placement: 'result',
        title: '선택한 분석 반경을 지금 분석할 수 없습니다',
        body: '잠시 후 다시 시도하거나 다른 반경을 골라 주세요.',
        action: { kind: 'retry', label: '다시 시도', primary: true },
      }
    case 'internal_error':
      return {
        tone: 'danger',
        placement: 'result',
        title: '분석 중 문제가 생겼습니다',
        body: '잠시 후 다시 시도해 주세요.',
        action: { kind: 'retry', label: '다시 시도', primary: true },
        requestId: error.request_id,
      }
    case 'invalid_query':
    case 'places_unavailable':
    case 'places_upstream':
      // 12-14 장소 검색 코드 — /places 는 PlaceSearch 가 자기 상태 문구로 다루고 분석 경로에서는 오지 않는다. 혹시 오면 서버 문제로
      return {
        tone: 'danger',
        placement: 'result',
        title: '분석 중 문제가 생겼습니다',
        body: '잠시 후 다시 시도해 주세요.',
        action: { kind: 'retry', label: '다시 시도', primary: true },
      }
  }
}
