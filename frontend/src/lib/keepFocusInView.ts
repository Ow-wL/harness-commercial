/**
 * 참고 주소 줄이 늦게 나타나 그 아래의 포커스 요소를 화면 밖으로 밀어낸 경우에만 그 요소를 다시 보이게 한다 (7-B3).
 * 예: B 좌표 입력 → 포커스 "B 분석하기"(화면 아래쪽) → 주소 응답이 와서 B 카드에 한 줄이 생김 → 버튼이 화면 아래로 밀림.
 *
 * - 줄보다 뒤(문서 순서)에 있는 포커스만 대상이다 — 줄 앞의 요소는 밀리지 않는다.
 * - 줄이 생기기 전에 화면 안에 걸쳐 있던 요소만 되돌린다(이미 화면 밖이던 요소 때문에 스크롤하지 않는다).
 * - `block: 'nearest'` — 이미 보이면 움직이지 않고, 밀린 만큼만 스크롤한다.
 */
export function keepFocusInView(line: HTMLElement, viewportHeight = window.innerHeight): boolean {
  const active = line.ownerDocument.activeElement
  if (!(active instanceof HTMLElement) || active === line.ownerDocument.body) return false
  if (!(line.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING)) return false
  const pushed = line.getBoundingClientRect().height
  const rect = active.getBoundingClientRect()
  const wasVisible = rect.top - pushed < viewportHeight
  if (rect.bottom <= viewportHeight || !wasVisible) return false
  active.scrollIntoView?.({ block: 'nearest' })
  return true
}
