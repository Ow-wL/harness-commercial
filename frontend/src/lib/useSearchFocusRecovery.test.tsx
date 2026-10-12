import { fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useSearchFocusRecovery } from './useSearchFocusRecovery.ts'

/** 검색 자리(searchApi가 있을 때만)와 fallback 버튼. key로 검색을 새로 그릴 수 있다 */
function Host() {
  const [api, setApi] = useState<object | null>({})
  const [gen, setGen] = useState(0)
  const fallbackRef = useRef<HTMLButtonElement>(null)
  const onLost = useSearchFocusRecovery(api, () => fallbackRef.current)
  return (
    <>
      {api && <Search key={gen} onLost={onLost} />}
      <button type="button" ref={fallbackRef}>
        대체 조작
      </button>
      <button type="button" onClick={() => setApi(null)}>
        SDK 실패
      </button>
      <button type="button" onClick={() => setGen((n) => n + 1)}>
        초기화
      </button>
    </>
  )
}

/** 언마운트 때 포커스가 안에 있으면 onLost (AddressSearch와 같은 계약) */
function Search({ onLost }: { onLost: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const lostRef = useRef(onLost)
  // AddressSearch처럼 layout cleanup에서 DOM이 붙어 있는 동안 확인
  useLayoutEffectCleanup(() => {
    if (ref.current && ref.current === document.activeElement) lostRef.current()
  })
  return <input ref={ref} aria-label="검색" />
}

function useLayoutEffectCleanup(fn: () => void) {
  const fnRef = useRef(fn)
  useLayoutEffect(() => {
    fnRef.current = fn
  })
  useLayoutEffect(() => () => fnRef.current(), [])
}

describe('useSearchFocusRecovery (7-B4·B5)', () => {
  it('SDK 실패로 포커스를 가진 검색이 사라지면 fallback으로 옮긴다', () => {
    render(<Host />)
    screen.getByRole('textbox', { name: '검색' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'SDK 실패' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '대체 조작' }))
  })

  it('초기화(key)로 다시 그려진 것은 SDK 실패가 아니다 — 그 신호가 남아 나중의 SDK 실패 때 포커스를 옮기지 않는다', () => {
    render(<Host />)
    screen.getByRole('textbox', { name: '검색' }).focus()
    fireEvent.click(screen.getByRole('button', { name: '초기화' }))           // 포커스를 가진 채 새로 그려짐 → body
    expect(document.activeElement).toBe(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'SDK 실패' }))         // 검색에 포커스가 없던 상태의 실패
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '대체 조작' }))
  })
})
