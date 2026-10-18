import { hiddenBelow } from './moreBelow.ts'

/** "아래에 더 있어요" 판정 (A3) — jsdom에는 레이아웃이 없어 스크롤 크기·사각형을 정해 준다 */
function scroller(rows: { name: string; bottom: number; hidden?: boolean }[], s: { height: number; scrollHeight: number; scrollTop: number }) {
  const el = document.createElement('main')
  for (const r of rows) {
    const wrap = document.createElement('section')
    if (r.hidden) wrap.hidden = true
    const li = document.createElement('li')
    li.className = 'perspective'
    li.innerHTML = `<span class="perspective__label">${r.name}</span>`
    li.getBoundingClientRect = () => ({ bottom: r.bottom }) as DOMRect
    wrap.appendChild(li)
    el.appendChild(wrap)
  }
  Object.defineProperty(el, 'clientHeight', { value: s.height })
  Object.defineProperty(el, 'scrollHeight', { value: s.scrollHeight })
  el.scrollTop = s.scrollTop
  Object.defineProperty(el, 'scrollTop', { value: s.scrollTop })
  el.getBoundingClientRect = () => ({ bottom: s.height }) as DOMRect
  return el
}

describe('hiddenBelow', () => {
  it('아래로 잘린 첫 항목 이름을 돌려준다', () => {
    expect(hiddenBelow(scroller([{ name: '시장성', bottom: 100 }, { name: '안정성', bottom: 700 }], { height: 600, scrollHeight: 900, scrollTop: 0 }))).toBe('안정성')
  })
  it('끝까지(30px 안) 내렸으면 null — 표시가 사라진다', () => {
    expect(hiddenBelow(scroller([{ name: '안정성', bottom: 700 }], { height: 600, scrollHeight: 900, scrollTop: 280 }))).toBeNull()
  })
  it('잘린 항목이 없으면(안내 문구만 넘침) null', () => {
    expect(hiddenBelow(scroller([{ name: '시장성', bottom: 500 }], { height: 600, scrollHeight: 900, scrollTop: 0 }))).toBeNull()
  })
  it('고르지 않은 탭(hidden) 안 항목은 보지 않는다', () => {
    expect(hiddenBelow(scroller([{ name: '숨은 탭', bottom: 700, hidden: true }], { height: 600, scrollHeight: 900, scrollTop: 0 }))).toBeNull()
  })
  it('스크롤 영역이 숨겨졌으면(크기 0) null', () => {
    expect(hiddenBelow(scroller([{ name: '시장성', bottom: 700 }], { height: 0, scrollHeight: 900, scrollTop: 0 }))).toBeNull()
  })
})
