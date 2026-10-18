/** "아래에 더 있어요"(components/MoreBelow.tsx)의 판정 — 스크롤 영역 아래로 잘린 첫 항목 */
/** 잘렸는지 보는 항목(관점 행·비교 행·근거 아코디언·점포)과 그 이름. 분석 전 조건 단계는 아래 고정 "분석하기"와 겹쳐 보지 않는다 */
const ITEMS = '.perspective, .compare-rows__list > li, .detail, .nearby__list > li'
const NAMES = '.perspective__label, .compare-row__label, .detail__label, .nearby__name'
/** 끝에서 이만큼 안이면 끝까지 내린 것으로 본다 */
const END_SLACK = 30

/** 지금 스크롤 영역 아래로 잘린 첫 항목의 이름. 잘린 항목이 없거나 끝까지 내렸으면 null (렌더 밖 계산 — DOM을 읽는다) */
export function hiddenBelow(scroller: HTMLElement): string | null {
  if (scroller.clientHeight === 0) return null
  if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= END_SLACK) return null
  const bottom = scroller.getBoundingClientRect().bottom + 1
  // 고르지 않은 탭(hidden) 안 항목은 보지 않는다
  const next = [...scroller.querySelectorAll<HTMLElement>(ITEMS)].find(
    (el) => !el.closest('[hidden]') && el.getBoundingClientRect().bottom > bottom,
  )
  if (!next) return null
  return next.querySelector(NAMES)?.textContent?.trim() ?? ''
}
