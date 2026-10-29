/**
 * 인쇄용 CSS 계약 (12-15, 계획 1-3). jsdom 은 인쇄 매체를 재현하지 못하므로 규칙만 고정한다:
 * 지도·조건 바·행동·결과 활용 줄은 숨기고, 숨은 탭 패널은 펼치며, 화면 규칙(@media print 밖)에는 인쇄 머리말 숨김만 있다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src', 'styles', 'print.css'), 'utf-8')
const printBlock = css.slice(css.indexOf('@media print'), css.lastIndexOf('.print-only {'))

function rule(selector: string, from: string = printBlock): string {
  const at = from.indexOf(`${selector} {`)
  expect(at, `${selector} 규칙이 있어야 한다`).toBeGreaterThan(-1)
  return from.slice(at, from.indexOf('}', at))
}

describe('print.css', () => {
  it('지도·조건 바·시트·패널 행동·결과 활용 줄·탭 조작을 숨긴다', () => {
    const hidden = printBlock.slice(printBlock.indexOf('.app__map,'), printBlock.indexOf('display: none !important'))
    for (const s of ['.app__map', '.bar', '.map-sheet', '.panel__foot', '.result-tools', '.tabs']) expect(hidden).toContain(s)
  })

  it('숨은 탭 패널을 모두 펼치고, 설명 함께 보기로만 보이던 것도 보인다', () => {
    expect(rule('.tabpanel[hidden]')).toMatch(/display:\s*block !important/)
    expect(rule('.result--quiet .result__headline,\n  .result--quiet .perspective__strongest,\n  .result--quiet .perspective__lowest,\n  .result--quiet .result__secondary,\n  .result--quiet .coverage')).toMatch(/display:\s*block !important/)
  })

  it('패널은 정적 배치·자동 높이, 화면 규칙에는 인쇄 머리말 숨김만 있다', () => {
    expect(rule('.panel')).toMatch(/position:\s*static/)
    expect(rule('.workspace__panel')).toMatch(/overflow:\s*visible/)
    const screenPart = css.slice(css.lastIndexOf('.print-only {'))
    expect(screenPart).toMatch(/\.print-only \{\s*display:\s*none;\s*\}/)
    expect(screenPart).not.toContain('@media')
  })
})
