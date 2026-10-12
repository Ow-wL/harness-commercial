import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * 주소 검색(AddressSearch)이 포커스를 가진 채 사라졌을 때(SDK 인증 실패 등으로 `searchApi`가 null이 됨) 남은 기본 조작으로
 * 포커스를 옮긴다 (7-B4 단일 위치 → "좌표 직접 입력", 7-B5 B 카드 → "B 위도" 또는 B 카드 제목).
 *
 * 돌려주는 함수를 `AddressSearch.onFocusLost`에 넘긴다. AddressSearch는 언마운트 cleanup(DOM이 아직 붙어 있을 때)에서
 * 포커스가 안에 있었는지 보고 이 함수를 부르고, 같은 커밋의 이 layout effect가 `searchApi`가 사라졌음을 보고 옮긴다.
 * 그 사이 포커스가 다른 요소로 가 있으면(body가 아니면) 건드리지 않는다. 검색 밖에 포커스가 있었으면 애초에 부르지 않는다.
 */
export function useSearchFocusRecovery(searchApi: unknown, fallback: () => HTMLElement | null | undefined): () => void {
  const lost = useRef(false)
  const fallbackRef = useRef(fallback)
  useLayoutEffect(() => {
    fallbackRef.current = fallback
  })
  useLayoutEffect(() => {
    if (searchApi || !lost.current) return
    lost.current = false
    const active = document.activeElement
    if (!active || active === document.body) fallbackRef.current()?.focus()
  }, [searchApi])
  return useCallback(() => {
    lost.current = true
  }, [])
}
