/**
 * NAVER 커스텀 스타일 요청(`/v3/styler/props`) 결과 관찰 (8-DK §19.3.1, 묶음 A).
 *
 * - `styleStatusSince(t0)`: t0 이후 시작한 스타일 요청의 응답 상태(마지막 것). 브라우저가 상태를 주지 않으면 null — 다크로 보지 않는다.
 * - `lastStyleStatus()`: 이 페이지에서 마지막으로 본 스타일 요청 결과. SDK는 같은 스타일을 한 번 받으면 다음 지도(테마 전환으로
 *   다시 만든 지도)에서는 요청하지 않을 수 있다(묶음 A 검수에서 확인: 세 번째 스타일 지도부터 요청 없음) — 그때는 이 값으로 판정한다.
 *   잘못된 ID는 처음부터 200이 아니라서 200이 남지 않고, 실제 GL(renderMode 2) 조건은 호출 쪽이 그대로 본다.
 */
const STYLE_REQUEST = /\/v3\/styler\/props/

type ResourceEntry = { name: string; startTime: number; responseStatus?: number }

let last: number | null = null

export function styleStatusSince(t0: number): number | null {
  let status: number | null = null
  const entries = (typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : []) as ResourceEntry[]
  for (const e of entries) if (STYLE_REQUEST.test(e.name) && e.startTime >= t0 && e.responseStatus) status = e.responseStatus
  if (status !== null) last = status
  return status
}

export function lastStyleStatus(): number | null {
  return last
}

/** 테스트 전용 */
export function resetStyleStatusForTest(): void {
  last = null
}
