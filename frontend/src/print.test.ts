/**
 * 인쇄용 CSS 계약 (12-15, 계획 1-3, 12-28-R1). jsdom 은 인쇄 매체를 재현하지 못하므로 규칙만 고정한다 — 실제 print 미디어·PDF 는
 * Playwright 로 production 번들을 열어 잰다(검수 자료 2-10). 여기서 고정하는 것: (1) print.css 가 App CSS 뒤에 로드된다, (2) 배치·높이·
 * overflow 는 !important 로 화면 규칙(떠 있는 패널·mobile data-screen)을 이긴다, (3) 숨은 탭 패널은 펼치고 지도·조건 바·행동은 숨긴다,
 * (4) 다크 테마 토큰을 밝은 값으로 되돌린다, (5) 화면 규칙(@media print 밖)에는 인쇄 머리말 숨김만 있다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src', 'styles', 'print.css'), 'utf-8')
const main = readFileSync(join(process.cwd(), 'src', 'main.tsx'), 'utf-8')
const printBlock = css.slice(css.indexOf('@media print'), css.lastIndexOf('.print-only {'))

function rule(selectorGroup: string, from: string = printBlock): string {
  const at = from.indexOf(`${selectorGroup} {`)
  expect(at, `${selectorGroup} 규칙이 있어야 한다`).toBeGreaterThan(-1)
  return from.slice(at, from.indexOf('}', at))
}

describe('print.css', () => {
  it('main.tsx 는 print.css 를 App 뒤에 불러온다 — 같은 우선순위의 화면 규칙이 인쇄 규칙을 덮지 않게 (12-28-R1)', () => {
    expect(main.indexOf("import './styles/print.css'")).toBeGreaterThan(main.indexOf("import App from './App.tsx'"))
  })

  it('지도·조건 바·시트·패널 행동·결과 활용 줄·탭 조작을 숨긴다', () => {
    const hidden = printBlock.slice(printBlock.indexOf('.app__map,'), printBlock.indexOf('display: none !important'))
    for (const s of ['.app__map', '.bar', '.map-sheet', '.panel__foot', '.result-tools', '.tabs']) expect(hidden).toContain(s)
  })

  it('앱 껍데기·패널·패널 스크롤 영역을 문서 흐름의 자동 높이 블록으로 — !important 로 화면 규칙과 mobile data-screen 숨김을 이긴다', () => {
    const app = rule('.app,\n  .app[data-screen],\n  .app[data-phase]')
    expect(app).toMatch(/position:\s*static !important/)
    expect(app).toMatch(/height:\s*auto !important/)
    expect(app).toMatch(/overflow:\s*visible !important/)
    const panel = rule('.panel,\n  .app[data-screen] .panel,\n  .panel[data-folded]')
    expect(panel).toMatch(/position:\s*static !important/)
    expect(panel).toMatch(/display:\s*block !important/)
    expect(panel).toMatch(/height:\s*auto !important/)
    expect(panel).toMatch(/max-height:\s*none !important/)
    expect(panel).toMatch(/overflow:\s*visible !important/)
    const workspace = rule('.workspace__panel')
    expect(workspace).toMatch(/overflow:\s*visible !important/)
    expect(workspace).toMatch(/height:\s*auto !important/)
    expect(rule('html,\n  body')).toMatch(/overflow:\s*visible !important/)
  })

  it('숨은 탭 패널을 모두 펼치고, 설명 함께 보기로만 보이던 것도 보인다', () => {
    expect(rule('.tabpanel[hidden]')).toMatch(/display:\s*block !important/)
    expect(rule('.result--quiet .result__headline,\n  .result--quiet .perspective__strongest,\n  .result--quiet .perspective__lowest,\n  .result--quiet .result__secondary,\n  .result--quiet .coverage')).toMatch(/display:\s*block !important/)
  })

  it('현장 카드 메모는 textarea 대신 줄바꿈을 보존한 전문 요소로 찍는다 (12-28-R5)', () => {
    expect(rule('.field-check__memo')).toMatch(/display:\s*none !important/)
    const print = rule('.field-check__memo-print')
    expect(print).toMatch(/display:\s*block !important/)
    expect(print).toMatch(/white-space:\s*pre-wrap/)
    expect(print).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('다크 테마라도 종이에서는 밝은 토큰(글자 #17202b, 표면 흰색)으로 되돌린다', () => {
    const tokens = rule(':root:not([data-theme="light"])')
    expect(tokens).toMatch(/--color-text-primary:\s*#17202b/i)
    expect(tokens).toMatch(/--color-surface:\s*#ffffff/i)
    expect(tokens).toMatch(/--color-bg:\s*#ffffff/i)
    expect(tokens).toMatch(/color-scheme:\s*light/)
  })

  it('화면 규칙에는 인쇄 머리말 숨김만 있다', () => {
    const screenPart = css.slice(css.lastIndexOf('.print-only {'))
    expect(screenPart).toMatch(/\.print-only \{\s*display:\s*none;\s*\}/)
    expect(screenPart).not.toContain('@media')
  })
})
