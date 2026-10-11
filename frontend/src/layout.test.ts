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
    const rule = mobile.slice(mobile.indexOf('\n  .map__guide {') + 3)
    expect(rule).toMatch(/^\.map__guide \{[^}]*bottom: var\(--space-12\);/)
    expect(rule).toMatch(/^\.map__guide \{[^}]*width: max-content;/)
  })

  it('mobile에서 선택한 점포 막대가 있으면(같은 자리) 안내 칩을 숨긴다 (5차-B5)', () => {
    const mobile = [...mapCss.matchAll(/@media \(max-width: 639px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
    expect(mobile).toMatch(/\.map--store-active \.map__guide \{\s*display: none;/)
    // 점포 막대도 같은 높이(NAVER 로고·축척 위)
    expect(mobile).toMatch(/\.map__store-bar \{[^}]*bottom: var\(--space-12\);/)
    // 위쪽 범례가 점포 정보창(상호)을 가리지 않게
    expect(mobile).toMatch(/\.map--store-active \.map__legend \{\s*display: none;/)
  })

  it('선택한 점포 막대는 내용 폭(left: 50%의 절반 폭에 갇혀 상호가 잘리지 않게)', () => {
    const at = mapCss.indexOf('.map__store-bar {')
    expect(mapCss.slice(at, mapCss.indexOf('}', at))).toMatch(/width: max-content;/)
  })
})

describe('비교 마무리 겹침·터치 영역 (5차-B6)', () => {
  it('mobile sheet는 지도에 4px만 겹친다 — 8px(radius-lg)면 지도 아래 7px의 NAVER 로고 끝을 덮는다', () => {
    const rule = mobileRule('.map-sheet')
    expect(rule).toMatch(/margin-top: calc\(-1 \* var\(--space-1\)\);/)
    expect(rule).not.toMatch(/margin-top: calc\(-1 \* var\(--radius-lg\)\)/)
  })

  it('tablet 결과 지도(200px)에서 점포 막대는 왼쪽 아래, 점포를 고른 동안 범례·안내 칩을 숨긴다 (정보창을 덮지 않게)', () => {
    const tablet = appCss.slice(appCss.indexOf('@media (min-width: 640px) and (max-width: 1023px)'))
    const block = tablet.slice(0, tablet.indexOf('\n}\n'))
    const bar = block.slice(block.indexOf('.app[data-phase="result"] .map__store-bar {'))
    expect(bar).toMatch(/^[^}]*bottom: var\(--space-3\);/)
    expect(bar).toMatch(/^[^}]*left: var\(--space-4\);/)
    expect(bar).toMatch(/^[^}]*transform: none;/)
    expect(block).toMatch(
      /\.app\[data-phase="result"\] \.map--store-active \.map__legend,\s*\.app\[data-phase="result"\] \.map--store-active \.map__guide \{\s*display: none;/,
    )
  })

  it('"지도에 표시" 토글은 터치 기기·mobile에서 44px', () => {
    const nearbyCss = readFileSync(join(process.cwd(), 'src', 'components', 'NearbyStores.css'), 'utf-8')
    expect(nearbyCss).toMatch(
      /@media \(max-width: 639px\), \(pointer: coarse\) \{\s*\.nearby__toggle \{\s*min-height: var\(--control-height-touch\);/,
    )
  })
})

describe('tablet 결과 지도 높이 (정보창 잘림 수정)', () => {
  it('결과 지도는 320px — 가운데로 옮긴 점포 위로 정보창(꼬리 포함 약 148px)이 다 들어간다 (200px이면 윗부분이 잘린다)', () => {
    const tablet = appCss.slice(appCss.indexOf('@media (min-width: 640px) and (max-width: 1023px)'))
    const block = tablet.slice(0, tablet.indexOf('\n}\n'))
    const at = block.indexOf('.app[data-phase="result"] .workspace__map {')
    expect(at).toBeGreaterThan(-1)
    expect(block.slice(at, block.indexOf('}', at))).toMatch(/height: 320px;/)
  })
})

describe('포커스 대상이 sticky 헤더 아래 보이게 (6-2)', () => {
  it('문서 스크롤 여백은 헤더 실제 높이(--header-offset, 없으면 --header-height)다 — 포커스·앵커 이동 대상이 헤더 뒤에 남지 않게', () => {
    // 재현: 800×600에서 B 분석 성공 → 포커스를 받은 비교 제목이 y 0~30, sticky 헤더(두 줄 81px) 뒤.
    // 브라우저는 대상이 뷰포트 안이면(헤더 뒤라도) 스크롤하지 않는다 → scroll-padding-top으로 헤더 영역을 안 보이는 영역으로 알린다
    const at = appCss.indexOf('html {')
    expect(at, 'html 규칙이 App.css에 있어야 한다').toBeGreaterThan(-1)
    expect(appCss.slice(at, appCss.indexOf('}', at))).toMatch(/scroll-padding-top:\s*var\(--header-offset, var\(--header-height\)\);/)
    // 헤더가 sticky라서 필요한 규칙이다 (헤더가 흐름 안에 있으면 여백도 필요 없다)
    const header = appCss.indexOf('.app-header {')
    expect(appCss.slice(header, appCss.indexOf('}', header))).toMatch(/position:\s*sticky;/)
  })
})

describe('지도 안 요소가 sticky 헤더 위로 올라오지 않게 (6-3)', () => {
  it('.map은 독립 stacking context(isolation: isolate)다 — SDK 로고·축척(z-index 100)이 헤더(z-index 10) 위에 그려지지 않게', () => {
    // 재현: 800×600 단일 결과에서 문서를 330~340px 스크롤 → "데이터 출처" 링크 중심의 elementFromPoint가 NAVER 로고 IMG·축척 SPAN, 클릭이 막힘
    const at = mapCss.indexOf('.map {')
    expect(at).toBeGreaterThan(-1)
    expect(mapCss.slice(at, mapCss.indexOf('}', at))).toMatch(/isolation:\s*isolate;/)
    // 헤더 z-index를 올려서 푼 것이 아니다 (SDK 값을 쫓아가는 방식은 쓰지 않는다)
    const header = appCss.indexOf('.app-header {')
    expect(appCss.slice(header, appCss.indexOf('}', header))).toMatch(/z-index:\s*10;/)
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
