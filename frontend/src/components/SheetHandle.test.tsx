import { fireEvent, render, screen } from '@testing-library/react'
import { SheetHandle } from './SheetHandle.tsx'

/** jsdom 에는 레이아웃이 없어 패널 높이 824 · 손잡이 높이 52 로 고정한다(travel 772) */
function setup(lowered: boolean) {
  const onChange = vi.fn()
  const view = render(
    <div className="panel" data-testid="panel">
      <SheetHandle toggleId="t" lowered={lowered} summary="요약" controls="x" onChange={onChange} />
    </div>,
  )
  const panel = screen.getByTestId('panel')
  const handle = view.container.querySelector<HTMLElement>('.sheet-handle')!
  Object.defineProperty(panel, 'offsetHeight', { value: 824 })
  Object.defineProperty(handle, 'offsetHeight', { value: 52 })
  handle.setPointerCapture = vi.fn()
  return { onChange, panel, handle, unmount: view.unmount }
}

/** 시각까지 정해 끈다(속도 계산) — timeStamp 는 생성자로 줄 수 없어 만든 뒤 덮어쓴다 */
function drag(handle: HTMLElement, steps: Array<[y: number, t: number]>) {
  const fire = (type: string, y: number, t: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    Object.defineProperty(event, 'timeStamp', { value: t })
    fireEvent(handle, event)
  }
  const [first, ...rest] = steps
  fire('pointerdown', first![0], first![1])
  for (const [y, t] of rest) fire('pointermove', y, t)
  const last = steps[steps.length - 1]!
  fire('pointerup', last[0], last[1])
}

describe('SheetHandle — 끌어 올리고 내리기 (§20.1)', () => {
  it('누르면 전환한다 — 안의 버튼(키보드)과 손잡이 줄 어디든 같은 동작', () => {
    const { onChange, handle } = setup(false)
    fireEvent.click(screen.getByRole('button', { name: '지도 크게 보기' }))
    expect(onChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(handle)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('누르는 순간 포인터를 잡지만(얇은 줄을 빠르게 벗어나도 놓치지 않게), 6px 미만 움직임은 끌기가 아니다 — 패널을 건드리지 않는다', () => {
    const { onChange, panel, handle } = setup(false)
    drag(handle, [[100, 0], [104, 100]])
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1)
    expect(panel.style.transform).toBe('')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('끄는 동안 패널이 포인터를 따라가고 범위(0~travel)를 넘지 않는다', () => {
    const { panel, handle } = setup(false)
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300 })
    expect(panel).toHaveAttribute('data-dragging')
    expect(panel.style.transform).toBe('translateY(200px)')
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 5000 })
    expect(panel.style.transform).toBe('translateY(772px)')
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -500 })
    expect(panel.style.transform).toBe('translateY(0px)')
  })

  it('천천히 끌어 절반을 넘겨 놓으면 내려가고, 못 넘기면 그대로 — 놓으면 inline 을 지워 CSS 가 이어서 움직인다', () => {
    const over = setup(false)
    drag(over.handle, [[100, 0], [300, 1000], [600, 2000]])
    expect(over.onChange).toHaveBeenCalledWith(true)
    expect(over.panel).not.toHaveAttribute('data-dragging')
    expect(over.panel.style.transform).toBe('')
    over.unmount()

    const under = setup(false)
    drag(under.handle, [[100, 0], [200, 1000], [300, 2000]])
    expect(under.onChange).not.toHaveBeenCalled()
    expect(under.panel.style.transform).toBe('')
  })

  it('빠르게 튕기면 위치와 상관없이 그 방향 — 내린 시트를 조금만 위로 튕겨도 올라온다', () => {
    const { onChange, handle } = setup(true)
    drag(handle, [[700, 0], [690, 100], [640, 110]])
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('끌고 놓은 뒤 따라오는 click 은 전환으로 치지 않는다', () => {
    const { onChange, handle } = setup(false)
    drag(handle, [[100, 0], [200, 1000], [300, 2000]])
    fireEvent.click(handle)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(handle)                                // 그 다음 누르기는 전환
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('취소되면 원래 자리로 돌아가고 전환하지 않는다', () => {
    const { onChange, panel, handle } = setup(false)
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 700 })
    fireEvent.pointerCancel(handle, { pointerId: 1 })
    expect(panel.style.transform).toBe('')
    expect(onChange).not.toHaveBeenCalled()
  })
})
