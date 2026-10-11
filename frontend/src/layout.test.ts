/**
 * App shell CSS 계약 (DESIGN.md §14). jsdom에는 레이아웃이 없어 크기 계산을 재현할 수 없으므로,
 * 실제 브라우저에서 확인한 버그의 원인이 된 규칙만 고정한다 (3차-B).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// vitest는 CSS import를 빈 모듈로 바꾸므로(?raw 포함) 파일을 직접 읽는다. jsdom 환경의 import.meta.url은
// file URL이 아니라서 vitest 실행 위치(frontend/, npm run check)를 기준으로 한다
const appCss = readFileSync(join(process.cwd(), 'src', 'App.css'), 'utf-8')

/** `@media (max-width: 639px)` 블록 안에서 selector 규칙 본문을 찾는다 */
function mobileRule(selector: string): string {
  const media = appCss.slice(appCss.indexOf('@media (max-width: 639px)'))
  const at = media.indexOf(`${selector} {`)
  expect(at, `${selector} 규칙이 mobile 블록에 있어야 한다`).toBeGreaterThan(-1)
  return media.slice(at, media.indexOf('}', at))
}

describe('mobile 지도 화면 레이아웃', () => {
  it('지도 영역은 flex 항목 최소 폭을 풀어 부모 폭을 따른다 — SDK canvas의 이전 inline 폭에 막히지 않게', () => {
    // 재현: 970px에서 분석 → 375px로 축소 → "지도 보기" 시 .workspace__map이 970px로 남아 595px 가로 넘침
    expect(mobileRule('.app[data-screen="map"] .workspace__map')).toMatch(/min-width:\s*0;/)
  })
})
