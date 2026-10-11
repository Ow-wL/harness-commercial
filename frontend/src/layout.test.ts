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

const mapCss = readFileSync(join(process.cwd(), 'src', 'components', 'MapView.css'), 'utf-8')

describe('점포 정보창 닫기 버튼 터치 영역 (4차 보완, DESIGN.md §15)', () => {
  it('지도 위 "정보창 닫기"와 정보창 안 "닫기"는 최소 44×44px', () => {
    const at = mapCss.indexOf('.map__store-bar-close,\n.map-store-info__close {')
    expect(at).toBeGreaterThan(-1)
    const rule = mapCss.slice(at, mapCss.indexOf('}', at))
    expect(rule).toMatch(/min-width:\s*44px;/)
    expect(rule).toMatch(/min-height:\s*44px;/)
    // 뒤에서 더 작은 min-height로 덮어쓰지 않는다
    expect(mapCss.slice(at)).not.toMatch(/\.map-store-info__close \{[^}]*min-height:\s*(?!44px)\d+px/)
  })
})

describe('지도 영역 포커스 표시 (4차 보완, DESIGN.md §15)', () => {
  it('지도 영역은 outline 대신 지도 레이어 위 포커스 링(::after inset 2px)을 그린다 — 포커스 표시가 없어지지 않게', () => {
    const at = mapCss.indexOf('.map:focus-visible::after {')
    expect(at).toBeGreaterThan(-1)
    const rule = mapCss.slice(at, mapCss.indexOf('}', at))
    expect(rule).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--color-focus-ring\);/)
    expect(rule).toMatch(/pointer-events:\s*none;/)                // 지도 조작을 막지 않는다
  })
})

describe('mobile 지도 화면 레이아웃', () => {
  it('지도 영역은 flex 항목 최소 폭을 풀어 부모 폭을 따른다 — SDK canvas의 이전 inline 폭에 막히지 않게', () => {
    // 재현: 970px에서 분석 → 375px로 축소 → "지도 보기" 시 .workspace__map이 970px로 남아 595px 가로 넘침
    expect(mobileRule('.app[data-screen="map"] .workspace__map')).toMatch(/min-width:\s*0;/)
  })
})

describe('지도 안내 칩 위치 (5차-B4)', () => {
  it('mobile에서는 NAVER 로고·축척 위(점포 막대와 같은 높이)에 두고, 내용 폭으로 한 줄을 유지한다', () => {
    const mobile = [...mapCss.matchAll(/@media \(max-width: 639px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
    const rule = mobile.slice(mobile.indexOf('.map__guide {'))
    expect(rule).toMatch(/^\.map__guide \{[^}]*bottom: var\(--space-12\);/)
    expect(rule).toMatch(/^\.map__guide \{[^}]*width: max-content;/)
  })
})
