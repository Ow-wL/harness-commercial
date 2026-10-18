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
    // 재현: 970px에서 분석 → 375px로 축소 → "지도 보기" 시 지도 영역이 970px로 남아 595px 가로 넘침 (A3: .app__map)
    expect(mobileRule('.app[data-screen="map"] .app__map')).toMatch(/min-width:\s*0;/)
  })
})

describe('지도 안내 칩·점포 막대 위치 (A3 §19.1)', () => {
  const mobile = () => [...mapCss.matchAll(/@media \(max-width: 639px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
  const rule = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`)
    expect(at, `${selector} 규칙`).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at))
  }

  it('안내 칩·점포 막대는 지도에 보이는 영역 위쪽 가운데(조건 바 아래, 결과 패널 왼쪽)', () => {
    for (const selector of ['.map__guide', '.map__store-bar']) {
      const r = rule(mapCss, selector)
      expect(r).toMatch(/top: var\(--map-visible-top/)
      expect(r).toMatch(/left: calc\(\(100% - var\(--map-visible-right, 0px\)\) \/ 2\);/)
    }
  })

  it('mobile 안내 칩은 내용 폭으로 한 줄을 유지하고(남은 절반 폭에 갇히지 않게), 점포 막대가 있으면 같은 자리라 숨긴다 (5차-B5)', () => {
    // ".map--store-active .map__guide"가 아니라 칩 자체 규칙(줄 앞 들여쓰기로 찾는다)
    expect(rule(mobile(), '\n  .map__guide')).toMatch(/width: max-content;/)
    expect(mobile()).toMatch(/\.map--store-active \.map__guide \{\s*display: none;/)
  })

  it('선택한 점포 막대는 내용 폭(left 기준 절반 폭에 갇혀 상호가 잘리지 않게)', () => {
    expect(rule(mapCss, '.map__store-bar')).toMatch(/width: max-content;/)
  })

  it('확대·축소·맞춤은 보이는 영역 오른쪽 아래(결과 패널 왼쪽) — 패널 뒤에 숨지 않게', () => {
    expect(rule(mapCss, '.map__controls')).toMatch(/right: var\(--map-visible-right/)
  })
})

describe('비교 마무리 겹침·터치 영역 (5차-B6)', () => {
  it('mobile sheet는 지도에 4px만 겹친다 — 8px(radius-lg)면 지도 아래 7px의 NAVER 로고 끝을 덮는다', () => {
    const rule = mobileRule('.map-sheet')
    expect(rule).toMatch(/margin-top: calc\(-1 \* var\(--space-1\)\);/)
    expect(rule).not.toMatch(/margin-top: calc\(-1 \* var\(--radius-lg\)\)/)
  })

  it('desktop·tablet: 결과 패널은 지도 위 오른쪽에 떠 있고, 지도에 보이는 영역 오른쪽 끝 = 패널 왼쪽 (--map-visible-right)', () => {
    const at = appCss.indexOf('.panel {')
    const panel = appCss.slice(at, appCss.indexOf('}', at))
    expect(panel).toMatch(/position: absolute;/)
    expect(panel).toMatch(/right: var\(--a3-gap\);/)
    expect(panel).toMatch(/width: var\(--a3-panel-w\);/)
    expect(appCss).toMatch(/--map-visible-right: calc\(var\(--a3-panel-w\) \+ var\(--a3-gap\) \* 2\);/)
  })

  it('"지도에 표시" 토글은 터치 기기·mobile에서 44px', () => {
    const nearbyCss = readFileSync(join(process.cwd(), 'src', 'components', 'NearbyStores.css'), 'utf-8')
    expect(nearbyCss).toMatch(
      /@media \(max-width: 639px\), \(pointer: coarse\) \{\s*\.nearby__toggle \{\s*min-height: var\(--control-height-touch\);/,
    )
  })
})

describe('포커스 대상이 패널 위쪽 sticky 탭 뒤에 숨지 않게 (6-2 → A3)', () => {
  it('패널 스크롤 영역은 탭 높이만큼 scroll-padding-top — 포커스·앵커 이동 대상이 붙어 있는 탭 뒤에 남지 않게', () => {
    const at = appCss.indexOf('.workspace__panel {')
    expect(appCss.slice(at, appCss.indexOf('}', at))).toMatch(/scroll-padding-top:\s*64px;/)
    const tabsCss = readFileSync(join(process.cwd(), 'src', 'components', 'ResultTabs.css'), 'utf-8')
    const tabs = tabsCss.slice(tabsCss.indexOf('.tabs {'), tabsCss.indexOf('}', tabsCss.indexOf('.tabs {')))
    expect(tabs).toMatch(/position: sticky;/)
  })
})

describe('지도 안 요소가 sticky 헤더 위로 올라오지 않게 (6-3)', () => {
  it('.map은 독립 stacking context(isolation: isolate)다 — SDK 로고·축척(z-index 100)이 헤더(z-index 10) 위에 그려지지 않게', () => {
    // 재현: 800×600 단일 결과에서 문서를 330~340px 스크롤 → "데이터 출처" 링크 중심의 elementFromPoint가 NAVER 로고 IMG·축척 SPAN, 클릭이 막힘
    const at = mapCss.indexOf('.map {')
    expect(at).toBeGreaterThan(-1)
    expect(mapCss.slice(at, mapCss.indexOf('}', at))).toMatch(/isolation:\s*isolate;/)
    // 지도 밖 조건 바·결과 패널은 지도(z 0) 위 한 층(z 3)으로 충분하다 — SDK 값(100)을 쫓아가지 않는다
    for (const selector of ['.bar {', '.panel {']) {
      const at = appCss.indexOf(selector)
      expect(appCss.slice(at, appCss.indexOf('}', at))).toMatch(/z-index:\s*3;/)
    }
    const map = appCss.indexOf('.app__map {')
    expect(appCss.slice(map, appCss.indexOf('}', map))).toMatch(/z-index:\s*0;/)
  })
})

describe('참고 주소 줄 — mobile sheet 공간 (7-B2, ADDRESS_DESIGN §5.5)', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'components', 'ReferenceAddress.css'), 'utf-8')
  it('sheet 안에서는 한 줄 말줄임이라 sheet는 주소 길이와 무관하게 한 줄(20px)만큼만 커진다', () => {
    const at = css.indexOf('.map-sheet .reference-address {')
    expect(at).toBeGreaterThan(-1)
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toMatch(/white-space:\s*nowrap;/)
    expect(rule).toMatch(/overflow:\s*hidden;/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis;/)
  })
  it('세로 공간이 작은 폰(max-height 640px)에서는 sheet의 참고 주소 줄을 숨긴다 (패널 화면은 그대로)', () => {
    expect(css).toMatch(/@media \(max-height: 640px\) \{\s*\.map-sheet \.reference-address \{\s*display: none;/)
  })
})

describe('tablet 패널 접기 (P9, A3)', () => {
  const tabletAt = appCss.indexOf('@media (min-width: 640px) and (max-width: 1100px) {\n  .panel__fold {')
  const tablet = appCss.slice(tabletAt, appCss.indexOf('\n}\n', tabletAt))

  it('접기 줄은 tablet(640~1100px)에서만 보인다 — 밖에서는 display: none', () => {
    expect(appCss).toMatch(/\.panel__fold \{\s*display: none;\s*\}/)
    expect(tabletAt).toBeGreaterThan(-1)
    expect(tablet).toMatch(/\.panel__fold \{[^}]*display: flex;[^}]*min-height: 44px;/)
  })

  it('접으면 패널은 56px 띠 — 아래 고정을 풀고 접기 줄 밖의 내용(스크롤·아래 행동)은 그리지 않는다', () => {
    expect(tablet).toMatch(/\.panel\[data-folded\] \{\s*bottom: auto;\s*\}/)
    expect(tablet).toMatch(/\.panel\[data-folded\] \.panel__fold \{[^}]*min-height: 56px;/)
    expect(tablet).toMatch(/\.panel\[data-folded\] > :not\(\.panel__fold\) \{\s*display: none;\s*\}/)
  })

  it('접기·펼치기 버튼은 44px', () => {
    const at = appCss.indexOf('.panel__fold-button {')
    expect(appCss.slice(at, appCss.indexOf('}', at))).toMatch(/min-height: 44px;/)
  })
})

describe('위치 입력 방법 segmented (P2·P3)', () => {
  it('버튼은 각 44px, 고른 방법은 aria-pressed로 표시한다', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'components', 'LocationMethodSwitch.css'), 'utf-8')
    const at = css.indexOf('.location-method__button {')
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/min-height: 44px;/)
    expect(css).toContain('.location-method__button[aria-pressed="true"] {')
  })
})

describe('UI 간소화 — 결과 지도 시트 (mobile)', () => {
  it('헤드라인과 결과 참고 주소는 시트에서 숨기고(패널의 설명 함께 보기·위치 정보로), 분석 전 시트의 참고 주소는 건드리지 않는다', () => {
    const rule = mobileRule('.map-sheet__headline,\n  .map-sheet:has(.map-sheet__score) .reference-address')
    expect(rule).toMatch(/display: none;/)
    // 숨기는 대상은 이 둘뿐 — 주의 첫 줄(BandPeek)·점수·위치·행동은 이 규칙에 없다
    const selectors = rule.slice(0, rule.indexOf('{')).split(',').map((x) => x.trim())
    expect(selectors).toEqual(['.map-sheet__headline', '.map-sheet:has(.map-sheet__score) .reference-address'])
  })
})
