import { keepFocusInView } from './keepFocusInView.ts'

/** 줄(p) 하나와 그 앞·뒤 버튼. rect는 viewport 기준 top/bottom만 쓴다 */
function setup() {
  document.body.innerHTML = '<button id="before">앞</button><p id="line">참고 주소</p><button id="after">B 분석하기</button>'
  const line = document.getElementById('line')!
  const before = document.getElementById('before') as HTMLButtonElement
  const after = document.getElementById('after') as HTMLButtonElement
  const rect = (el: HTMLElement, top: number, height: number) =>
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + height, height } as DOMRect)
  const scroll = vi.fn()
  before.scrollIntoView = scroll
  after.scrollIntoView = scroll
  rect(line, 500, 20)
  return { line, before, after, rect, scroll }
}

describe('keepFocusInView — 늦게 생긴 참고 주소 줄이 포커스를 화면 밖으로 밀었을 때만 (7-B3)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('줄 아래의 포커스가 줄 높이만큼 밀려 화면 아래로 넘어가면 nearest로 되돌린다', () => {
    const { line, after, rect, scroll } = setup()
    after.focus()
    rect(after, 575, 40)                              // 줄 전 555–595(보임) → 줄 뒤 575–615(600 밖)
    expect(keepFocusInView(line, 600)).toBe(true)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('밀린 뒤에도 화면 안이면 스크롤하지 않는다', () => {
    const { line, after, rect, scroll } = setup()
    after.focus()
    rect(after, 400, 40)
    expect(keepFocusInView(line, 600)).toBe(false)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('줄이 생기기 전에도 이미 화면 밖이던 포커스 때문에는 스크롤하지 않는다', () => {
    const { line, after, rect, scroll } = setup()
    after.focus()
    rect(after, 900, 40)
    expect(keepFocusInView(line, 600)).toBe(false)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('줄 앞의 포커스나 포커스 없음(body)은 대상이 아니다', () => {
    const { line, before, rect, scroll } = setup()
    before.focus()
    rect(before, 700, 40)
    expect(keepFocusInView(line, 600)).toBe(false)
    before.blur()
    expect(keepFocusInView(line, 600)).toBe(false)
    expect(scroll).not.toHaveBeenCalled()
  })
})
