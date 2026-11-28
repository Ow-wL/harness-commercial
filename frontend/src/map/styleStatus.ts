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

/**
 * 관찰로 본 스타일 요청(13-63): 브라우저의 요청 기록 버퍼(기본 250개)는 지도 타일·글꼴 요청으로 금방 차고, 찬 뒤의 요청은
 * `getEntriesByType` 에 남지 않는다 — 그러면 정상(200) 스타일도 "요청 없음"으로 보여 밝은 지도로 떨어졌다(다크·라이트 둘 다
 * 스타일을 쓰면서 테마 전환 때 재현). PerformanceObserver 는 버퍼와 상관없이 받으므로 모듈이 불릴 때부터 따로 적어 둔다.
 */
const observed: ResourceEntry[] = []
const OBSERVED_MAX = 20

/** 관찰한 요청을 적는다(가장 최근 것만 조금). 테스트에서도 직접 부른다 */
export function recordStyleEntries(entries: readonly ResourceEntry[]): void {
  for (const e of entries) {
    if (!STYLE_REQUEST.test(e.name) || !e.responseStatus) continue
    observed.push({ name: e.name, startTime: e.startTime, responseStatus: e.responseStatus })
    if (observed.length > OBSERVED_MAX) observed.shift()
  }
}

if (typeof PerformanceObserver === 'function') {
  try {
    new PerformanceObserver((list) => recordStyleEntries(list.getEntries() as ResourceEntry[])).observe({ type: 'resource', buffered: true })
  } catch {
    // 관찰을 못 하는 브라우저는 버퍼만 본다(지금까지와 같다)
  }
}

export function styleStatusSince(t0: number, styleId: string): number | null {
  let status: number | null = null
  let at = -1
  const buffered = (typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : []) as ResourceEntry[]
  // 버퍼와 관찰 기록을 함께 보고 가장 늦게 시작한 요청의 결과를 쓴다
  for (const e of [...buffered, ...observed]) {
    if (STYLE_REQUEST.test(e.name) && e.startTime >= t0 && e.responseStatus && e.startTime >= at) {
      status = e.responseStatus
      at = e.startTime
    }
  }
  if (status !== null) last.set(styleId, status)
  return status
}

export function lastStyleStatus(styleId: string): number | null {
  return last.get(styleId) ?? null
}

/** 테스트 전용 */
export function resetStyleStatusForTest(): void {
  last.clear()
  observed.length = 0
}
