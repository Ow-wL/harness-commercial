/**
 * NAVER 커스텀 스타일 요청(`/v3/styler/props`) 결과 관찰 (8-DK §19.3.1, 묶음 A).
 *
 * - `styleStatusSince(t0, styleId)`: t0 이후 시작한 스타일 요청의 응답 상태(마지막 것). 지도는 한 번에 하나만 만들므로 t0 이후의 요청은
 *   그 세대가 요청한 `styleId`의 것으로 보고 **그 ID의 마지막 결과**로 기억한다. 브라우저가 상태를 주지 않으면 null — 다크로 보지 않는다.
 * - `lastStyleStatus(styleId)`: 이 페이지에서 그 스타일 ID로 마지막에 본 결과. SDK는 같은 스타일을 한 번 받으면 다음 지도(테마 전환으로
 *   다시 만든 지도)에서는 요청하지 않을 수 있다(묶음 A 검수에서 확인: 세 번째 스타일 지도부터 요청 없음) — 그때는 이 값으로 판정한다.
 *   ID별로 두므로 다른 스타일(예: 잘못된 라이트 ID → 400)의 실패가 정상 다크 스타일의 판정을 오염시키지 않는다(Codex 검수 2026-10-19).
 *   잘못된 ID는 처음부터 200이 아니라서 200이 남지 않고, 실제 GL(renderMode 2) 조건은 호출 쪽이 그대로 본다.
 */
const STYLE_REQUEST = /\/v3\/styler\/props/

type ResourceEntry = { name: string; startTime: number; responseStatus?: number }

const last = new Map<string, number>()

export function styleStatusSince(t0: number, styleId: string): number | null {
  let status: number | null = null
  const entries = (typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : []) as ResourceEntry[]
  for (const e of entries) if (STYLE_REQUEST.test(e.name) && e.startTime >= t0 && e.responseStatus) status = e.responseStatus
  if (status !== null) last.set(styleId, status)
  return status
}

export function lastStyleStatus(styleId: string): number | null {
  return last.get(styleId) ?? null
}

/** 테스트 전용 */
export function resetStyleStatusForTest(): void {
  last.clear()
}
