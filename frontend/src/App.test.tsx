import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import type { Mock } from 'vitest'
import App from './App.tsx'
import type { MapViewProps } from './components/MapView.tsx'
import fixture from './fixtures/bupyeong-pcbang.json'
import nearbyFixture from './fixtures/bupyeong-pcbang-nearby.json'
import guwolFixture from './fixtures/compare-guwol-pcbang.json'
import guwolNearbyFixture from './fixtures/compare-guwol-pcbang-nearby.json'
import ganghwaPeekFixture from './fixtures/compare-ganghwa-pcbang.json'
import songdoFixture from './fixtures/compare-songdo-pcbang.json'
import songdoNearbyFixture from './fixtures/compare-songdo-pcbang-nearby.json'
import { brokenControls, brokenReferences, duplicateIds, expandAll } from './test/a11yRefs.ts'

// 지도는 SDK 경계(MapView) 통째로 mock한다 — 실제 NAVER SDK를 부르지 않는다.
// mock은 실제 MapView와 같은 계약: interactive=false면 클릭을 무시하고, 클릭 좌표를 onSelect로 넘긴다.
// 7-B2: 참고 주소 — MapView mock이 SDK 상태를 App에 올리고(onSdkState), 역지오코딩 콜백은 테스트가 보낸다 (7-B4 검색 geocode도 같다)
const sdkMock = vi.hoisted(() => {
  const reverseCalls: { options: Record<string, unknown>; callback: (status: number, response?: unknown) => void }[] = []
  const geocodeCalls: { options: Record<string, unknown>; callback: (status: number, response?: unknown) => void }[] = []
  const api = {
    Service: {
      Status: { OK: 200, ERROR: 500 },
      geocode: (options: Record<string, unknown>, callback: (status: number, response?: unknown) => void) => {
        geocodeCalls.push({ options, callback })
      },
      reverseGeocode: (options: Record<string, unknown>, callback: (status: number, response?: unknown) => void) => {
        reverseCalls.push({ options, callback })
      },
    },
  }
  // 지도 영역 예외(MapErrorBoundary) 재현용 — true면 mock 지도가 렌더 중 예외를 던진다
  const crash = { on: false }
  return { reverseCalls, geocodeCalls, api, crash }
})

vi.mock('./components/MapView.tsx', () => ({
  MapView: (props: MapViewProps) => {
    if (sdkMock.crash.on) throw new TypeError("Cannot read properties of null (reading 'isArray')")
    return (
      <div
        data-testid="map"
        data-selected={props.selected ? `${props.selected.lat},${props.selected.lng}` : ''}
        data-radius={props.radiusM ?? ''}
        data-tone={props.markerTone}
        data-dong={props.dong ? `${props.dong.guCode} ${props.dong.dongName}` : ''}
        data-stores={props.stores ? String(props.stores.length) : ''}
        data-active-store={props.activeStoreId ?? ''}
        data-interactive={String(props.interactive)}
        data-compare={props.compare ? 'on' : undefined}
        data-compare-location={props.compare ? (props.compare.location ? `${props.compare.location.lat},${props.compare.location.lng}` : '') : undefined}
        data-compare-tone={props.compare?.tone}
        data-compare-dong={props.compare ? (props.compare.dong ? `${props.compare.dong.guCode} ${props.compare.dong.dongName}` : '') : undefined}
        data-compare-guide={props.compare?.guide ?? undefined}
        data-store-context={props.storeContext}
        data-layout-key={props.layoutKey}
        data-theme={props.theme}
      >
        <button type="button" onClick={() => props.interactive && props.onSelect({ lat: 37.4894, lng: 126.7246 })}>
          지도 클릭: 부평역
        </button>
        <button type="button" onClick={() => props.interactive && props.onSelect({ lat: 37.392512, lng: 126.639034 })}>
          지도 클릭: 송도
        </button>
        <button type="button" onClick={() => props.onSdkState?.({ status: 'ready', api: sdkMock.api as never, geocoder: 'ready' })}>
          SDK 준비
        </button>
        <button type="button" onClick={() => props.onSdkState?.({ status: 'ready', api: sdkMock.api as never, geocoder: 'unavailable' })}>
          SDK Geocoder 없음
        </button>
        <button type="button" onClick={() => props.onSdkState?.({ status: 'failed', kind: 'auth' })}>
          SDK 인증 실패
        </button>
        {props.stores?.[1] && (
          <button type="button" onClick={() => props.onStoreSelect?.(props.stores![1]!.id)}>
            지도 점포 마커: {props.stores[1].name}
          </button>
        )}
      </div>
    )
  },
}))

/** GET /businesses 응답 (테스트 데이터: 실제 계약 모양, 일부 업종만) */
const CATALOG = {
  groups: [
    {
      code: 'A_고객밀착형',
      name: '고객밀착형',
      businesses: [{ code: 'G20405', name: '편의점', group: 'A_고객밀착형' }],
    },
    {
      code: 'C_목적방문형',
      name: '목적방문형',
      businesses: [
        { code: 'R10406', name: 'PC방', group: 'C_목적방문형' },
        { code: 'R10407', name: '노래방', group: 'C_목적방문형' },
      ],
    },
  ],
  total: 3,
}

/** headers: 응답 헤더(9-C4 X-Data-Version 등). 없으면 Content-Type 만 */
type ReplyBody = { status: number; body: unknown; headers?: Record<string, string> }
type Reply = ReplyBody | 'network-error' | Promise<ReplyBody>

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers },
  })

/** 구버전 서버(8-D2 이전, 현재 운영)의 GET /health — engine 필드가 없다 → 반경 선택 없음 (8-D3) */
const OLD_HEALTH = { status: 'ok', service_ready: true, warm: { completed: 29, total: 29, done: true, failed: false, error: null } }

/**
 * fetch mock: /businesses는 CATALOG, /health는 health(기본 구버전 서버), /analyze·/nearby-stores는 각자 차례대로 replies
 * (분석 뒤 /nearby-stores가 없으면 네트워크 실패로 끝난다). health 를 배열로 주면 차례대로(마지막 값을 계속) 쓴다
 */
function mockApi({
  businesses = { status: 200, body: CATALOG } as Reply,
  analyze = [] as Reply[],
  nearby = [] as Reply[],
  health = { status: 200, body: OLD_HEALTH } as Reply | Reply[],
  places = [] as Reply[],
  rank = [] as Reply[],
  summary = [] as Reply[],
} = {}) {
  const queue = [...analyze]
  const nearbyQueue = [...nearby]
  const healthQueue = Array.isArray(health) ? [...health] : [health]
  const placesQueue = [...places]
  const rankQueue = [...rank]
  const summaryQueue = [...summary]
  // R1 13-15·13-16·13-17: 결과 뒤 /rank·/insights, 주소 폼의 /stations 는 분석 흐름과 독립 — 준비한 응답이 없으면 404(카드는 오류 문구, 분석은 그대로)
  const NOT_FOUND: Reply = { status: 404, body: { error: { code: 'not_found', message: '없음' } } }
  const fetchMock = vi.fn(async (url: string) => {
    const reply =
      url === '/businesses'
        ? businesses
        : url === '/health'
          ? healthQueue.length > 1
            ? healthQueue.shift()
            : healthQueue[0]
          : url === '/nearby-stores'
            ? nearbyQueue.shift()
            : url === '/places'
              ? placesQueue.shift()
              : url === '/rank'
                ? (rankQueue.shift() ?? NOT_FOUND)
                : url === '/stations' || url === '/insights' || url === '/ask'
                  ? NOT_FOUND
                  : url === '/summary'
                    ? (summaryQueue.shift() ?? NOT_FOUND)
                    : queue.shift()
    if (reply === undefined) throw new Error(`예상하지 못한 요청: ${url}`)
    if (reply === 'network-error') throw new TypeError('Failed to fetch')
    const { status, body, headers } = await reply
    return json(status, body, headers)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function analyzeCalls(fetchMock: Mock) {
  return fetchMock.mock.calls.filter(([url]) => url === '/analyze')
}

function nearbyCalls(fetchMock: Mock) {
  return fetchMock.mock.calls.filter(([url]) => url === '/nearby-stores')
}

const analyzeButton = () => screen.getByRole('button', { name: /분석하기|분석 중/ })

/**
 * A3 결과 탭(요약 · 주변 점포 · 상세 근거): 점포 목록은 "주변 점포", 비교 점수 표·주의할 점·데이터 출처는 "상세 근거" 탭에 있고
 * 고르지 않은 탭은 hidden이다(사용자에게도 안 보인다). 그 내용을 볼 때는 사용자처럼 탭을 먼저 연다. 탭이 없거나 이미 열렸으면 그대로
 */
const STORES_TAB = /^주변 점포/
const EVIDENCE_TAB = /^상세 근거/
function openTab(name: RegExp) {
  const tab = screen.queryAllByRole('tab').find((t) => name.test(t.textContent ?? ''))
  if (tab && tab.getAttribute('aria-selected') !== 'true') fireEvent.click(tab)
}
type RoleOpts = Parameters<typeof screen.getByRole>[1]
const getInTab = (tab: RegExp, role: string, opts: RoleOpts) => {
  openTab(tab)
  return screen.getByRole(role, opts)
}
const queryInTab = (tab: RegExp, role: string, opts: RoleOpts) => {
  openTab(tab)
  return screen.queryByRole(role, opts)
}
const findInTab = (tab: RegExp, role: string, opts: RoleOpts) => waitFor(() => getInTab(tab, role, opts))
const getList = (name: string | RegExp) => getInTab(STORES_TAB, 'list', { name })
const queryList = (name: string | RegExp) => queryInTab(STORES_TAB, 'list', { name })
const findList = (name: string | RegExp) => findInTab(STORES_TAB, 'list', { name })
const SCORE_TABLE = { name: /종합·5대 관점 점수 비교/ }
const getScoreTable = () => getInTab(EVIDENCE_TAB, 'table', SCORE_TABLE)
const queryScoreTable = () => queryInTab(EVIDENCE_TAB, 'table', SCORE_TABLE)
const findScoreTable = () => findInTab(EVIDENCE_TAB, 'table', SCORE_TABLE)

async function selectBupyeongPcBang() {
  fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
  const select = await screen.findByRole('combobox', { name: '업종' })
  await waitFor(() => expect(select).toBeEnabled())
  fireEvent.change(select, { target: { value: 'R10406' } })
}

const internalError = {
  error: { code: 'internal_error', message: '서버 내부 오류가 발생했습니다.', request_id: '3f2a9c0e'.repeat(4) },
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('업종 목록 (GET /businesses)', () => {
  it('schema를 통과한 응답을 그룹 구조 그대로 보여 준다', async () => {
    const fetchMock = mockApi()
    render(<App />)
    const select = screen.getByRole('combobox', { name: '업종' })
    expect(select).toBeDisabled()
    expect(within(select).getByRole('option', { name: '업종 불러오는 중…' })).toBeInTheDocument()

    await waitFor(() => expect(select).toBeEnabled())
    expect(fetchMock).toHaveBeenCalledWith('/businesses', expect.anything())
    const groups = within(select).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['고객밀착형', '목적방문형'])
    expect(within(groups[1]!).getAllByRole('option').map((o) => o.textContent)).toEqual(['PC방', '노래방'])
  })

  it('schema와 다른 응답은 조용히 넘기지 않고 오류로 보여 준다', async () => {
    mockApi({ businesses: { status: 200, body: { ...CATALOG, total: 29 } } })
    render(<App />)
    expect(await screen.findByText('업종 목록을 불러오지 못했습니다')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '업종' })).toBeDisabled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('/businesses'), expect.anything())
  })
})

describe('tablet 패널 접기 (P9, A3)', () => {
  const ok = (body: unknown) => ({ status: 200, body })
  const panel = () => document.querySelector<HTMLElement>('.panel')!
  const foldButton = () => screen.getByRole('button', { name: /^패널 (접기|펼치기)$/ })

  it('접으면 띠에 위치 · 반경 · 점포 수, 펼치면 그대로 — 버튼은 aria-expanded로 패널 스크롤 영역을 가리킨다', async () => {
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    expect(foldButton()).toHaveAttribute('aria-expanded', 'true')
    expect(foldButton()).toHaveAttribute('aria-controls', 'workspace-panel')
    expect(document.getElementById('workspace-panel')).toHaveAccessibleName('분석 결과')
    expect(panel().querySelector('.panel__fold-label')).toBeEmptyDOMElement()   // 펼친 상태: 제목과 겹치지 않게 비운다

    fireEvent.click(foldButton())
    expect(panel()).toHaveAttribute('data-folded', 'true')
    expect(panel().querySelector('.panel__fold-label')).toHaveTextContent(`부평구 부평1동 · 반경 500m · 점포 ${nearbyFixture.count}곳`)
    // 접기도 MapView 화면 전환 신호에 실린다(크기 맞춤 흐름 1회 — zoom은 바꾸지 않는다, D-022 순위 8)
    expect(screen.getByTestId('map')).toHaveAttribute('data-layout-key', expect.stringMatching(/:folded:/))
    expect(foldButton()).toHaveAccessibleName('패널 펼치기')
    expect(foldButton()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).not.toBe(document.body)
    fireEvent.click(foldButton())
    expect(panel()).not.toHaveAttribute('data-folded')
  })

  it('결과에서 접고 조건 바꾸기 → 같은 조건으로 다시 분석(캐시 적중): 새 결과는 펼쳐진 채 제목 포커스, 이전 접힘이 되살아나지 않는다 (8-P 검수 회귀)', async () => {
    const fetchMock = mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    fireEvent.click(foldButton())
    expect(panel()).toHaveAttribute('data-folded', 'true')

    fireEvent.click(screen.getByRole('button', { name: '조건 바꾸기' }))
    expect(panel()).not.toHaveAttribute('data-folded')
    fireEvent.click(analyzeButton())
    const title = await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(analyzeCalls(fetchMock)).toHaveLength(1)                  // 캐시 적중 — 같은 응답 객체가 다시 보인다
    expect(panel()).not.toHaveAttribute('data-folded')
    expect(foldButton()).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('결과에서 접고 조건 바꾸기 → 다른 위치로 새 응답: 새 결과는 펼쳐진 채 제목 포커스 (8-P 검수 회귀)', async () => {
    const fetchMock = mockApi({
      analyze: [ok(fixture), ok(songdoFixture)],
      nearby: [ok(nearbyFixture), ok(songdoNearbyFixture)],
    })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    fireEvent.click(foldButton())
    expect(panel()).toHaveAttribute('data-folded', 'true')

    fireEvent.click(screen.getByRole('button', { name: '조건 바꾸기' }))
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    fireEvent.click(analyzeButton())
    const title = await screen.findByRole('heading', { level: 1, name: '연수구 송도2동 · PC방 분석' })
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
    expect(panel()).not.toHaveAttribute('data-folded')
    await waitFor(() => expect(document.activeElement).toBe(title))
    // 새 결과에서 다시 접고 펼칠 수 있다(기록은 지금 화면 것만)
    fireEvent.click(foldButton())
    expect(panel()).toHaveAttribute('data-folded', 'true')
    fireEvent.click(foldButton())
    expect(panel()).not.toHaveAttribute('data-folded')
  })

  it('접은 뒤 화면이 바뀌면(조건 바꾸기 → 분석 조건) 다시 펼친다 — 접힌 패널 안으로 포커스를 옮기지 않는다', async () => {
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    fireEvent.click(foldButton())
    expect(panel()).toHaveAttribute('data-folded', 'true')
    expect(panel().querySelector('.panel__fold-label')).toHaveTextContent('분석 조건')
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(panel()).not.toHaveAttribute('data-folded')
    expect(document.activeElement).toHaveAttribute('id', 'result-title')
  })
})

describe('분석 흐름', () => {
  it('위치·업종을 고르기 전에는 분석 버튼이 비활성이고, 둘 다 고르면 활성이 된다', async () => {
    mockApi()
    render(<App />)
    expect(analyzeButton()).toBeDisabled()
    expect(screen.getByText('위치를 먼저 선택하세요')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    expect(screen.getByText('37.4894, 126.7246', { selector: '.location__value .mono' })).toBeInTheDocument()
    expect(analyzeButton()).toBeDisabled()
    expect(screen.getByText('업종을 선택하세요')).toBeInTheDocument()

    const select = screen.getByRole('combobox', { name: '업종' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'R10406' } })
    expect(analyzeButton()).toBeEnabled()
  })

  it('단일 분석 좌표 입력: 제출 뒤 입력란이 그대로 남고 포커스도 제출 버튼에 남는다 (B 포커스 이동이 번지지 않는다)', async () => {
    mockApi()
    render(<App />)
    const conditions = screen.getByRole('region', { name: '분석 조건' })
    fireEvent.click(within(conditions).getByRole('button', { name: '좌표 입력' }))   // 위치 입력 방법 segmented(mobile sheet에도 같은 이름 버튼이 있다)
    fireEvent.change(screen.getByLabelText('위도'), { target: { value: '37.4894' } })
    fireEvent.change(screen.getByLabelText('경도'), { target: { value: '126.7246' } })
    const submit = screen.getByRole('button', { name: '이 좌표로 선택' })
    submit.focus()
    fireEvent.click(submit)

    expect(screen.getByText('37.4894, 126.7246', { selector: '.location__value .mono' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
    expect(document.activeElement).toBe(submit)
    expect(screen.getByLabelText('위도')).toHaveValue('37.4894')
  })

  it('POST /analyze body는 선택 좌표·업종코드와 정확히 같고, 성공 응답을 결과 화면에 보여 준다', async () => {
    let respond!: (r: { status: number; body: unknown }) => void
    const pending = new Promise<{ status: number; body: unknown }>((r) => (respond = r))
    const fetchMock = mockApi({ analyze: [pending] })
    render(<App />)
    await selectBupyeongPcBang()

    fireEvent.click(analyzeButton())

    const [[, init]] = analyzeCalls(fetchMock) as [[string, RequestInit]]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })

    // loading: 버튼 잠김, 조건 잠김, 지도 클릭 무시
    expect(analyzeButton()).toHaveTextContent('분석 중…')
    expect(analyzeButton()).toHaveAttribute('aria-busy', 'true')
    expect(analyzeButton()).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '업종' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')

    await act(async () => respond({ status: 200, body: fixture }))

    expect(await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    expect(within(overall).getByText(String(fixture.result.종합.점수))).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: '분석 조건' })).getByText('부평구 부평1동')).toBeInTheDocument()
    // 분석된 행정동 = backend context → 지도 경계 강조
    expect(screen.getByTestId('map')).toHaveAttribute('data-dong', '28237 부평1동')
  })

  it('새 위치를 고르면 이전 결과가 남지 않는다', async () => {
    const fetchMock = mockApi({ analyze: [{ status: 200, body: fixture }] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    expect(await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))

    expect(screen.queryByRole('heading', { name: /분석$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '종합 적합도' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '분석 조건' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '어디에, 어떤 가게를 열까요?' })).toBeInTheDocument()   // 분석 전 패널
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.392512,126.639034')
    expect(screen.getByTestId('map')).toHaveAttribute('data-dong', '')
    // 업종은 유지 → 바로 다시 분석할 수 있다
    expect(analyzeButton()).toBeEnabled()
    expect(analyzeCalls(fetchMock)).toHaveLength(1)
  })

  it('결과 화면 위치 표시는 행정동 이름 중심이고, 좌표는 접혀 있으며, 새 위치를 고르면 갱신된다', async () => {
    mockApi({ analyze: [{ status: 200, body: fixture }] })
    const { container } = render(<App />)
    await selectBupyeongPcBang()
    const sheet = () => container.querySelector<HTMLElement>('.map-sheet')!
    // 분석 전: 행정동은 아직 모른다 → 고른 좌표만
    expect(sheet()).toHaveTextContent('선택됨 · 37.4894, 126.7246')

    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(screen.getByRole('group', { name: '분석 조건' })).toHaveTextContent('부평구 부평1동')
    expect(document.querySelector('.result__sub')).toHaveTextContent('부평역까지 직선거리 85m')
    expect(document.querySelector('.map-sheet')).toHaveTextContent('부평구 부평1동 · 부평역 85m')
    expect(sheet()).not.toHaveTextContent('37.4894')
    // 결과 패널: 상세 근거 탭의 "위치" — 최근접역 + 접힌 좌표
    const summary = getInTab(EVIDENCE_TAB, 'region', { name: '위치' })
    expect(summary).toHaveTextContent('가장 가까운 역 부평역 · 직선거리 85m')
    expect(summary).not.toHaveTextContent('37.4894')
    fireEvent.click(within(summary as HTMLElement).getByRole('button', { name: '좌표 보기' }))
    expect(summary).toHaveTextContent('분석 좌표(WGS84) 37.4894, 126.7246')

    // 새 위치: 이전 행정동 이름·역 정보가 남지 않고 새 좌표가 보인다
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    expect(sheet()).toHaveTextContent('선택됨 · 37.392512, 126.639034')
    expect(sheet()).not.toHaveTextContent('부평')
    expect(screen.queryByRole('group', { name: '분석 조건' })).not.toBeInTheDocument()
  })

  it('업종을 바꿔도 이전 결과가 남지 않는다 (조건 변경)', async () => {
    mockApi({ analyze: [{ status: 200, body: fixture }] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })

    fireEvent.click(screen.getByRole('button', { name: '조건 바꾸기' }))
    fireEvent.change(screen.getByRole('combobox', { name: '업종' }), { target: { value: 'R10407' } })

    expect(screen.queryByRole('region', { name: '종합 적합도' })).not.toBeInTheDocument()
    expect(analyzeButton()).toBeEnabled()
  })
})

describe('분석 오류 — error.code로 분기', () => {
  const apiError = (status: number, code: string, message = '아무 문장') => ({ status, body: { error: { code, message } } })

  it.each([
    ['location_outside', '인천 안의 위치를 선택해 주세요', 'invalid'],
    ['no_data_nearby', '주변 500m 안에 상가 데이터가 없어요', 'invalid'],
    ['invalid_coordinate', '좌표를 확인할 수 없습니다', 'invalid'],
    ['invalid_business', '지원하지 않는 업종입니다', 'selected'],
    ['invalid_request', '요청 값이 올바르지 않습니다', 'selected'],
  ])('422 %s → "%s"', async (code, title, tone) => {
    mockApi({ analyze: [apiError(422, code)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).not.toHaveTextContent('아무 문장')          // message로 분기·표시하지 않는다
    expect(screen.getByTestId('map')).toHaveAttribute('data-tone', tone)
  })

  it('500 internal_error → request_id를 작은 문의 코드로 보여 주고 복사할 수 있다', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    mockApi({ analyze: [{ status: 500, body: internalError }] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('분석 중 문제가 생겼습니다')
    expect(alert).toHaveTextContent('문의 코드 3f2a9c0e…')
    fireEvent.click(within(alert).getByRole('button', { name: /문의 코드 .* 복사/ }))
    expect(writeText).toHaveBeenCalledWith(internalError.error.request_id)
    expect(await within(alert).findByText('복사됨')).toBeInTheDocument()
  })

  it('다시 시도하면 같은 조건으로 다시 요청한다', async () => {
    const fetchMock = mockApi({ analyze: [{ status: 500, body: internalError }, { status: 200, body: fixture }] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))

    expect(await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    const bodies = analyzeCalls(fetchMock).map(([, init]) => (init as RequestInit).body)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
  })

  it('응답이 없으면 네트워크 오류를 보여 준다', async () => {
    mockApi({ analyze: ['network-error'] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다')
  })

  it.each([
    ['schema와 다른 성공 응답', { status: 200, body: { ...fixture, result: { ...fixture.result, 종합: null } } }],
    ['요청과 다른 좌표의 응답', { status: 200, body: { ...fixture, context: { ...fixture.context, lat: 37.5 } } }],
    ['오류 계약과 다른 422 응답', { status: 422, body: { detail: [{ msg: 'x' }] } }],
  ])('%s → 결과를 보여 주지 않고 오류로 알린다', async (_, reply) => {
    mockApi({ analyze: [reply] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('분석 결과를 표시할 수 없습니다')
    expect(screen.queryByRole('region', { name: '종합 적합도' })).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalled()
  })
})

describe('반경 안 같은 업종 점포 (POST /nearby-stores, 4차)', () => {
  const NEARBY = '반경 500m 안 같은 업종 점포'

  async function analyzeBupyeong(nearby: Reply[]) {
    const fetchMock = mockApi({ analyze: [{ status: 200, body: fixture }], nearby })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    return fetchMock
  }

  it('분석 성공 뒤 같은 좌표·업종으로 조회하고, 엔진 동종점포수와 같은 수를 가까운 순으로 보여 준다', async () => {
    const fetchMock = await analyzeBupyeong([{ status: 200, body: nearbyFixture }])
    const [[, init]] = nearbyCalls(fetchMock) as [[string, RequestInit]]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })

    const section = await findInTab(STORES_TAB, 'region', { name: NEARBY })
    const list = await within(section).findByRole('list', { name: 'PC방 점포 목록' })
    expect(fixture.result.지표[2]!.raw.동종점포수).toBe(12)               // 엔진 경쟁성.raw.동종점포수 == 목록 수
    expect(section).toHaveTextContent('PC방 12곳 · 가까운 순')
    expect(section).toHaveTextContent('상가정보 2026-06-30 기준')
    expect(section).not.toHaveTextContent('분석의 동종 점포 수')        // 수가 같으면 불일치 경고 없음
    const items = within(list).getAllByRole('button')
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveTextContent(nearbyFixture.stores[0]!.name)
    expect(items[0]).toHaveTextContent('직선거리 115m')
    fireEvent.click(within(section).getByRole('button', { name: '모두 보기 (12곳)' }))
    expect(within(list).getAllByRole('button')).toHaveLength(12)
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
  })

  it('목록을 누르면 지도 점포가 선택되고, 지도 마커를 누르면 목록이 선택된다', async () => {
    await analyzeBupyeong([{ status: 200, body: nearbyFixture }])
    const list = await findList('PC방 점포 목록')
    const first = within(list).getAllByRole('button')[0]!
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', nearbyFixture.stores[0]!.id)

    fireEvent.click(screen.getByRole('button', { name: `지도 점포 마커: ${nearbyFixture.stores[1]!.name}` }))
    expect(within(list).getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true')
    expect(first).toHaveAttribute('aria-pressed', 'false')
  })

  it('키보드로 목록 점포를 열고 Escape로 닫아도 분석 결과·목록·마커는 그대로이고 포커스가 남는다', async () => {
    await analyzeBupyeong([{ status: 200, body: nearbyFixture }])
    const list = await findList('PC방 점포 목록')
    const item = within(list).getAllByRole('button')[2]!
    item.focus()
    fireEvent.click(item)                                          // Enter·Space = 버튼 click
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', nearbyFixture.stores[2]!.id)

    fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', '')
    expect(item).toHaveAttribute('aria-pressed', 'false')
    expect(document.activeElement).toBe(item)
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
    expect(within(list).getAllByRole('button')).toHaveLength(5)
    expect(screen.getByRole('region', { name: '종합 적합도' })).toBeInTheDocument()
  })

  it('"지도에 표시"를 끄면 마커와 선택을 지우고, 다시 켜면 마커를 그린다', async () => {
    await analyzeBupyeong([{ status: 200, body: nearbyFixture }])
    const toggle = await findInTab(STORES_TAB, 'checkbox', { name: '지도에 표시' })
    expect(toggle).toBeChecked()
    fireEvent.click(within(getList('PC방 점포 목록')).getAllByRole('button')[0]!)
    fireEvent.click(toggle)
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', '')
    fireEvent.click(toggle)
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
  })

  it('조회가 실패해도 분석 결과는 그대로이고, 다시 시도할 수 있다', async () => {
    await analyzeBupyeong([{ status: 500, body: internalError }, { status: 200, body: nearbyFixture }])
    expect(await screen.findByText(/점포 목록을 불러오지 못했습니다/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '종합 적합도' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')

    fireEvent.click(within(getInTab(STORES_TAB, 'region', { name: NEARBY })).getByRole('button', { name: '다시 시도' }))
    expect(await findList('PC방 점포 목록')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
  })

  it('새 위치를 고르면 목록·마커를 지우고, 늦게 도착한 이전 조회 응답은 버린다', async () => {
    let respond!: (r: { status: number; body: unknown }) => void
    const late = new Promise<{ status: number; body: unknown }>((r) => (respond = r))
    await analyzeBupyeong([late])
    expect(await screen.findByText('점포 목록을 불러오는 중…')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    await act(async () => respond({ status: 200, body: nearbyFixture }))

    expect(queryInTab(STORES_TAB, 'region', { name: NEARBY })).not.toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')
  })

  it('조건 변경으로 결과를 지우면 목록·마커도 지운다', async () => {
    await analyzeBupyeong([{ status: 200, body: nearbyFixture }])
    await findList('PC방 점포 목록')
    fireEvent.click(screen.getByRole('button', { name: '조건 바꾸기' }))
    expect(queryInTab(STORES_TAB, 'region', { name: NEARBY })).not.toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')
  })

  it('응답 조건이 요청과 다르면(다른 업종) 쓰지 않고 오류로 보여 준다', async () => {
    await analyzeBupyeong([{ status: 200, body: { ...nearbyFixture, biz_code: 'R10407' } }])
    expect(await screen.findByText(/점포 목록을 불러오지 못했습니다/)).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')
  })

  it('목록 수가 분석의 동종 점포 수와 다르면 경고한다', async () => {
    await analyzeBupyeong([{ status: 200, body: { ...nearbyFixture, count: 0, stores: [] } }])
    const section = await findInTab(STORES_TAB, 'region', { name: NEARBY })
    await waitFor(() => expect(section).toHaveTextContent('목록 수(0곳)가 분석의 동종 점포 수(12곳)와 다릅니다'))
    expect(section).toHaveTextContent('반경 500m 안에 같은 업종 점포가 없습니다')
  })
})

describe('두 위치 비교 — B 분석 상태 (5차-B2, docs/COMPARE_DESIGN.md 3장)', () => {
  const PANEL = '두 위치 비교 · PC방'
  const panel = () => screen.getByRole('region', { name: PANEL })
  const sheet = () => document.querySelector<HTMLElement>('.map-sheet')!
  const bCard = () => within(panel()).getByRole('region', { name: 'B 비교 위치' })
  const aCard = () => within(panel()).getByRole('region', { name: 'A 기준 위치' })
  /** 비교 요약의 점수 표 종합 행 (B 성공 뒤) */
  const overallRow = () => within(getScoreTable()).getAllByRole('row')[1]!
  const ok = (body: unknown) => ({ status: 200, body })

  /**
   * A(부평역·PC방) 분석과 A 점포 목록까지 마친 상태. analyze 뒤쪽 replies는 B 분석, bNearby는 B 점포 조회(5차-B5)에 차례로 쓰인다.
   * B 점포 응답을 주지 않으면 그 조회는 네트워크 실패가 된다(분석 결과와 무관)
   */
  async function analyzeA(bReplies: Reply[] = [], bNearby: Reply[] = []) {
    const fetchMock = mockApi({ analyze: [ok(fixture), ...bReplies], nearby: [ok(nearbyFixture), ...bNearby] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    return fetchMock
  }

  const startCompare = () => fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)

  /** B 좌표를 키보드 대안(좌표 입력)으로 고른다 */
  function typeB(lat: number, lng: number) {
    fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: String(lat) } })
    fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: String(lng) } })
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
  }

  const analyzeB = () => fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)
  const pending = () => {
    let respond!: (r: { status: number; body: unknown }) => void
    const promise = new Promise<{ status: number; body: unknown }>((r) => (respond = r))
    return { promise, respond: (r: { status: number; body: unknown }) => respond(r) }
  }

  it('A 결과를 보존한 채 B를 좌표로 고르고 A 업종으로 분석한다. 비교를 끝내면 A 결과·점포 목록이 돌아온다', async () => {
    const fetchMock = await analyzeA([ok(guwolFixture)], [ok(guwolNearbyFixture)])
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')

    startCompare()
    expect(document.activeElement).toBe(within(panel()).getByRole('heading', { name: 'B 비교 위치' }))
    expect(aCard()).toHaveTextContent(/부평구 부평1동\s*종합 65\.8/)
    // 비교 중: A 점포 마커 숨김, 업종 선택 없음, 헤더 "데이터 출처"(대상 섹션이 없다) 숨김
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')
    expect(screen.queryByRole('combobox', { name: '업종' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '데이터 출처' })).not.toBeInTheDocument()
    expect(within(bCard()).getByRole('button', { name: 'B 분석하기' })).toBeDisabled()

    typeB(37.4475, 126.7015)
    expect(bCard()).toHaveTextContent('선택됨 · 37.4475, 126.7015')
    analyzeB()

    expect(bodyOf(analyzeCalls(fetchMock)[1]!)).toEqual({ lat: 37.4475, lng: 126.7015, biz_code: 'R10406' })
    await waitFor(() => expect(bCard()).toHaveTextContent('남동구 구월3동'))
    expect(overallRow()).toHaveTextContent(/종합.*65\.8.*59\.1/)        // 비교 요약 표 (A 65.8, B 59.1)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: PANEL }))
    // A는 그대로: 지도 선택 지점·행정동 경계는 A
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
    expect(screen.getByTestId('map')).toHaveAttribute('data-dong', '28237 부평1동')

    fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))
    expect(screen.queryByRole('region', { name: PANEL })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    expect(within(getList('PC방 점포 목록')).getAllByRole('button')).toHaveLength(5)
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    // 점포 조회는 A 1번 + B 1번(5차-B5). 비교를 끝내도 A 점포를 다시 조회하지 않는다(A 데이터 보존)
    expect(nearbyCalls(fetchMock).map(bodyOf)).toEqual([
      { lat: 37.4894, lng: 126.7246, biz_code: 'R10406' },
      { lat: 37.4475, lng: 126.7015, biz_code: 'R10406' },
    ])
  })

  it('비교 중 지도 클릭은 B 선택이고 A를 바꾸지 않는다. B 분석 중 새 클릭은 무시한다', async () => {
    const b = pending()
    const fetchMock = await analyzeA([b.promise])
    startCompare()

    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    expect(bCard()).toHaveTextContent('선택됨 · 37.392512, 126.639034')
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
    expect(aCard()).toHaveTextContent('부평구 부평1동')

    analyzeB()
    const button = within(bCard()).getByRole('button', { name: 'B 분석 중…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(within(bCard()).getByLabelText('B 위도')).toBeDisabled()
    expect(bCard()).toHaveTextContent('B 위치 분석 중…')

    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))   // 무시
    expect(bCard()).toHaveTextContent('선택됨 · 37.392512, 126.639034')
    expect(analyzeCalls(fetchMock)).toHaveLength(2)

    await act(async () => b.respond(ok(songdoFixture)))
    expect(bCard()).toHaveTextContent('연수구 송도2동')
    expect(overallRow()).toHaveTextContent(/65\.8.*64\.9/)
  })

  it('B가 A와 정확히 같은 좌표면 요청하지 않고 안내한다', async () => {
    const fetchMock = await analyzeA()
    startCompare()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    analyzeB()
    expect(within(bCard()).getByRole('alert')).toHaveTextContent('A와 같은 위치입니다. 다른 위치를 고르세요.')
    expect(analyzeCalls(fetchMock)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))    // 다른 위치를 고르면 안내가 사라진다
    expect(within(bCard()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('B 실패: A는 그대로, 포커스는 오류의 행동 버튼, 다시 시도는 같은 조건으로 새로 요청한다', async () => {
    const fetchMock = await analyzeA([{ status: 500, body: internalError }, ok(songdoFixture)])
    startCompare()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    analyzeB()

    const alert = await within(bCard()).findByRole('alert')
    expect(alert).toHaveTextContent('분석 중 문제가 생겼습니다')
    const retry = within(alert).getByRole('button', { name: '다시 시도' })
    expect(document.activeElement).toBe(retry)
    expect(aCard()).toHaveTextContent(/부평구 부평1동\s*종합 65\.8/)
    // 오류 상태: 동작하지 않는 "B 분석하기"는 두지 않는다. 새 좌표 입력은 그대로 쓸 수 있다
    expect(within(bCard()).queryByRole('button', { name: 'B 분석하기' })).not.toBeInTheDocument()
    expect(within(bCard()).getByLabelText('B 위도')).toBeEnabled()

    fireEvent.click(retry)
    await waitFor(() => expect(bCard()).toHaveTextContent('연수구 송도2동'))
    const [, first, second] = analyzeCalls(fetchMock)
    expect(bodyOf(first!)).toEqual({ lat: 37.392512, lng: 126.639034, biz_code: 'R10406' })
    expect(bodyOf(second!)).toEqual(bodyOf(first!))
  })

  it('B가 분석 불가 위치(location_outside)면 "지도에서 다시 선택"으로 B만 다시 고른다', async () => {
    await analyzeA([{ status: 422, body: { error: { code: 'location_outside', message: 'x' } } }])
    startCompare()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    analyzeB()
    const alert = await within(bCard()).findByRole('alert')
    expect(alert).toHaveTextContent('인천 안의 위치를 선택해 주세요')
    fireEvent.click(within(alert).getByRole('button', { name: '지도에서 다시 선택' }))

    expect(within(bCard()).queryByRole('alert')).not.toBeInTheDocument()
    expect(bCard()).toHaveTextContent('지도를 누르거나 아래에 좌표를 입력해 B 위치를 고르세요.')
    expect(aCard()).toHaveTextContent('부평구 부평1동')
  })

  it('B 오류 뒤 새 좌표를 고르면 "B 분석하기"가 다시 나오고 새 위치로 요청한다', async () => {
    const fetchMock = await analyzeA([{ status: 422, body: { error: { code: 'no_data_nearby', message: 'x' } } }, ok(guwolFixture)])
    startCompare()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    analyzeB()
    await within(bCard()).findByRole('alert')
    typeB(37.4475, 126.7015)
    expect(within(bCard()).queryByRole('alert')).not.toBeInTheDocument()
    analyzeB()
    await waitFor(() => expect(bCard()).toHaveTextContent('남동구 구월3동'))
    expect(bodyOf(analyzeCalls(fetchMock)[2]!)).toEqual({ lat: 37.4475, lng: 126.7015, biz_code: 'R10406' })
  })

  it('B 응답 좌표가 요청과 다르면 결과로 쓰지 않고 오류로 알린다', async () => {
    await analyzeA([ok({ ...songdoFixture, context: { ...songdoFixture.context, lat: 37.5 } })])
    startCompare()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    analyzeB()
    expect(await within(bCard()).findByRole('alert')).toHaveTextContent('분석 결과를 표시할 수 없습니다')
    expect(bCard()).not.toHaveTextContent('연수구 송도2동')
  })

  it('B1 요청 → 비교 취소 → 다시 비교·B2 요청 → 늦은 B1 응답은 버린다', async () => {
    const b1 = pending()
    const fetchMock = await analyzeA([b1.promise, ok(guwolFixture)])

    startCompare()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    analyzeB()                                                        // B1 (송도)
    fireEvent.click(screen.getAllByRole('button', { name: '비교 취소' })[0]!)
    expect((analyzeCalls(fetchMock)[1]![1] as RequestInit).signal!.aborted).toBe(true)

    startCompare()
    typeB(37.4475, 126.7015)
    analyzeB()                                                        // B2 (구월)
    await waitFor(() => expect(bCard()).toHaveTextContent('남동구 구월3동'))

    await act(async () => b1.respond(ok(songdoFixture)))             // 늦게 온 B1
    expect(overallRow()).toHaveTextContent(/65\.8.*59\.1/)
    expect(panel()).not.toHaveTextContent('송도')
  })

  it('B 분석 중 조건 변경: A·비교가 모두 정리되고, 늦은 B 응답은 버린다', async () => {
    const b = pending()
    await analyzeA([b.promise])
    startCompare()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    analyzeB()

    fireEvent.click(within(panel()).getByRole('button', { name: '조건 바꾸기' }))
    expect(screen.queryByRole('region', { name: PANEL })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '업종' })).toBeInTheDocument()   // 조건 화면

    await act(async () => b.respond(ok(songdoFixture)))
    expect(screen.queryByRole('region', { name: PANEL })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: /분석$/ })).not.toBeInTheDocument()
    // 조건 화면의 지도 클릭은 다시 단일 분석 위치 선택이다
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.392512,126.639034')
  })

  it('비교를 시작하면 A 점포 선택·정보창을 닫고, 비교 종료 뒤에는 선택 없이 목록·마커만 돌아온다', async () => {
    await analyzeA()
    fireEvent.click(within(getList('PC방 점포 목록')).getAllByRole('button')[0]!)
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', nearbyFixture.stores[0]!.id)

    startCompare()
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', '')
    fireEvent.click(screen.getAllByRole('button', { name: '비교 취소' })[0]!)
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', '')
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
  })

  describe('비교 요약 ↔ 위치별 전체 결과 (5차-B3, §3.3)', () => {
    const header = () => screen.getByRole('group', { name: '비교 조건' })

    async function compareWithGuwol() {
      const fetchMock = await analyzeA([ok(guwolFixture)], [ok(guwolNearbyFixture)])
      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      await findScoreTable()
      return fetchMock
    }

    it('전체 결과로 갔다 돌아와도 다시 요청하지 않고, 제목으로 포커스·복귀 시 누른 버튼으로 돌려준다', async () => {
      const fetchMock = await compareWithGuwol()
      // 비교 요약: 헤더는 A·B, 점포는 기본 기준 B(5차-B5), 데이터 출처는 한 번
      expect(header()).toHaveTextContent('두 위치 비교PC방 · 반경 500m')
      expect(screen.getByRole('region', { name: 'A 기준 위치' })).toHaveTextContent('부평구 부평1동')
      expect(screen.getByRole('region', { name: 'B 비교 위치' })).toHaveTextContent('남동구 구월3동')
      expect(await findList('B 남동구 구월3동 PC방 점포 목록')).toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '6')
      expect(document.querySelectorAll('#data-sources')).toHaveLength(1)
      // 데이터 출처는 상세 근거 탭 안(A3 — 헤더 링크는 없앴다)
      expect(screen.queryByRole('link', { name: '데이터 출처' })).not.toBeInTheDocument()

      // B 전체 결과
      fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
      const bTitle = screen.getByRole('heading', { level: 1, name: 'B · 남동구 구월3동 · PC방 분석' })
      expect(document.activeElement).toBe(bTitle)
      expect(screen.queryByRole('region', { name: PANEL })).not.toBeInTheDocument()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)        // AnalysisResult 하나만
      expect(within(screen.getByRole('region', { name: '종합 적합도' })).getByText('59.1')).toBeInTheDocument()
      expect(header()).toHaveTextContent('두 위치 비교')                          // 조건 바는 비교 조건 그대로
      expect(bTitle).not.toHaveTextContent('부평1동')
      // B 전체 결과에는 B 점포만 (A 점포를 보이지 않는다)
      expect(getList('B 남동구 구월3동 PC방 점포 목록')).toBeInTheDocument()
      expect(queryList(/부평1동 PC방 점포 목록/)).not.toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '6')
      expect(document.querySelectorAll('#data-sources')).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)

      // A 전체 결과
      fireEvent.click(screen.getAllByRole('button', { name: 'A 전체 결과 보기' })[0]!)
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'A · 부평구 부평1동 · PC방 분석' }))
      expect(within(screen.getByRole('region', { name: '종합 적합도' })).getByText('65.8')).toBeInTheDocument()
      expect(getList('A 부평구 부평1동 PC방 점포 목록')).toBeInTheDocument()   // A 전체 → A 점포
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'A 전체 결과 보기' })[0]!)
      expect(overallRow()).toHaveTextContent(/65\.8.*59\.1/)

      expect(analyzeCalls(fetchMock)).toHaveLength(2)                             // A 1번 + B 1번
      expect(nearbyCalls(fetchMock)).toHaveLength(2)                              // 점포도 A 1번 + B 1번 — 화면을 오가도 다시 조회하지 않는다
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '6')        // 요약으로 돌아오면 기준 B 그대로

      // 비교 종료 → A 단일 결과·A 점포 목록·마커 복원
      fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))
      expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
      expect(getList('PC방 점포 목록')).toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
      expect(nearbyCalls(fetchMock)).toHaveLength(2)
    })

    it('요약 / A 전체 / B 전체 각 화면에서 id가 유일하고 접근성 참조가 이어진다 (펼친 뒤 aria-controls)', async () => {
      await compareWithGuwol()
      const check = (where: string) => {
        expect(duplicateIds(), where).toEqual([])
        expect(brokenReferences(), where).toEqual([])
        expandAll(document.querySelector('.workspace__panel')!)
        expect(duplicateIds(), `${where} (펼친 뒤)`).toEqual([])
        expect(brokenReferences(), `${where} (펼친 뒤)`).toEqual([])
        expect(brokenControls(), `${where} (펼친 뒤)`).toEqual([])
      }
      check('비교 요약')
      fireEvent.click(screen.getAllByRole('button', { name: 'A 전체 결과 보기' })[0]!)
      check('A 전체 결과')
      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
      check('B 전체 결과')
    })

    it('전체 결과에서 비교를 끝내고 다시 비교하면 요약부터 보인다', async () => {
      await analyzeA([ok(guwolFixture), ok(songdoFixture)])
      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      fireEvent.click(await screen.findByRole('button', { name: 'B 전체 결과 보기' }))
      fireEvent.click(within(sheet()).getByRole('button', { name: '비교 종료' }))   // mobile sheet의 종료(같은 동작)
      expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()

      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()
      await findScoreTable()     // 전체 결과가 아니라 요약부터
      expect(overallRow()).toHaveTextContent(/65\.8.*64\.9/)
      expect(screen.queryByRole('button', { name: '비교로 돌아가기' })).not.toBeInTheDocument()
    })

    it('요약의 "B 위치 다시 고르기"는 B 고르기로 돌아가고 A는 그대로다', async () => {
      await compareWithGuwol()
      fireEvent.click(screen.getByRole('button', { name: 'B 다시 고르기' }))
      expect(within(bCard()).getByLabelText('B 위도')).toBeInTheDocument()
      expect(aCard()).toHaveTextContent(/부평구 부평1동\s*종합 65\.8/)
      expect(document.activeElement).toBe(within(panel()).getByRole('heading', { name: 'B 비교 위치' }))
    })
  })

  describe('지도 A/B 표시 값 (5차-B4)', () => {
    const map = () => screen.getByTestId('map')

    it('B 선택·분석 중·성공에 따라 B 위치·안내·행정동을 넘기고, 화면을 오가도 같으며, 종료하면 지운다', async () => {
      const b = pending()
      await analyzeA([b.promise])
      expect(map()).not.toHaveAttribute('data-compare')

      startCompare()
      expect(map()).toHaveAttribute('data-compare', 'on')
      expect(map()).toHaveAttribute('data-compare-location', '')
      expect(map()).toHaveAttribute('data-compare-guide', 'B 위치를 고르세요 · A: 부평구 부평1동')
      expect(map()).toHaveAttribute('data-selected', '37.4894,126.7246')     // A는 그대로

      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      expect(map()).toHaveAttribute('data-compare-location', '37.392512,126.639034')
      expect(map()).toHaveAttribute('data-compare-guide', 'B 위치를 골랐습니다 · "B 분석하기"로 분석합니다')
      expect(map()).toHaveAttribute('data-compare-dong', '')

      analyzeB()
      expect(map()).toHaveAttribute('data-compare-guide', 'B 위치 분석 중…')
      expect(map()).toHaveAttribute('data-interactive', 'false')               // 분석 중 클릭 무시
      expect(map()).toHaveAttribute('data-compare-dong', '')                   // 성공 전에는 B 경계 없음

      await act(async () => b.respond(ok(songdoFixture)))
      expect(map()).toHaveAttribute('data-interactive', 'true')
      expect(map()).toHaveAttribute('data-compare-dong', '28185 송도2동')
      expect(map()).toHaveAttribute('data-compare-tone', 'selected')
      expect(map()).toHaveAttribute('data-compare-guide', '지도를 누르면 B 위치를 다시 고릅니다')
      const shown = () =>
        ['data-selected', 'data-dong', 'data-compare-location', 'data-compare-dong', 'data-compare-tone'].map((k) => map().getAttribute(k))
      const summary = shown()

      fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
      expect(shown()).toEqual(summary)
      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      fireEvent.click(screen.getAllByRole('button', { name: 'A 전체 결과 보기' })[0]!)
      expect(shown()).toEqual(summary)
      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))

      fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))
      expect(map()).not.toHaveAttribute('data-compare')
      expect(map()).toHaveAttribute('data-selected', '37.4894,126.7246')
      expect(map()).toHaveAttribute('data-dong', '28237 부평1동')
    })

    it.each([
      ['location_outside', 'invalid', 422],
      ['no_data_nearby', 'invalid', 422],
      ['invalid_coordinate', 'invalid', 422],
      ['internal_error', 'selected', 500],
    ])('B 오류 %s → 지도 B 표시 %s (분석 불가 위치만 회색·반경 없음)', async (code, tone, status) => {
      const body = code === 'internal_error' ? internalError : { error: { code, message: 'x' } }
      await analyzeA([{ status, body }])
      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()
      await within(bCard()).findByRole('alert')
      expect(map()).toHaveAttribute('data-compare-tone', tone)
      expect(map()).toHaveAttribute('data-compare-location', '37.392512,126.639034')
      expect(map()).toHaveAttribute('data-compare-dong', '')
      expect(map()).toHaveAttribute('data-compare-guide', 'B 위치를 다시 고르세요 · A: 부평구 부평1동')
    })

    it('네트워크 오류도 위치 오류로 보지 않는다', async () => {
      await analyzeA(['network-error'])
      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()
      await within(bCard()).findByRole('alert')
      expect(map()).toHaveAttribute('data-compare-tone', 'selected')
    })

    it('B 다시 고르기·취소 뒤에는 이전 B 위치·경계를 넘기지 않는다', async () => {
      await analyzeA([ok(songdoFixture)])
      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()
      await findScoreTable()
      expect(map()).toHaveAttribute('data-compare-dong', '28185 송도2동')

      fireEvent.click(screen.getByRole('button', { name: 'B 다시 고르기' }))
      expect(map()).toHaveAttribute('data-compare-location', '')
      expect(map()).toHaveAttribute('data-compare-dong', '')

      fireEvent.click(screen.getAllByRole('button', { name: '비교 취소' })[0]!)
      expect(map()).not.toHaveAttribute('data-compare')
    })

    it('B 성공 뒤 패널 포커스(비교 제목)는 지도 갱신으로 바뀌지 않는다', async () => {
      await analyzeA([ok(guwolFixture)])
      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      await findScoreTable()
      expect(map()).toHaveAttribute('data-compare-dong', '28200 구월3동')
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: PANEL }))
    })
  })

  describe('비교 중 동종 점포 조회·기준 전환 (5차-B5, §3.3·4.3)', () => {
    const map = () => screen.getByTestId('map')
    const B_LIST = 'B 남동구 구월3동 PC방 점포 목록'
    const A_LIST = 'A 부평구 부평1동 PC방 점포 목록'
    const sideButton = (name: RegExp) => within(getInTab(STORES_TAB, 'group', { name: '점포 기준 위치' })).getByRole('button', { name })
    const items = (list: string) => within(getList(list)).getAllByRole('button')

    /** A 분석 → 비교 → B(구월3동) 분석 성공까지. bNearby는 B 점포 조회 응답들 */
    async function compareGuwol(bNearby: Reply[] = [ok(guwolNearbyFixture)], more: Reply[] = []) {
      const fetchMock = await analyzeA([ok(guwolFixture), ...more], bNearby)
      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      await findScoreTable()
      return fetchMock
    }

    it('B 성공 뒤 같은 좌표·업종으로 B 점포를 조회하고, 기본 기준은 B다 (제목·개수·막대에 A/B와 위치)', async () => {
      const fetchMock = await compareGuwol()
      expect(bodyOf(nearbyCalls(fetchMock)[1]!)).toEqual({ lat: 37.4475, lng: 126.7015, biz_code: 'R10406' })
      expect(await findList(B_LIST)).toBeInTheDocument()
      const region = getInTab(STORES_TAB, 'region', { name: /반경 500m 안 같은 업종 점포/ })
      expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent('반경 500m 안 같은 업종 점포 · B 남동구 구월3동')
      expect(region).toHaveTextContent('B 남동구 구월3동 · PC방 6곳')
      expect(region).not.toHaveTextContent('목록 수(')                       // 6곳 == B 동종점포수 6
      expect(sideButton(/^B 구월3동$/)).toHaveAttribute('aria-pressed', 'true')
      expect(sideButton(/^A 부평1동$/)).toHaveAttribute('aria-pressed', 'false')
      expect(map()).toHaveAttribute('data-stores', '6')
      expect(map()).toHaveAttribute('data-store-context', 'B 구월3동 주변')
    })

    it('A/B 전환: 다시 조회하지 않고 목록·마커를 바꾸며, 선택·정보창을 해제하고, 펼침 상태가 섞이지 않는다', async () => {
      const fetchMock = await compareGuwol()
      await findList(B_LIST)
      fireEvent.click(screen.getByRole('button', { name: '모두 보기 (6곳)' }))
      expect(items(B_LIST)).toHaveLength(6)
      fireEvent.click(items(B_LIST)[5]!)
      expect(map()).toHaveAttribute('data-active-store', guwolNearbyFixture.stores[5]!.id)

      sideButton(/^A 부평1동$/).focus()
      fireEvent.click(sideButton(/^A 부평1동$/))
      expect(map()).toHaveAttribute('data-active-store', '')                 // 선택·정보창 해제
      expect(map()).toHaveAttribute('data-stores', '12')
      expect(map()).toHaveAttribute('data-store-context', 'A 부평1동 주변')
      expect(items(A_LIST)).toHaveLength(5)                                  // A는 접힌 상태(B의 펼침이 섞이지 않음)
      expect(queryList(B_LIST)).not.toBeInTheDocument()
      expect(sideButton(/^A 부평1동$/)).toHaveAttribute('aria-pressed', 'true')
      expect(document.activeElement).toBe(sideButton(/^A 부평1동$/))         // 목록이 새로 그려져도 누른 버튼에

      fireEvent.click(sideButton(/^B 구월3동$/))
      expect(items(B_LIST)).toHaveLength(5)                                  // 다시 접힌 상태로 시작
      expect(map()).toHaveAttribute('data-stores', '6')
      expect(nearbyCalls(fetchMock)).toHaveLength(2)                         // 전환해도 다시 조회하지 않는다
    })

    it('전체 결과는 그 위치의 점포, 요약으로 돌아오면 열기 전 기준을 되살린다', async () => {
      await compareGuwol()
      await findList(B_LIST)
      fireEvent.click(sideButton(/^A 부평1동$/))                               // 요약 기준 A
      fireEvent.click(items(A_LIST)[0]!)
      expect(map()).not.toHaveAttribute('data-active-store', '')

      fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
      expect(getList(B_LIST)).toBeInTheDocument()
      expect(queryList(A_LIST)).not.toBeInTheDocument()
      expect(map()).toHaveAttribute('data-stores', '6')
      expect(map()).toHaveAttribute('data-active-store', '')
      expect(screen.queryByRole('group', { name: '점포 기준 위치' })).not.toBeInTheDocument()   // 전환은 요약에만

      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      expect(sideButton(/^A 부평1동$/)).toHaveAttribute('aria-pressed', 'true')   // 열기 전 기준 A 복원
      expect(map()).toHaveAttribute('data-stores', '12')
      expect(map()).toHaveAttribute('data-active-store', '')
    })

    it('B가 0곳이면 B 목록은 없다고 표시하고 마커가 없다 (경쟁성 미산출 위치)', async () => {
      await analyzeA([ok(songdoFixture)], [ok(songdoNearbyFixture)])
      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()
      const region = await screen.findByText('반경 500m 안에 같은 업종 점포가 없습니다.')
      expect(region).toBeInTheDocument()
      expect(screen.getByText(/B 연수구 송도2동 · PC방 0곳/)).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: '지도에 표시' })).not.toBeInTheDocument()
      expect(screen.queryByText(/목록 수\(/)).not.toBeInTheDocument()
      expect(map()).toHaveAttribute('data-stores', '0')
    })

    it('B 점포 조회가 실패해도 A·B 분석 결과는 그대로이고, 점포만 같은 조건으로 다시 조회한다', async () => {
      const fetchMock = await compareGuwol([{ status: 500, body: internalError }, ok(guwolNearbyFixture)])
      const region = await findInTab(STORES_TAB, 'region', { name: /반경 500m 안 같은 업종 점포/ })
      expect(await within(region).findByText(/점포 목록을 불러오지 못했습니다. 분석 결과는 그대로입니다./)).toBeInTheDocument()
      expect(overallRow()).toHaveTextContent(/65\.8.*59\.1/)
      expect(map()).toHaveAttribute('data-stores', '')

      openTab(STORES_TAB)                                                     // 점수 표를 보느라 연 상세 근거 탭에서 돌아온다
      fireEvent.click(within(region).getByRole('button', { name: '다시 시도' }))
      expect(await findList(B_LIST)).toBeInTheDocument()
      expect(analyzeCalls(fetchMock)).toHaveLength(2)                         // 분석은 다시 요청하지 않는다
      const [, b1, b2] = nearbyCalls(fetchMock).map(bodyOf)
      expect(b2).toEqual(b1)
    })

    it('B 목록 수가 B의 동종점포수와 다르면 경고한다 (A가 아니라 지금 기준 위치와 대조)', async () => {
      await compareGuwol([ok({ ...guwolNearbyFixture, count: 12, stores: nearbyFixture.stores })])
      const region = await findInTab(STORES_TAB, 'region', { name: /반경 500m 안 같은 업종 점포/ })
      await waitFor(() => expect(region).toHaveTextContent('목록 수(12곳)가 분석의 동종 점포 수(6곳)와 다릅니다'))
      fireEvent.click(sideButton(/^A 부평1동$/))
      expect(getInTab(STORES_TAB, 'region', { name: /반경 500m 안 같은 업종 점포/ })).not.toHaveTextContent('목록 수(')
    })

    it('B 고르기·분석 중·분석 실패에는 점포 목록·마커가 없다', async () => {
      const b = pending()
      await analyzeA([b.promise])
      startCompare()
      expect(map()).toHaveAttribute('data-stores', '')
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()
      expect(queryInTab(STORES_TAB, 'region', { name: /반경 500m 안 같은 업종 점포/ })).not.toBeInTheDocument()
      expect(map()).toHaveAttribute('data-stores', '')
      await act(async () => b.respond({ status: 422, body: { error: { code: 'location_outside', message: 'x' } } }))
      expect(queryInTab(STORES_TAB, 'region', { name: /반경 500m 안 같은 업종 점포/ })).not.toBeInTheDocument()
      expect(map()).toHaveAttribute('data-stores', '')
    })

    it.each([
      ['비교 종료', () => fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))],
      ['조건 바꾸기', () => fireEvent.click(within(panel()).getByRole('button', { name: '조건 바꾸기' }))],
    ])('B 점포 조회 중 %s → 늦게 온 B 점포 응답은 버린다', async (_, act1) => {
      const late = pending()
      const fetchMock = await compareGuwol([late.promise])
      expect(nearbyCalls(fetchMock)).toHaveLength(2)
      const signal = (nearbyCalls(fetchMock)[1]![1] as RequestInit).signal!
      act1()
      expect(signal.aborted).toBe(true)
      await act(async () => late.respond(ok(guwolNearbyFixture)))
      expect(queryList(B_LIST)).not.toBeInTheDocument()
      expect(map()).not.toHaveAttribute('data-store-context')
    })

    it('B1 점포 조회 중 → B 다시 고르기 → B2 성공 → 늦은 B1 점포 응답은 버린다', async () => {
      const b1Stores = pending()
      const fetchMock = await compareGuwol([b1Stores.promise, ok(songdoNearbyFixture)], [ok(songdoFixture)])
      const b1Signal = (nearbyCalls(fetchMock)[1]![1] as RequestInit).signal!
      fireEvent.click(screen.getByRole('button', { name: 'B 다시 고르기' }))
      expect(b1Signal.aborted).toBe(true)                                     // 다시 고르면 B1 점포 요청을 바로 취소
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()                                                              // B2 (송도, 0곳)
      expect(await screen.findByText('반경 500m 안에 같은 업종 점포가 없습니다.')).toBeInTheDocument()

      await act(async () => b1Stores.respond(ok(guwolNearbyFixture)))        // 늦은 B1(구월 6곳)
      expect(screen.getByText('반경 500m 안에 같은 업종 점포가 없습니다.')).toBeInTheDocument()
      expect(queryList(B_LIST)).not.toBeInTheDocument()
      expect(map()).toHaveAttribute('data-stores', '0')
      expect(map()).toHaveAttribute('data-store-context', 'B 송도2동 주변')
    })

    it('비교 종료 뒤 A 점포와 표시 설정("지도에 표시")을 되살린다', async () => {
      await analyzeA([ok(guwolFixture)], [ok(guwolNearbyFixture)])
      fireEvent.click(getInTab(STORES_TAB, 'checkbox', { name: '지도에 표시' }))    // A 단일 결과에서 끔
      expect(map()).toHaveAttribute('data-stores', '')

      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      await findList(B_LIST)
      expect(getInTab(STORES_TAB, 'checkbox', { name: '지도에 표시' })).toBeChecked()  // 비교는 따로(기본 켬)
      expect(map()).toHaveAttribute('data-stores', '6')

      fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))
      expect(getList('PC방 점포 목록')).toBeInTheDocument()
      expect(getInTab(STORES_TAB, 'checkbox', { name: '지도에 표시' })).not.toBeChecked()
      expect(map()).toHaveAttribute('data-stores', '')
      expect(map()).not.toHaveAttribute('data-store-context')
    })

    it('비교 요약 목록에서도 Escape는 선택만 지우고 포커스는 그 항목에 남는다', async () => {
      await compareGuwol()
      await findList(B_LIST)
      const item = items(B_LIST)[1]!
      item.focus()
      fireEvent.click(item)
      expect(map()).toHaveAttribute('data-active-store', guwolNearbyFixture.stores[1]!.id)
      fireEvent.keyDown(item, { key: 'Escape' })
      expect(map()).toHaveAttribute('data-active-store', '')
      expect(document.activeElement).toBe(item)
      expect(overallRow()).toHaveTextContent(/65\.8.*59\.1/)
    })

    it('지도 점포 마커를 누르면 지금 기준 위치의 목록 항목이 선택된다', async () => {
      await compareGuwol()
      await findList(B_LIST)
      fireEvent.click(screen.getByRole('button', { name: `지도 점포 마커: ${guwolNearbyFixture.stores[1]!.name}` }))
      expect(items(B_LIST)[1]).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('B 좌표 직접 입력 뒤 포커스 (5차-B2 보완)', () => {
    const latInput = () => within(bCard()).getByLabelText('B 위도')
    const lngInput = () => within(bCard()).getByLabelText('B 경도')
    const analyzeBButton = () => within(bCard()).getByRole('button', { name: 'B 분석하기' })
    function fill(lat: string, lng: string) {
      fireEvent.change(latInput(), { target: { value: lat } })
      fireEvent.change(lngInput(), { target: { value: lng } })
    }
    /** 입력란에서 Enter = 폼 암묵 제출 (jsdom은 Enter 키로 submit을 일으키지 않아 submit 이벤트로 대신한다) */
    function pressEnterIn(input: HTMLElement) {
      input.focus()
      fireEvent.submit(input.closest('form')!)
    }

    it('최초 입력을 제출 버튼으로 내면 "B 분석하기"로 포커스가 간다 (body로 빠지지 않는다)', async () => {
      await analyzeA()
      startCompare()
      fill('37.4475', '126.7015')
      const submit = within(bCard()).getByRole('button', { name: 'B 위치로 선택' })
      submit.focus()
      fireEvent.click(submit)

      expect(submit).not.toBeInTheDocument()                     // 입력란이 새 좌표로 다시 그려진다
      expect(document.activeElement).not.toBe(document.body)
      expect(document.activeElement).toBe(analyzeBButton())
      expect(analyzeBButton()).toBeEnabled()
      expect(bCard()).toHaveTextContent('선택됨 · 37.4475, 126.7015')
    })

    it('입력란에서 Enter로 제출해도 "B 분석하기"로 간다', async () => {
      await analyzeA()
      startCompare()
      fill('37.4475', '126.7015')
      pressEnterIn(lngInput())
      expect(document.activeElement).toBe(analyzeBButton())
    })

    it('좌표를 고쳐 다시 제출해도 "B 분석하기"로 가고, 고친 좌표가 반영된다', async () => {
      await analyzeA()
      startCompare()
      fill('37.4475', '126.7015')
      pressEnterIn(latInput())
      expect(latInput()).toHaveValue('37.4475')

      fireEvent.change(latInput(), { target: { value: '37.448' } })   // 수정
      pressEnterIn(latInput())
      expect(document.activeElement).toBe(analyzeBButton())
      expect(bCard()).toHaveTextContent('선택됨 · 37.448, 126.7015')
      expect(latInput()).toHaveValue('37.448')
    })

    it('잘못된 좌표를 내면 분석 버튼으로 옮기지 않고, 포커스는 낸 자리에 남는다', async () => {
      await analyzeA()
      startCompare()
      fill('137', '126.7015')
      const submit = within(bCard()).getByRole('button', { name: 'B 위치로 선택' })
      submit.focus()
      fireEvent.click(submit)
      expect(document.activeElement).toBe(submit)
      expect(latInput()).toHaveAttribute('aria-invalid', 'true')
      expect(bCard()).toHaveTextContent('위도는 -90~90 사이 숫자입니다')
      expect(analyzeBButton()).toBeDisabled()                      // B 좌표는 선택되지 않았다

      pressEnterIn(latInput())                                      // Enter도 같다
      expect(document.activeElement).toBe(latInput())
    })

    it('지도 클릭은 입력값만 갱신하고 패널로 포커스를 빼앗지 않는다', async () => {
      await analyzeA()
      startCompare()
      const mapClick = screen.getByRole('button', { name: '지도 클릭: 송도' })
      mapClick.focus()
      fireEvent.click(mapClick)
      expect(latInput()).toHaveValue('37.392512')
      expect(lngInput()).toHaveValue('126.639034')
      expect(document.activeElement).toBe(mapClick)
    })

    it('B 오류 뒤 새 좌표를 제출하면 다시 나타난 "B 분석하기"로 간다', async () => {
      await analyzeA([{ status: 422, body: { error: { code: 'no_data_nearby', message: 'x' } } }])
      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()
      await within(bCard()).findByRole('alert')
      expect(within(bCard()).queryByRole('button', { name: 'B 분석하기' })).not.toBeInTheDocument()

      fill('37.4475', '126.7015')
      pressEnterIn(lngInput())
      expect(document.activeElement).toBe(analyzeBButton())
    })
  })

  describe('포커스 대상이 sticky 헤더 아래 보이게 — 헤더 높이를 문서 스크롤 여백에 쓴다 (6-2)', () => {
    // jsdom에는 레이아웃이 없다(모든 크기 0 → App은 값을 쓰지 않는다). 헤더 높이만 흉내 낸다 — 헤더 요소는 렌더를 거쳐도 같은 노드다
    const stubHeaderHeight = (height: number) =>
      vi.spyOn(document.querySelector<HTMLElement>('.app-header')!, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect)
    const headerOffset = () => document.documentElement.style.getPropertyValue('--header-offset')
    afterEach(() => document.documentElement.style.removeProperty('--header-offset'))

    it('B 성공·전체 결과 열기로 포커스를 옮길 때마다 그 렌더의 헤더 높이를 html --header-offset에 쓴다 (Context Bar 줄 수가 바뀐다)', async () => {
      await analyzeA([ok(guwolFixture)], [ok(guwolNearbyFixture)])
      expect(headerOffset()).toBe('')                                   // 잰 높이가 0이면 쓰지 않는다(CSS 기본 --header-height)
      startCompare()
      typeB(37.4475, 126.7015)
      stubHeaderHeight(81)                                              // B 성공 렌더: 헤더에 A·B 칩이 두 줄로
      analyzeB()
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: PANEL })))
      expect(headerOffset()).toBe('81px')

      stubHeaderHeight(56.5)                                            // 전체 결과: 한 위치 Context Bar, 한 줄 (소수는 올림)
      fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
      expect(document.activeElement).toHaveAttribute('id', 'result-title')
      expect(headerOffset()).toBe('57px')
    })

    it('단일 분석 결과 제목으로 포커스할 때도 헤더 높이를 다시 잰다', async () => {
      mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
      render(<App />)
      await selectBupyeongPcBang()
      stubHeaderHeight(81)
      fireEvent.click(analyzeButton())
      await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'result-title'))
      expect(headerOffset()).toBe('81px')
    })
  })

  describe('mobile (<640px)', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 639px)', media: q }))
    })
    const app = () => document.querySelector('.app')!

    it('비교 시작은 지도 화면 sheet로, B 성공은 패널로, 종료는 A 결과로 돌아가며 포커스를 따라 옮긴다', async () => {
      await analyzeA([ok(songdoFixture)])
      expect(app()).toHaveAttribute('data-screen', 'panel')

      startCompare()
      expect(app()).toHaveAttribute('data-screen', 'map')
      expect(sheet()).toHaveTextContent('B 위치: 지도를 눌러 고르세요 · A 부평구 부평1동')
      expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: '좌표 직접 입력' }))

      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      expect(sheet()).toHaveTextContent('B 선택됨 · 37.392512, 126.639034')
      fireEvent.click(within(sheet()).getByRole('button', { name: 'B 분석하기' }))
      expect(within(sheet()).getByRole('button', { name: 'B 분석 중…' })).toBeDisabled()

      await waitFor(() => expect(app()).toHaveAttribute('data-screen', 'panel'))
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: PANEL }))

      fireEvent.click(screen.getAllByRole('button', { name: '지도 보기' })[0]!)
      expect(app()).toHaveAttribute('data-screen', 'map')
      expect(sheet()).toHaveTextContent('B 연수구 송도2동 분석을 마쳤습니다')
      expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: '비교 화면 보기' }))
      fireEvent.click(within(sheet()).getByRole('button', { name: '비교 종료' }))
      expect(app()).toHaveAttribute('data-screen', 'panel')
      expect(document.activeElement).toBe(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    })

    it('B 실패 뒤 지도 화면 sheet는 실패를 알리고 비교 화면으로 돌아갈 수 있다', async () => {
      await analyzeA([{ status: 422, body: { error: { code: 'location_outside', message: 'x' } } }])
      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      fireEvent.click(within(sheet()).getByRole('button', { name: 'B 분석하기' }))
      await waitFor(() => expect(app()).toHaveAttribute('data-screen', 'panel'))
      expect(document.activeElement).toBe(within(bCard()).getByRole('button', { name: '지도에서 다시 선택' }))

      fireEvent.click(screen.getAllByRole('button', { name: '지도 보기' })[0]!)
      expect(sheet()).toHaveTextContent('B 위치를 분석하지 못했습니다 · 37.392512, 126.639034')
      fireEvent.click(within(sheet()).getByRole('button', { name: '비교 화면 보기' }))
      expect(app()).toHaveAttribute('data-screen', 'panel')
    })

    it('B 전체 결과에서 지도 보기 → sheet "비교 화면 보기"는 보던 전체 결과 제목으로 돌아간다', async () => {
      await analyzeA([ok(guwolFixture)])
      startCompare()
      fireEvent.click(within(sheet()).getByRole('button', { name: '좌표 직접 입력' }))
      typeB(37.4475, 126.7015)
      analyzeB()
      fireEvent.click(await screen.findByRole('button', { name: 'B 전체 결과 보기' }))
      fireEvent.click(screen.getAllByRole('button', { name: '지도 보기' })[0]!)
      expect(app()).toHaveAttribute('data-screen', 'map')
      expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: '비교 화면 보기' }))
      fireEvent.click(within(sheet()).getByRole('button', { name: '비교 화면 보기' }))
      expect(app()).toHaveAttribute('data-screen', 'panel')
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'B · 남동구 구월3동 · PC방 분석' }))
    })

    it('sheet의 "좌표 직접 입력"은 패널의 B 카드로 보낸다 (키보드 대안)', async () => {
      await analyzeA()
      startCompare()
      fireEvent.click(within(sheet()).getByRole('button', { name: '좌표 직접 입력' }))
      expect(app()).toHaveAttribute('data-screen', 'panel')
      expect(document.activeElement).toBe(within(panel()).getByRole('heading', { name: 'B 비교 위치' }))
    })

    it('B가 A와 같은 좌표면 sheet에서도 요청하지 않고 안내한다', async () => {
      const fetchMock = await analyzeA()
      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
      fireEvent.click(within(sheet()).getByRole('button', { name: 'B 분석하기' }))
      expect(within(sheet()).getByRole('alert')).toHaveTextContent('A와 같은 위치입니다')
      expect(app()).toHaveAttribute('data-screen', 'map')
      expect(analyzeCalls(fetchMock)).toHaveLength(1)
    })
  })
})

describe('단일 위치 참고 주소 (7-B2, docs/ADDRESS_DESIGN.md §5.2 B·§5.3)', () => {
  function reverseFixtureFor(roadAddress: string, jibunAddress: string) {
    return { v2: { status: { code: 0, name: 'ok', message: 'done' }, results: [], address: { roadAddress, jibunAddress } } }
  }
  const okResponse = reverseFixtureFor('인천광역시 부평구 광장로  16 부평민자역사', '인천광역시 부평구 부평동  738-21')
  const ok = (body: unknown) => ({ status: 200, body })
  const addressLines = () => screen.queryAllByTestId('reference-address')
  const sdkReady = () => fireEvent.click(screen.getByRole('button', { name: 'SDK 준비' }))
  const respond = async (i: number, status: number, response?: unknown) => {
    await act(async () => {
      sdkMock.reverseCalls[i]?.callback(status, response)
      await Promise.resolve()
    })
  }

  beforeEach(async () => {
    sdkMock.reverseCalls.length = 0
    const { resetAddressCacheForTest } = await import('./lib/addressCache.ts')
    resetAddressCacheForTest()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('SDK 준비 전에는 조회하지 않고, 준비되면 선택 좌표를 1회 조회해 "참고 주소 · … (NAVER 지도)"를 보인다. 분석 뒤 같은 좌표는 재조회 없이 결과 패널에 보인다', async () => {
    const fetchMock = mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    expect(sdkMock.reverseCalls).toHaveLength(0)                 // SDK loading: 조회 없음
    expect(addressLines()).toHaveLength(0)

    sdkReady()
    expect(sdkMock.reverseCalls).toHaveLength(1)                 // 위치 필드 + (숨겨진) mobile sheet 두 자리 → 조회 1회
    expect(sdkMock.reverseCalls[0]!.options).toEqual({ coords: '126.7246,37.4894', orders: 'roadaddr,addr' })
    expect(addressLines()).toHaveLength(0)                       // 로딩 중: 줄 없음
    await respond(0, 200, okResponse)
    const lines = addressLines()
    expect(lines).toHaveLength(2)                                // 위치 필드 + mobile sheet(같은 좌표, 같은 캐시)
    expect(lines[0]).toHaveTextContent('참고 주소 · 인천광역시 부평구 광장로 16 부평민자역사 (NAVER 지도)')
    // 참고 주소가 있으면 요약은 주소가 앞, 좌표는 접힘(P3) — "좌표"를 펼치면 같은 숫자 그대로
    const conditionsRegion = screen.getByRole('region', { name: '분석 조건' })
    expect(conditionsRegion.querySelector('.location__value .mono')).toBeNull()
    const coordsToggle = within(conditionsRegion).getByRole('button', { name: '좌표' })
    expect(coordsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('37.4894, 126.7246', { selector: '.location__coords .mono' })).not.toBeVisible()
    fireEvent.click(coordsToggle)
    expect(screen.getByText('37.4894, 126.7246', { selector: '.location__coords .mono' })).toBeVisible()

    const select = screen.getByRole('combobox', { name: '업종' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'R10406' } })
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    // 분석 뒤: context 좌표 = 요청 좌표 → 같은 키, 추가 조회 없음. 결과 패널(LocationSummary)에 같은 줄
    expect(sdkMock.reverseCalls).toHaveLength(1)
    const after = addressLines()
    expect(after.length).toBeGreaterThanOrEqual(1)
    expect(after[0]).toHaveTextContent('참고 주소 · 인천광역시 부평구 광장로 16 부평민자역사 (NAVER 지도)')
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()   // 제목·행정동 그대로
    expect(screen.getByRole('group', { name: '분석 조건' })).toHaveTextContent('부평구 부평1동')
    expect(screen.getByRole('group', { name: '분석 조건' })).not.toHaveTextContent('광장로')               // Context Bar에는 주소 없음
    expect(analyzeCalls(fetchMock)).toHaveLength(1)
  })

  it('도로명이 없으면 지번을 쓰고, 주소 없음·오류·Geocoder 없음에서는 줄 자체가 없다 — 분석은 그대로 된다', async () => {
    mockApi({ analyze: [ok(songdoFixture)], nearby: [ok(songdoNearbyFixture)] })
    render(<App />)
    sdkReady()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    await respond(0, 200, reverseFixtureFor('', '인천광역시 부평구 부평동 738-21'))
    expect(addressLines()[0]).toHaveTextContent('참고 주소 · 인천광역시 부평구 부평동 738-21 (NAVER 지도)')

    // 주소 없음(code 3): 줄 없음, 좌표 표시는 그대로
    const conditions = screen.getByRole('region', { name: '분석 조건' })
    fireEvent.click(within(conditions).getByRole('button', { name: '좌표 입력' }))
    fireEvent.change(screen.getByLabelText('위도'), { target: { value: '37.4891' } })
    fireEvent.change(screen.getByLabelText('경도'), { target: { value: '126.7236' } })
    fireEvent.click(screen.getByRole('button', { name: '이 좌표로 선택' }))
    expect(addressLines()).toHaveLength(0)                       // 다른 좌표: 첫 렌더부터 이전 주소 없음
    expect(sdkMock.reverseCalls).toHaveLength(2)
    await respond(1, 200, { v2: { status: { code: 3, name: 'no results', message: '' }, results: [] } })
    expect(addressLines()).toHaveLength(0)
    expect(screen.getByText('37.4891, 126.7236', { selector: '.location__value .mono' })).toBeInTheDocument()

    // 조회 실패(ERROR): 줄 없음, 분석은 정상
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    expect(sdkMock.reverseCalls).toHaveLength(3)
    await respond(2, 500, undefined)
    expect(addressLines()).toHaveLength(0)
    const select = screen.getByRole('combobox', { name: '업종' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'R10406' } })
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '연수구 송도2동 · PC방 분석' })
    expect(addressLines()).toHaveLength(0)
    expect(sdkMock.reverseCalls).toHaveLength(3)                 // error 캐시(60초) → 결과 패널도 재조회 없음

    // 캐시된 좌표로 돌아가면 즉시, 조회 없음. Geocoder unavailable이면 캐시가 있어도 숨김
    fireEvent.click(screen.getByRole('button', { name: '조건 바꾸기' }))
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    expect(addressLines()[0]).toHaveTextContent('부평동 738-21')
    expect(sdkMock.reverseCalls).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'SDK Geocoder 없음' }))
    expect(addressLines()).toHaveLength(0)
  })

  it('인증 실패가 오면 보이던 주소를 숨기고, 진행 중이던 응답도 다시 보이지 않으며, 조회도 더 하지 않는다', async () => {
    mockApi()
    render(<App />)
    sdkReady()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    await respond(0, 200, okResponse)
    expect(addressLines()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))          // 진행 중 조회 1건
    expect(sdkMock.reverseCalls).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'SDK 인증 실패' }))
    await respond(1, 200, okResponse)                           // 늦은 응답
    expect(addressLines()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))          // 캐시가 있어도 숨김, 조회 없음
    expect(addressLines()).toHaveLength(0)
    expect(sdkMock.reverseCalls).toHaveLength(2)
  })

  it('조회가 지연되는 동안에도 분석·결과는 정상이고, 응답이 오면 결과 패널에 줄이 생긴다', async () => {
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    sdkReady()
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    expect(sdkMock.reverseCalls).toHaveLength(1)                 // 선택 때 1회, 분석 뒤 추가 없음
    expect(addressLines()).toHaveLength(0)
    await respond(0, 200, okResponse)
    expect(addressLines()[0]).toHaveTextContent('참고 주소 · 인천광역시 부평구 광장로 16 부평민자역사 (NAVER 지도)')
  })

  describe('mobile 지도 화면 sheet', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 639px)', media: q }))
    })
    it('"선택됨 · 좌표" 아래 참고 주소 줄이 붙고, 결과 뒤에도 같은 캐시를 쓴다', async () => {
      mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
      const { container } = render(<App />)
      sdkReady()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
      await respond(0, 200, okResponse)
      const sheet = container.querySelector<HTMLElement>('.map-sheet')!
      expect(sheet).toHaveTextContent('선택됨 · 37.4894, 126.7246')
      expect(within(sheet).getByTestId('reference-address')).toHaveTextContent('참고 주소 · 인천광역시 부평구 광장로 16 부평민자역사 (NAVER 지도)')
      fireEvent.click(within(sheet).getByRole('button', { name: '이 위치로 계속' }))
      const select = screen.getByRole('combobox', { name: '업종' })
      await waitFor(() => expect(select).toBeEnabled())
      fireEvent.change(select, { target: { value: 'R10406' } })
      fireEvent.click(analyzeButton())
      await findList('PC방 점포 목록')
      fireEvent.click(screen.getAllByRole('button', { name: '지도 보기' })[0]!)
      expect(sheet).toHaveTextContent('부평구 부평1동')
      expect(within(sheet).getByTestId('reference-address')).toHaveTextContent('광장로 16')
      expect(sdkMock.reverseCalls).toHaveLength(1)
    })
  })
})

describe('비교 A/B 참고 주소 (7-B3, docs/ADDRESS_DESIGN.md §5.2 C·§5.3)', () => {
  const PANEL = '두 위치 비교 · PC방'
  const panel = () => screen.getByRole('region', { name: PANEL })
  const bCard = () => within(panel()).getByRole('region', { name: 'B 비교 위치' })
  const aCard = () => within(panel()).getByRole('region', { name: 'A 기준 위치' })
  const addressLines = () => screen.queryAllByTestId('reference-address')
  // 결과에서는 주소를 A/B 카드 아래의 접힌 위치 정보로 옮겼다. 선택·오류 카드는 기존 위치다.
  const addressScope = (el: HTMLElement) => {
    if (!el.classList.contains('compare__site')) return el
    const side = el.getAttribute('aria-label')?.slice(0, 1)
    const location = [...panel().querySelectorAll<HTMLElement>('.compare__site-sub')]
      .find((node) => node.querySelector('span')?.textContent?.startsWith(`${side} · `))
    expect(location, `${side} 위치 정보가 있어야 한다`).toBeDefined()
    return location!
  }
  const lineIn = (el: HTMLElement) => within(addressScope(el)).queryByTestId('reference-address')
  const sideButton = (name: RegExp) => within(getInTab(STORES_TAB, 'group', { name: '점포 기준 위치' })).getByRole('button', { name })
  const ok = (body: unknown) => ({ status: 200, body })
  const pending = () => {
    let resolve!: (r: { status: number; body: unknown }) => void
    const promise = new Promise<{ status: number; body: unknown }>((r) => (resolve = r))
    return { promise, respond: (r: { status: number; body: unknown }) => resolve(r) }
  }
  const reverseOk = (roadAddress: string, jibunAddress = '') => ({
    v2: { status: { code: 0, name: 'ok', message: 'done' }, results: [], address: { roadAddress, jibunAddress } },
  })
  const NONE = { v2: { status: { code: 3, name: 'no results', message: '' }, results: [] } }
  // A·B1·B2에 서로 다른 주소 — 섞이면 문자열로 바로 드러난다
  const A_ADDR = '인천광역시 부평구 광장로 16 부평민자역사'
  const B1_ADDR = '인천광역시 남동구 예술로 149'
  const B2_ADDR = '인천광역시 연수구 컨벤시아대로 165'
  const respond = async (i: number, status: number, response?: unknown) => {
    await act(async () => {
      sdkMock.reverseCalls[i]?.callback(status, response)
      await Promise.resolve()
    })
  }

  beforeEach(async () => {
    sdkMock.reverseCalls.length = 0
    const { resetAddressCacheForTest } = await import('./lib/addressCache.ts')
    resetAddressCacheForTest()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  /** SDK 준비 → A(부평역·PC방) 선택·A 주소 응답(aReverse) → A 분석·A 점포 → 비교 시작. 역지오코딩 호출 0번이 A 좌표 */
  async function analyzeA(aReverse: [number, unknown?], bReplies: Reply[] = [], bNearby: Reply[] = []) {
    const fetchMock = mockApi({ analyze: [ok(fixture), ...bReplies], nearby: [ok(nearbyFixture), ...bNearby] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'SDK 준비' }))
    await selectBupyeongPcBang()
    expect(sdkMock.reverseCalls[0]!.options).toEqual({ coords: '126.7246,37.4894', orders: 'roadaddr,addr' })
    await respond(0, aReverse[0], aReverse[1])
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    return fetchMock
  }

  function typeB(lat: number, lng: number) {
    fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: String(lat) } })
    fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: String(lng) } })
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
  }

  it('B 선택→분석 중→성공→요약→점포 기준 전환→A/B 전체 결과→복귀→비교 종료: A/B 주소가 섞이지 않고 좌표마다 한 번만 조회한다', async () => {
    const b = pending()
    const fetchMock = await analyzeA([200, reverseOk(A_ADDR)], [b.promise], [ok(guwolNearbyFixture)])
    // B 고르기 화면: B 좌표가 없으면 줄 없음, A 카드에는 주소를 두지 않는다
    expect(addressLines()).toHaveLength(0)

    typeB(37.4475, 126.7015)
    expect(sdkMock.reverseCalls).toHaveLength(2)
    expect(sdkMock.reverseCalls[1]!.options).toEqual({ coords: '126.7015,37.4475', orders: 'roadaddr,addr' })
    expect(lineIn(bCard())).toBeNull()                                            // 조회 중: 줄 없음, 좌표 표시는 그대로
    expect(bCard()).toHaveTextContent('선택됨 · 37.4475, 126.7015')
    await respond(1, 200, reverseOk(B1_ADDR))
    expect(lineIn(bCard())).toHaveTextContent(`참고 주소 · ${B1_ADDR} (NAVER 지도)`)
    expect(aCard()).not.toHaveTextContent('참고 주소')

    // 분석 중: 같은 B 좌표라 줄이 그대로, 조회 없음
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    expect(within(bCard()).getByRole('button', { name: 'B 분석 중…' })).toBeDisabled()
    expect(lineIn(bCard())).toHaveTextContent(B1_ADDR)
    await act(async () => b.respond(ok(guwolFixture)))
    await findScoreTable()

    // 비교 위치 정보: A context 주소와 B context 주소 — 선택 단계와 같은 키라 추가 조회 없음
    expect(lineIn(aCard())).toHaveTextContent(`참고 주소 · ${A_ADDR} (NAVER 지도)`)
    expect(addressScope(aCard())).not.toHaveTextContent(B1_ADDR)
    expect(lineIn(bCard())).toHaveTextContent(`참고 주소 · ${B1_ADDR} (NAVER 지도)`)
    expect(addressScope(bCard())).not.toHaveTextContent(A_ADDR)
    expect(aCard()).toHaveTextContent('부평구 부평1동')                              // 행정동·최근접역은 그대로
    expect(bCard()).toHaveTextContent('남동구 구월3동')
    expect(screen.getByRole('group', { name: '비교 조건' })).not.toHaveTextContent('참고 주소')   // 조건 바에는 없음
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: PANEL }))
    expect(sdkMock.reverseCalls).toHaveLength(2)

    // 점포 기준 A/B 전환: 주소 줄·조회 그대로
    await findList('B 남동구 구월3동 PC방 점포 목록')
    fireEvent.click(sideButton(/^A 부평1동$/))
    fireEvent.click(sideButton(/^B 구월3동$/))
    expect(addressLines()).toHaveLength(2)

    // B 전체 결과: 보고 있는 B 위치의 주소 한 줄만
    fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'B · 남동구 구월3동 · PC방 분석' }))
    expect(addressLines()).toHaveLength(1)
    expect(addressLines()[0]).toHaveTextContent(B1_ADDR)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)

    // A 전체 결과: A 주소만
    fireEvent.click(screen.getAllByRole('button', { name: 'A 전체 결과 보기' })[0]!)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'A · 부평구 부평1동 · PC방 분석' }))
    expect(addressLines()).toHaveLength(1)
    expect(addressLines()[0]).toHaveTextContent(A_ADDR)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'A 전체 결과 보기' })[0]!)
    expect(sdkMock.reverseCalls).toHaveLength(2)

    // 비교 종료 → A 단일 결과: A 주소, 조회 없음
    fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    expect(addressLines()[0]).toHaveTextContent(A_ADDR)
    expect(screen.queryByText(B1_ADDR, { exact: false })).not.toBeInTheDocument()
    expect(sdkMock.reverseCalls).toHaveLength(2)
    expect(analyzeCalls(fetchMock)).toHaveLength(2)                               // A 1번 + B 1번
    expect(nearbyCalls(fetchMock)).toHaveLength(2)
  })

  it('경합: B1 조회 중 B2로 다시 고르면 B1은 첫 렌더부터 없고, 늦은 B1 응답은 B2·A 카드에 붙지 않고 B1 좌표 캐시에만 남는다', async () => {
    await analyzeA([200, reverseOk(A_ADDR)], [ok(songdoFixture)], [ok(songdoNearbyFixture)])
    typeB(37.4475, 126.7015)                                                       // B1 (조회 1, 응답 대기)
    expect(sdkMock.reverseCalls).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))        // B2 (지도 클릭)
    expect(bCard()).toHaveTextContent('선택됨 · 37.392512, 126.639034')
    expect(lineIn(bCard())).toBeNull()
    expect(sdkMock.reverseCalls).toHaveLength(3)
    expect(sdkMock.reverseCalls[2]!.options).toEqual({ coords: '126.639034,37.392512', orders: 'roadaddr,addr' })

    await respond(2, 200, reverseOk(B2_ADDR))
    expect(lineIn(bCard())).toHaveTextContent(B2_ADDR)
    await respond(1, 200, reverseOk(B1_ADDR))                                      // 늦은 B1 응답
    expect(lineIn(bCard())).toHaveTextContent(B2_ADDR)
    expect(screen.queryByText(B1_ADDR, { exact: false })).not.toBeInTheDocument()

    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    await findScoreTable()
    expect(lineIn(aCard())).toHaveTextContent(A_ADDR)
    expect(lineIn(bCard())).toHaveTextContent(B2_ADDR)
    expect(screen.queryByText(B1_ADDR, { exact: false })).not.toBeInTheDocument()
    expect(sdkMock.reverseCalls).toHaveLength(3)

    // B를 다시 고르면 B2 주소는 사라진다. B1 좌표로 돌아가면 늦게 온 B1 응답(자기 키 캐시)을 조회 없이 쓴다
    fireEvent.click(screen.getByRole('button', { name: 'B 다시 고르기' }))
    expect(addressLines()).toHaveLength(0)
    typeB(37.4475, 126.7015)
    expect(lineIn(bCard())).toHaveTextContent(B1_ADDR)
    expect(sdkMock.reverseCalls).toHaveLength(3)
  })

  it('B가 주소를 보이던 중 다시 고르면 이전 B 주소는 새 좌표의 첫 렌더부터 없다', async () => {
    await analyzeA([200, reverseOk(A_ADDR)])
    typeB(37.4475, 126.7015)
    await respond(1, 200, reverseOk(B1_ADDR))
    expect(lineIn(bCard())).toHaveTextContent(B1_ADDR)
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    expect(bCard()).toHaveTextContent('선택됨 · 37.392512, 126.639034')
    expect(lineIn(bCard())).toBeNull()
    expect(screen.queryByText(B1_ADDR, { exact: false })).not.toBeInTheDocument()
  })

  it('B 분석 오류 상태에서도 B 카드는 같은 B 좌표 주소를 유지하고, 다시 시도 성공 뒤에도 다시 조회하지 않는다', async () => {
    const fetchMock = await analyzeA(
      [200, reverseOk(A_ADDR)],
      [{ status: 500, body: internalError }, ok(guwolFixture)],
      [ok(guwolNearbyFixture)],
    )
    typeB(37.4475, 126.7015)
    await respond(1, 200, reverseOk(B1_ADDR))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    const alert = await within(bCard()).findByRole('alert')
    expect(lineIn(bCard())).toHaveTextContent(B1_ADDR)
    fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    await findScoreTable()
    expect(lineIn(aCard())).toHaveTextContent(A_ADDR)
    expect(lineIn(bCard())).toHaveTextContent(B1_ADDR)
    expect(sdkMock.reverseCalls).toHaveLength(2)
    expect(analyzeCalls(fetchMock)).toHaveLength(3)
  })

  it('A 주소 없음·B 조회 실패: 줄만 빠지고 비교 결과·점포·화면 전환은 그대로, 실패 좌표도 화면 전환으로 다시 조회하지 않는다', async () => {
    const fetchMock = await analyzeA([200, NONE], [ok(guwolFixture)], [ok(guwolNearbyFixture)])
    typeB(37.4475, 126.7015)
    await respond(1, 500, undefined)                                              // ERROR → unknown, 60초 오류 캐시
    expect(lineIn(bCard())).toBeNull()
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    await findScoreTable()
    expect(addressLines()).toHaveLength(0)
    expect(aCard()).toHaveTextContent('부평구 부평1동')
    expect(bCard()).toHaveTextContent('남동구 구월3동')
    expect(await findList('B 남동구 구월3동 PC방 점포 목록')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
    expect(screen.getByRole('heading', { level: 1, name: 'B · 남동구 구월3동 · PC방 분석' })).toBeInTheDocument()
    expect(addressLines()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'A 전체 결과 보기' })[0]!)
    expect(addressLines()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    expect(sdkMock.reverseCalls).toHaveLength(2)
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
    expect(nearbyCalls(fetchMock)).toHaveLength(2)
  })

  it('SDK 인증 실패: 보이던 A/B 주소를 모두 숨기고, 진행 중이던 B 응답도 보이지 않으며, 비교 결과는 그대로다', async () => {
    const fetchMock = await analyzeA([200, reverseOk(A_ADDR)], [ok(guwolFixture)], [ok(guwolNearbyFixture)])
    typeB(37.4475, 126.7015)                                                       // B 조회 대기 중
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    await findScoreTable()
    expect(lineIn(aCard())).toHaveTextContent(A_ADDR)
    expect(lineIn(bCard())).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'SDK 인증 실패' }))
    expect(addressLines()).toHaveLength(0)
    await respond(1, 200, reverseOk(B1_ADDR))                                      // 늦은 B 응답
    expect(addressLines()).toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
    expect(addressLines()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    expect(getScoreTable()).toBeInTheDocument()
    expect(sdkMock.reverseCalls).toHaveLength(2)
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
  })
})

describe('단일 위치 주소 검색 (7-B4, docs/ADDRESS_DESIGN.md §5.2 A)', () => {
  const ok = (body: unknown) => ({ status: 200, body })
  const conditions = () => screen.getByRole('region', { name: '분석 조건' })
  const searchToggle = () => within(conditions()).queryByRole('button', { name: '주소로 찾기' })
  const sdkReady = () => fireEvent.click(screen.getByRole('button', { name: 'SDK 준비' }))
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)
  const answer = async (calls: typeof sdkMock.geocodeCalls, i: number, status: number, response?: unknown) => {
    await act(async () => {
      calls[i]!.callback(status, response)
      await Promise.resolve()
    })
  }
  /** 정방향 성공 응답 — 실제 fixture(geocoder-forward-bupyeong-daero.json)와 같은 모양 */
  const forward = (items: { road: string; jibun?: string; sido: string; x: string; y: string }[]) => ({
    v2: {
      status: 'OK',
      meta: { totalCount: items.length, page: 1, count: items.length },
      addresses: items.map((i) => ({
        roadAddress: i.road,
        jibunAddress: i.jibun ?? '',
        addressElements: [{ types: ['SIDO'], longName: i.sido, shortName: i.sido, code: '' }],
        x: i.x,
        y: i.y,
        distance: 10,
      })),
      errorMessage: '',
    },
  })
  const BUPYEONG = { road: '인천광역시 부평구 부평대로 3', jibun: '인천광역시 부평구 부평동 549-39', sido: '인천광역시', x: '126.7227259', y: '37.4918321' }
  const SEOUL = { road: '서울특별시 중구 세종대로 110', sido: '서울특별시', x: '126.9779692', y: '37.5662952' }
  /** 고른 좌표로 분석한 응답 — backend는 context에 요청 좌표를 그대로 돌려준다(matchesRequest) */
  const analyzedAt = (lat: number, lng: number) => ({ ...fixture, context: { ...fixture.context, lat, lng } })

  function searchFor(query: string) {
    fireEvent.click(searchToggle()!)
    fireEvent.change(within(conditions()).getByRole('textbox', { name: '주소' }), { target: { value: query } })
    fireEvent.click(within(conditions()).getByRole('button', { name: '검색' }))
  }

  async function chooseBusiness() {
    const select = screen.getByRole('combobox', { name: '업종' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'R10406' } })
  }

  beforeEach(async () => {
    sdkMock.reverseCalls.length = 0
    sdkMock.geocodeCalls.length = 0
    const { resetAddressCacheForTest } = await import('./lib/addressCache.ts')
    resetAddressCacheForTest()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('Geocoder가 준비됐을 때만 "주소로 찾기"가 있다 (SDK 준비 전·Geocoder 없음에는 없음)', () => {
    mockApi()
    render(<App />)
    expect(searchToggle()).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SDK Geocoder 없음' }))
    expect(searchToggle()).not.toBeInTheDocument()
    sdkReady()
    expect(searchToggle()).toBeInTheDocument()
    // 위치 입력 방법 segmented 1줄 (P2·P3): 지도 → 주소 → 좌표, aria-pressed, 처음은 지도 안내
    const methods = within(within(conditions()).getByRole('group', { name: '위치 입력 방법' })).getAllByRole('button')
    expect(methods.map((b) => b.textContent)).toEqual(['지도에서 고르기', '주소로 찾기', '좌표 입력'])
    expect(methods.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(conditions()).toHaveTextContent('지도를 눌러 위치를 고르세요.')
    // 고른 방법의 폼 하나만 열린다
    fireEvent.click(searchToggle()!)
    expect(within(conditions()).getByRole('textbox', { name: '주소' })).toBeInTheDocument()
    expect(within(conditions()).queryByLabelText('위도')).not.toBeInTheDocument()
    fireEvent.click(within(conditions()).getByRole('button', { name: '좌표 입력' }))
    expect(within(conditions()).queryByRole('textbox', { name: '주소' })).not.toBeInTheDocument()
    expect(within(conditions()).getByLabelText('위도')).toBeInTheDocument()
    expect(methods.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
  })

  it('검색 → 결과 선택: 분석은 시작하지 않고 위치 요약으로 포커스, 참고 주소는 역지오코딩 캐시로, 분석 요청 좌표는 adapter 좌표 그대로', async () => {
    const lat = 37.4918321
    const lng = 126.7227259
    const fetchMock = mockApi({ analyze: [ok(analyzedAt(lat, lng))], nearby: [ok(nearbyFixture)] })
    render(<App />)
    sdkReady()
    searchFor('인천광역시 부평구 부평대로 1')
    expect(sdkMock.geocodeCalls).toHaveLength(1)
    await answer(sdkMock.geocodeCalls, 0, 200, forward([BUPYEONG]))
    expect(duplicateIds()).toEqual([])
    expect(brokenReferences()).toEqual([])

    const item = within(screen.getByRole('list', { name: /검색 결과 1건/ })).getByRole('button')
    expect(item).toHaveTextContent('인천광역시 부평구 부평대로 3')
    fireEvent.click(item)
    // 위치 요약(tabIndex=-1)으로 포커스, 결과 목록은 닫히고 주소 폼(고른 방법)은 입력값 그대로 남는다, 분석 요청 없음
    const summary = screen.getByText(`${lat}, ${lng}`, { selector: '.location__value .mono' }).closest<HTMLElement>('.location__selected')!
    expect(document.activeElement).toBe(summary)
    expect(summary).toHaveAttribute('tabindex', '-1')
    expect(screen.queryByRole('list', { name: /검색 결과/ })).not.toBeInTheDocument()
    expect(within(conditions()).getByRole('textbox', { name: '주소' })).toHaveValue('인천광역시 부평구 부평대로 1')
    expect(searchToggle()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', `${lat},${lng}`)
    expect(analyzeCalls(fetchMock)).toHaveLength(0)

    // 참고 주소: 검색 문자열이 아니라 그 좌표의 역지오코딩(기존 캐시 경로)
    expect(sdkMock.reverseCalls).toHaveLength(1)
    expect(sdkMock.reverseCalls[0]!.options).toEqual({ coords: `${lng},${lat}`, orders: 'roadaddr,addr' })
    expect(screen.queryAllByTestId('reference-address')).toHaveLength(0)       // 역지오코딩 응답 전에는 줄 없음

    await chooseBusiness()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(bodyOf(analyzeCalls(fetchMock)[0]!)).toEqual({ lat, lng, biz_code: 'R10406' })
    expect(screen.getByRole('group', { name: '분석 조건' })).toHaveTextContent('부평구 부평1동')   // 행정동은 context 그대로
    expect(screen.getByRole('group', { name: '분석 조건' })).not.toHaveTextContent('부평대로')
    expect(sdkMock.geocodeCalls).toHaveLength(1)
  })

  it('mobile 지도 sheet에도 같은 segmented — 주소·좌표를 누르면 패널 화면으로 가서 그 폼의 첫 입력칸으로 포커스 (B5)', () => {
    mockApi()
    render(<App />)
    sdkReady()
    const app = document.querySelector<HTMLElement>('.app')!
    const sheet = () => within(document.querySelector<HTMLElement>('.map-sheet')!)
    const sheetMethods = sheet().getByRole('group', { name: '위치 입력 방법' })
    expect(within(sheetMethods).getAllByRole('button').map((b) => b.textContent)).toEqual(['지도에서 고르기', '주소로 찾기', '좌표 입력'])
    expect(app).toHaveAttribute('data-screen', 'map')

    fireEvent.click(sheet().getByRole('button', { name: '좌표 입력' }))
    expect(app).toHaveAttribute('data-screen', 'panel')
    expect(document.activeElement).toBe(within(conditions()).getByLabelText('위도'))
    expect(within(conditions()).getByRole('button', { name: '좌표 입력' })).toHaveAttribute('aria-pressed', 'true')

    // 패널의 "지도에서 고르기" → 지도 화면, sheet도 같은 방법이 눌린 상태
    fireEvent.click(within(conditions()).getByRole('button', { name: '지도에서 고르기' }))
    expect(app).toHaveAttribute('data-screen', 'map')
    expect(sheet().getByRole('button', { name: '지도에서 고르기' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(sheet().getByRole('button', { name: '주소로 찾기' }))
    expect(app).toHaveAttribute('data-screen', 'panel')
    expect(document.activeElement).toBe(within(conditions()).getByRole('textbox', { name: '주소' }))
  })

  it('참고 주소가 없으면 좌표를 접지 않는다 — 좌표가 유일한 요약', () => {
    mockApi()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    expect(screen.getByText('37.4894, 126.7246', { selector: '.location__value .mono' })).toBeVisible()
    expect(within(conditions()).queryByRole('button', { name: '좌표' })).not.toBeInTheDocument()
  })

  it('인천 밖 결과도 고를 수 있고, 분석하면 backend location_outside를 기존 오류로 보인다(사전 차단 없음)', async () => {
    const fetchMock = mockApi({ analyze: [{ status: 422, body: { error: { code: 'location_outside', message: 'x' } } }] })
    render(<App />)
    sdkReady()
    searchFor('세종대로 110')
    await answer(sdkMock.geocodeCalls, 0, 200, forward([SEOUL]))
    const item = within(screen.getByRole('list', { name: /검색 결과/ })).getByRole('button')
    expect(item).toHaveTextContent('서울특별시')
    expect(item).toBeEnabled()
    fireEvent.click(item)
    await chooseBusiness()
    fireEvent.click(analyzeButton())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('인천 안의 위치를 선택해 주세요')
    expect(bodyOf(analyzeCalls(fetchMock)[0]!)).toEqual({ lat: 37.5662952, lng: 126.9779692, biz_code: 'R10406' })
  })

  it('SDK 인증 실패: 포커스가 있던 검색 폼이 사라지면 "지도에서 고르기"(눌린 상태)로 포커스, 늦은 검색 응답은 버리고 좌표 입력·분석은 그대로', async () => {
    const fetchMock = mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    sdkReady()
    searchFor('부평대로')
    within(conditions()).getByRole('textbox', { name: '주소' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'SDK 인증 실패' }))
    expect(searchToggle()).not.toBeInTheDocument()
    expect(within(conditions()).queryByRole('textbox', { name: '주소' })).not.toBeInTheDocument()
    const mapMethod = within(conditions()).getByRole('button', { name: '지도에서 고르기' })
    expect(document.activeElement).toBe(mapMethod)
    expect(mapMethod).toHaveAttribute('aria-pressed', 'true')
    await answer(sdkMock.geocodeCalls, 0, 200, forward([BUPYEONG]))           // 늦은 응답
    expect(screen.queryByRole('list', { name: /검색 결과/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '')

    // 기본 위치 선택은 그대로
    fireEvent.click(within(conditions()).getByRole('button', { name: '좌표 입력' }))
    fireEvent.change(screen.getByLabelText('위도'), { target: { value: '37.4894' } })
    fireEvent.change(screen.getByLabelText('경도'), { target: { value: '126.7246' } })
    fireEvent.click(screen.getByRole('button', { name: '이 좌표로 선택' }))
    await chooseBusiness()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(analyzeCalls(fetchMock)).toHaveLength(1)
    expect(sdkMock.geocodeCalls).toHaveLength(1)
  })

  it('포커스가 검색 밖에 있으면 SDK 실패로 폼이 사라져도 포커스를 옮기지 않는다', async () => {
    mockApi()
    render(<App />)
    sdkReady()
    searchFor('부평대로')
    const select = screen.getByRole('combobox', { name: '업종' })
    await waitFor(() => expect(select).toBeEnabled())
    select.focus()
    fireEvent.click(screen.getByRole('button', { name: 'SDK 인증 실패' }))
    expect(document.activeElement).toBe(select)
  })

  it('검색이 지연·실패해도 지도 선택·분석은 동작하고, 지연된 응답이 와도 선택한 위치를 바꾸지 않는다', async () => {
    const fetchMock = mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    sdkReady()
    searchFor('부평대로')                                                      // 응답 대기
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    await act(async () => {
      sdkMock.geocodeCalls[0]!.callback(500, undefined)                     // 조건 화면이 내려간 뒤 실패 응답
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
    expect(analyzeCalls(fetchMock)).toHaveLength(1)

    // 검색 오류 안내 뒤에도 좌표 선택은 그대로
    fireEvent.click(screen.getByRole('button', { name: '조건 바꾸기' }))
    searchFor('부평대로')
    await answer(sdkMock.geocodeCalls, 1, 500, undefined)
    expect(conditions()).toHaveTextContent('주소 검색을 지금 쓸 수 없습니다. 지도에서 고르거나 좌표를 입력하세요.')
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.392512,126.639034')
  })

  it('분석 중에는 기존 입력 잠금처럼 주소 검색도 잠긴다', async () => {
    let release!: (r: { status: number; body: unknown }) => void
    const pendingAnalysis = new Promise<{ status: number; body: unknown }>((r) => (release = r))
    mockApi({ analyze: [pendingAnalysis], nearby: [ok(nearbyFixture)] })
    render(<App />)
    sdkReady()
    searchFor('부평대로')
    await answer(sdkMock.geocodeCalls, 0, 200, forward([BUPYEONG]))
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    expect(searchToggle()).toBeDisabled()
    expect(within(conditions()).getByRole('button', { name: '좌표 입력' })).toBeDisabled()
    expect(within(conditions()).getByRole('button', { name: '지도에서 고르기' })).toBeDisabled()
    expect(within(conditions()).getByRole('textbox', { name: '주소' })).toBeDisabled()
    await act(async () => release(ok(fixture)))
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
  })
})

describe('비교 B 주소 검색 (7-B5, docs/ADDRESS_DESIGN.md §5.2 A-4)', () => {
  const PANEL = '두 위치 비교 · PC방'
  const panel = () => screen.getByRole('region', { name: PANEL })
  const bCard = () => within(panel()).getByRole('region', { name: 'B 비교 위치' })
  const aCard = () => within(panel()).getByRole('region', { name: 'A 기준 위치' })
  const bToggle = () => within(bCard()).queryByRole('button', { name: 'B 주소로 찾기' })
  const bInput = () => within(bCard()).queryByRole('textbox', { name: 'B 주소' })
  const ok = (body: unknown) => ({ status: 200, body })
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)
  const answer = async (i: number, status: number, response?: unknown) => {
    await act(async () => {
      sdkMock.geocodeCalls[i]!.callback(status, response)
      await Promise.resolve()
    })
  }
  const forward = (items: { road: string; sido: string; x: string; y: string }[]) => ({
    v2: {
      status: 'OK',
      meta: { totalCount: items.length, page: 1, count: items.length },
      addresses: items.map((i) => ({
        roadAddress: i.road,
        jibunAddress: '',
        addressElements: [{ types: ['SIDO'], longName: i.sido, shortName: i.sido, code: '' }],
        x: i.x,
        y: i.y,
        distance: 10,
      })),
      errorMessage: '',
    },
  })
  // B 후보: 구월3동 fixture 좌표(context와 같아 matchesRequest 통과), A와 같은 좌표, 인천 밖
  const GUWOL = { road: '인천광역시 남동구 예술로 148', sido: '인천광역시', x: '126.7015', y: '37.4475' }
  const SAME_AS_A = { road: '인천광역시 부평구 광장로 16', sido: '인천광역시', x: '126.7246', y: '37.4894' }
  const SEOUL = { road: '서울특별시 중구 세종대로 110', sido: '서울특별시', x: '126.9779692', y: '37.5662952' }

  beforeEach(async () => {
    sdkMock.reverseCalls.length = 0
    sdkMock.geocodeCalls.length = 0
    const { resetAddressCacheForTest } = await import('./lib/addressCache.ts')
    resetAddressCacheForTest()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  /** SDK 준비 → A(부평역·PC방) 분석 → 비교 시작 */
  async function startWithA(bReplies: Reply[] = [], bNearby: Reply[] = []) {
    const fetchMock = mockApi({ analyze: [ok(fixture), ...bReplies], nearby: [ok(nearbyFixture), ...bNearby] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'SDK 준비' }))
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    return fetchMock
  }

  function searchB(query: string) {
    if (bToggle()!.getAttribute('aria-expanded') === 'false') fireEvent.click(bToggle()!)
    fireEvent.change(bInput()!, { target: { value: query } })
    fireEvent.submit(within(bCard()).getByRole('search', { name: 'B 주소 검색' }))
  }

  const resultButton = (text: string) =>
    within(within(bCard()).getByRole('list', { name: /검색 결과/ })).getByRole('button', { name: new RegExp(text) })

  it('검색 → 선택(B만 바뀜, 분석 없음, 포커스 "B 분석하기") → B 분석 → 요약: 좌표·업종·포커스·호출 횟수', async () => {
    const fetchMock = await startWithA([ok(guwolFixture)], [ok(guwolNearbyFixture)])
    // B 카드에만 B 검색이 있다(라벨·검색 영역 이름에 B). 단일 위치 검색은 이 화면에 없다
    expect(screen.queryByRole('button', { name: '주소로 찾기' })).not.toBeInTheDocument()
    expect(within(aCard()).queryByRole('button', { name: /주소로 찾기/ })).not.toBeInTheDocument()
    searchB('예술로 148')
    expect(sdkMock.geocodeCalls).toHaveLength(1)
    expect(sdkMock.geocodeCalls[0]!.options).toEqual({ query: '예술로 148', coordinate: '126.7052,37.4563', count: 10 })
    await answer(0, 200, forward([GUWOL]))
    fireEvent.click(resultButton('예술로 148'))

    expect(bCard()).toHaveTextContent('선택됨 · 37.4475, 126.7015')
    expect(document.activeElement).toBe(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    expect(bInput()).not.toBeInTheDocument()                                     // 폼 접힘
    expect(bToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(analyzeCalls(fetchMock)).toHaveLength(1)                              // 선택만으로 분석하지 않는다
    expect(aCard()).toHaveTextContent('부평구 부평1동')                             // A 그대로
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
    expect(screen.getByTestId('map')).toHaveAttribute('data-compare-location', '37.4475,126.7015')
    expect(sdkMock.reverseCalls.map((c) => c.options.coords)).toEqual(['126.7246,37.4894', '126.7015,37.4475'])   // B 참고 주소는 좌표 캐시

    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    await findScoreTable()
    expect(bodyOf(analyzeCalls(fetchMock)[1]!)).toEqual({ lat: 37.4475, lng: 126.7015, biz_code: 'R10406' })   // A 업종 그대로
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: PANEL }))
    expect(bCard()).toHaveTextContent('남동구 구월3동')
    expect(aCard()).toHaveTextContent('부평구 부평1동')
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
    expect(sdkMock.geocodeCalls).toHaveLength(1)
    expect(sdkMock.reverseCalls).toHaveLength(2)                                  // 요약 A/B 카드는 같은 키 — 추가 조회 없음
  })

  it('A와 같은 좌표를 고르면 분석을 눌러도 D2 안내만 보이고 /analyze는 보내지 않는다', async () => {
    const fetchMock = await startWithA()
    searchB('광장로 16')
    await answer(0, 200, forward([SAME_AS_A]))
    fireEvent.click(resultButton('광장로 16'))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    expect(within(bCard()).getByRole('alert')).toHaveTextContent('A와 같은 위치입니다. 다른 위치를 고르세요.')
    expect(analyzeCalls(fetchMock)).toHaveLength(1)
  })

  it('인천 밖 B → backend location_outside(B만 실패, A 그대로) → 다른 주소 검색·선택 → B 성공', async () => {
    const fetchMock = await startWithA(
      [{ status: 422, body: { error: { code: 'location_outside', message: 'x' } } }, ok(guwolFixture)],
      [ok(guwolNearbyFixture)],
    )
    searchB('세종대로 110')
    await answer(0, 200, forward([SEOUL]))
    expect(resultButton('세종대로')).toHaveTextContent('서울특별시')
    fireEvent.click(resultButton('세종대로'))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    const alert = await within(bCard()).findByRole('alert')
    expect(alert).toHaveTextContent('인천 안의 위치를 선택해 주세요')
    expect(bodyOf(analyzeCalls(fetchMock)[1]!)).toEqual({ lat: 37.5662952, lng: 126.9779692, biz_code: 'R10406' })
    expect(aCard()).toHaveTextContent('부평구 부평1동')
    expect(screen.getByRole('group', { name: '비교 조건' })).toHaveTextContent('두 위치 비교')

    // 오류 상태에서도 B 검색은 쓸 수 있다 — 고르면 B만 다시 picking, 포커스 "B 분석하기"
    searchB('예술로 148')
    await answer(1, 200, forward([GUWOL]))
    fireEvent.click(resultButton('예술로 148'))
    expect(document.activeElement).toBe(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    await findScoreTable()
    expect(bCard()).toHaveTextContent('남동구 구월3동')
    expect(analyzeCalls(fetchMock)).toHaveLength(3)
  })

  it('비교 취소 → 다시 시작 → 새 검색: 이전 검색의 늦은 응답은 버린다. 조건 변경·비교 종료 뒤 늦은 응답도 위치를 바꾸지 못한다', async () => {
    await startWithA()
    searchB('첫 검색')                                                           // 호출 0, 응답 대기
    fireEvent.click(screen.getAllByRole('button', { name: '비교 취소' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    expect(bToggle()).toHaveAttribute('aria-expanded', 'false')                   // 새 B 카드: 이전 폼 상태 없음
    searchB('두 번째 검색')                                                       // 호출 1
    await answer(0, 200, forward([SEOUL]))                                       // 늦은 첫 응답
    expect(within(bCard()).queryByRole('list', { name: /검색 결과/ })).not.toBeInTheDocument()
    expect(bCard()).not.toHaveTextContent('세종대로')
    await answer(1, 200, forward([GUWOL]))
    expect(within(bCard()).getByRole('list', { name: '‘두 번째 검색’ 검색 결과 1건' })).toHaveTextContent('예술로 148')

    // 비교 종료(취소) 중 대기 응답 → 화면·위치 그대로
    searchB('세 번째 검색')                                                       // 호출 2
    fireEvent.click(screen.getAllByRole('button', { name: '비교 취소' })[0]!)
    await answer(2, 200, forward([SEOUL]))
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
    expect(screen.getByTestId('map')).not.toHaveAttribute('data-compare')

    // 조건 변경 중 대기 응답 → 조건 화면의 위치 그대로, 결과 목록 없음
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    searchB('네 번째 검색')                                                       // 호출 3
    fireEvent.click(within(panel()).getByRole('button', { name: '조건 바꾸기' }))
    await answer(3, 200, forward([SEOUL]))
    expect(screen.getByRole('region', { name: '분석 조건' })).toHaveTextContent('선택됨 · 37.4894, 126.7246')
    expect(screen.queryByRole('list', { name: /검색 결과/ })).not.toBeInTheDocument()
    expect(sdkMock.geocodeCalls).toHaveLength(4)
  })

  it('SDK 인증 실패: 포커스가 있던 B 검색이 사라지면 "B 위도"로, 검색 밖 포커스는 그대로. 늦은 응답은 버린다', async () => {
    await startWithA()
    searchB('예술로 148')
    bInput()!.focus()
    fireEvent.click(screen.getByRole('button', { name: 'SDK 인증 실패' }))
    expect(bToggle()).not.toBeInTheDocument()
    expect(document.activeElement).toBe(within(bCard()).getByLabelText('B 위도'))
    await answer(0, 200, forward([GUWOL]))
    expect(bCard()).not.toHaveTextContent('예술로 148')
    expect(screen.getByTestId('map')).toHaveAttribute('data-compare-location', '')
  })

  it('SDK 실패 때 포커스가 검색 밖이면 옮기지 않는다', async () => {
    await startWithA()
    searchB('예술로 148')
    const lng = within(bCard()).getByLabelText('B 경도')
    lng.focus()
    fireEvent.click(screen.getByRole('button', { name: 'SDK 인증 실패' }))
    expect(document.activeElement).toBe(lng)
  })

  it('B 분석 중에는 B 검색도 잠긴다 (기존 B 입력 잠금 규칙)', async () => {
    let release!: (r: { status: number; body: unknown }) => void
    const pendingB = new Promise<{ status: number; body: unknown }>((r) => (release = r))
    await startWithA([pendingB], [ok(guwolNearbyFixture)])
    searchB('예술로 148')
    await answer(0, 200, forward([GUWOL]))
    fireEvent.click(resultButton('예술로 148'))
    fireEvent.click(bToggle()!)                                                   // 다시 펼친 채로 분석
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    expect(bToggle()).toBeDisabled()
    expect(bInput()).toBeDisabled()
    expect(within(bCard()).getByRole('button', { name: '검색' })).toBeDisabled()
    expect(within(bCard()).getByLabelText('B 위도')).toBeDisabled()
    await act(async () => release(ok(guwolFixture)))
    await findScoreTable()
  })

  it('B location_outside 오류 중 검색 → 응답 전 "지도에서 다시 선택"(pickB) → 이전 응답은 버리고 검색을 초기화한다. 새 검색은 정상, A 유지, 포커스 B 카드 제목', async () => {
    const fetchMock = await startWithA(
      [{ status: 422, body: { error: { code: 'location_outside', message: 'x' } } }, ok(guwolFixture)],
      [ok(guwolNearbyFixture)],
    )
    searchB('세종대로 110')
    await answer(0, 200, forward([SEOUL]))
    fireEvent.click(resultButton('세종대로'))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    const alert = await within(bCard()).findByRole('alert')
    expect(alert).toHaveTextContent('인천 안의 위치를 선택해 주세요')

    // 오류 상태(같은 B 고르기 화면)에서 검색 시작 — 응답 전에 "지도에서 다시 선택"
    searchB('예술로 148')                                                          // 호출 1, 응답 대기
    expect(within(bCard()).getByRole('search', { name: 'B 주소 검색' })).toBeInTheDocument()
    fireEvent.click(within(alert).getByRole('button', { name: '지도에서 다시 선택' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'B 비교 위치' }))
    expect(bToggle()).toHaveAttribute('aria-expanded', 'false')                     // 검색 폼·상태 초기화
    expect(within(bCard()).queryByRole('search')).not.toBeInTheDocument()

    await answer(1, 200, forward([GUWOL]))                                          // 이전 검색의 늦은 응답
    expect(within(bCard()).queryByRole('list', { name: /검색 결과/ })).not.toBeInTheDocument()
    expect(bCard()).not.toHaveTextContent('예술로 148')
    fireEvent.click(bToggle()!)
    expect(bInput()).toHaveValue('')                                                // 입력값도 새로
    expect(within(bCard()).queryByRole('list', { name: /검색 결과/ })).not.toBeInTheDocument()
    expect(bCard()).toHaveTextContent('지도를 누르거나 아래에 좌표를 입력해 B 위치를 고르세요.')
    expect(screen.getByTestId('map')).toHaveAttribute('data-compare-location', '')
    expect(aCard()).toHaveTextContent('부평구 부평1동')                                 // A 그대로
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')

    // 새 검색은 정상
    searchB('예술로 148')                                                          // 호출 2
    await answer(2, 200, forward([GUWOL]))
    fireEvent.click(resultButton('예술로 148'))
    expect(document.activeElement).toBe(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    await findScoreTable()
    expect(bCard()).toHaveTextContent('남동구 구월3동')
    expect(aCard()).toHaveTextContent('부평구 부평1동')
    expect(analyzeCalls(fetchMock)).toHaveLength(3)
    expect(sdkMock.geocodeCalls).toHaveLength(3)
  })

  it('지도 클릭으로 B 좌표만 바꾸면 검색어·결과는 그대로다 (pickB 초기화와 구분)', async () => {
    await startWithA()
    searchB('예술로 148')
    await answer(0, 200, forward([GUWOL, SEOUL]))
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    expect(bCard()).toHaveTextContent('선택됨 · 37.392512, 126.639034')
    expect(bInput()).toHaveValue('예술로 148')
    expect(within(bCard()).getByRole('list', { name: '‘예술로 148’ 검색 결과 2건' })).toBeInTheDocument()
  })

  it('B 검색 결과가 열린 B 카드에서 id가 유일하고 접근성 참조가 이어진다', async () => {
    await startWithA()
    searchB('예술로 148')
    await answer(0, 200, forward([GUWOL, SEOUL]))
    expandAll(document.querySelector('.workspace__panel')!)
    expect(duplicateIds()).toEqual([])
    expect(brokenReferences()).toEqual([])
    expect(brokenControls()).toEqual([])
  })

  describe('mobile', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 639px)', media: q }))
    })
    it('비교 sheet에는 검색 폼이 없고, sheet의 "좌표 직접 입력"으로 패널에 가서 B 검색을 쓴다', async () => {
      await startWithA([ok(guwolFixture)], [ok(guwolNearbyFixture)])
      const sheet = document.querySelector<HTMLElement>('.map-sheet')!
      expect(within(sheet).queryByRole('button', { name: /주소로 찾기/ })).not.toBeInTheDocument()
      expect(within(sheet).queryByRole('search')).not.toBeInTheDocument()
      fireEvent.click(within(sheet).getByRole('button', { name: '좌표 직접 입력' }))
      expect(document.querySelector('.app')).toHaveAttribute('data-screen', 'panel')
      searchB('예술로 148')
      await answer(0, 200, forward([GUWOL]))
      fireEvent.click(resultButton('예술로 148'))
      expect(document.activeElement).toBe(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
      expect(within(sheet).getByRole('button', { name: 'B 분석하기' })).toBeInTheDocument()   // 지도 화면 sheet에서도 바로 분석 가능
    })
  })
})

describe('mobile 패널에서 고른 점포 → "지도 보기" (6-4)', () => {
  const ok = (body: unknown) => ({ status: 200, body })
  const app = () => document.querySelector('.app')!
  const map = () => screen.getByTestId('map')
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 639px)', media: q }))
  })

  it('단일 결과: 패널 목록에서 고른 선택이 지도 화면으로 그대로 넘어가고, 분석·점포를 다시 조회하지 않는다', async () => {
    const fetchMock = mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    const list = await findList('PC방 점포 목록')
    expect(app()).toHaveAttribute('data-screen', 'panel')
    expect(map()).toHaveAttribute('data-layout-key', 'panel:open:map')                 // 화면 전환 신호(+13-10 배치: mobile 은 map)를 MapView에 넘긴다
    fireEvent.click(within(list).getAllByRole('button')[0]!)
    expect(map()).toHaveAttribute('data-active-store', nearbyFixture.stores[0]!.id)   // 숨겨진 지도에 선택만 넘긴다

    fireEvent.click(screen.getAllByRole('button', { name: '지도 보기' })[0]!)
    expect(app()).toHaveAttribute('data-screen', 'map')
    expect(map()).toHaveAttribute('data-layout-key', 'map:open:map')
    expect(map()).toHaveAttribute('data-active-store', nearbyFixture.stores[0]!.id)
    expect(map()).toHaveAttribute('data-stores', '12')
    expect(analyzeCalls(fetchMock)).toHaveLength(1)
    expect(nearbyCalls(fetchMock)).toHaveLength(1)

    // 지도 화면에서 고른 선택도 패널로 갔다 와도 유지
    fireEvent.click(screen.getByRole('button', { name: `지도 점포 마커: ${nearbyFixture.stores[1]!.name}` }))
    fireEvent.click(screen.getByRole('button', { name: '결과 자세히' }))
    fireEvent.click(screen.getAllByRole('button', { name: '지도 보기' })[0]!)
    expect(map()).toHaveAttribute('data-active-store', nearbyFixture.stores[1]!.id)
    expect(nearbyCalls(fetchMock)).toHaveLength(1)
  })

  it('비교 요약·B 전체 결과: B 목록에서 고른 선택이 지도 화면으로 그대로 넘어가고 다시 조회하지 않는다', async () => {
    const fetchMock = mockApi({ analyze: [ok(fixture), ok(guwolFixture)], nearby: [ok(nearbyFixture), ok(guwolNearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    fireEvent.click(within(document.querySelector<HTMLElement>('.map-sheet')!).getByRole('button', { name: '좌표 직접 입력' }))
    const bCard = screen.getByRole('region', { name: 'B 비교 위치' })
    fireEvent.change(within(bCard).getByLabelText('B 위도'), { target: { value: '37.4475' } })
    fireEvent.change(within(bCard).getByLabelText('B 경도'), { target: { value: '126.7015' } })
    fireEvent.click(within(bCard).getByRole('button', { name: 'B 위치로 선택' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'B 비교 위치' })).getByRole('button', { name: 'B 분석하기' }))
    const bList = await findList('B 남동구 구월3동 PC방 점포 목록')
    expect(app()).toHaveAttribute('data-screen', 'panel')

    fireEvent.click(within(bList).getAllByRole('button')[0]!)
    expect(map()).toHaveAttribute('data-active-store', guwolNearbyFixture.stores[0]!.id)
    fireEvent.click(screen.getAllByRole('button', { name: '지도 보기' })[0]!)
    expect(app()).toHaveAttribute('data-screen', 'map')
    expect(map()).toHaveAttribute('data-active-store', guwolNearbyFixture.stores[0]!.id)
    expect(map()).toHaveAttribute('data-store-context', 'B 구월3동 주변')

    fireEvent.click(screen.getByRole('button', { name: '비교 화면 보기' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'B 전체 결과 보기' })[0]!)
    fireEvent.click(within(getList('B 남동구 구월3동 PC방 점포 목록')).getAllByRole('button')[1]!)
    expect(map()).toHaveAttribute('data-active-store', guwolNearbyFixture.stores[1]!.id)
    fireEvent.click(screen.getAllByRole('button', { name: '지도 보기' })[0]!)
    expect(map()).toHaveAttribute('data-active-store', guwolNearbyFixture.stores[1]!.id)
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
    expect(nearbyCalls(fetchMock)).toHaveLength(2)
  })
})

describe('StrictMode: A/B 전체 결과를 열 때 스크롤 초기화 → 포커스 순서 (6-5, 개발 모드)', () => {
  const ok = (body: unknown) => ({ status: 200, body })
  const PANEL = '두 위치 비교 · PC방'

  /** 스크롤 초기화(scrollTop 쓰기)와 포커스 이동을 일어난 순서대로 적는다 */
  function recordScrollAndFocus() {
    const log: string[] = []
    const scrollSet = vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, v: number) {
      log.push(`scroll:${this.tagName.toLowerCase()}${this.className ? '.' + String(this.className).split(' ')[0] : ''}=${v}`)
    })
    const focus = HTMLElement.prototype.focus
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, o?: FocusOptions) {
      log.push(`focus:${this.id || this.tagName.toLowerCase()}`)
      focus.call(this, o)
    })
    return {
      log,
      restore: () => {
        scrollSet.mockRestore()
        focusSpy.mockRestore()
      },
    }
  }

  async function compareInStrictMode() {
    const fetchMock = mockApi({ analyze: [ok(fixture), ok(guwolFixture)], nearby: [ok(nearbyFixture), ok(guwolNearbyFixture)] })
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    const bCard = screen.getByRole('region', { name: 'B 비교 위치' })
    fireEvent.change(within(bCard).getByLabelText('B 위도'), { target: { value: '37.4475' } })
    fireEvent.change(within(bCard).getByLabelText('B 경도'), { target: { value: '126.7015' } })
    fireEvent.click(within(bCard).getByRole('button', { name: 'B 위치로 선택' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'B 비교 위치' })).getByRole('button', { name: 'B 분석하기' }))
    await findScoreTable()
    await findList('B 남동구 구월3동 PC방 점포 목록')
    return fetchMock
  }

  it.each(['A', 'B'] as const)('%s 전체 결과: 조상 스크롤을 맨 위로 둔 다음 결과 제목에 포커스하고, 그 뒤에는 스크롤을 다시 바꾸지 않는다', async (side) => {
    const fetchMock = await compareInStrictMode()
    const rec = recordScrollAndFocus()
    try {
      fireEvent.click(screen.getByRole('button', { name: `${side} 전체 결과 보기` }))
      const title = screen.getByRole('heading', { level: 1, name: new RegExp(`^${side} · `) })
      expect(document.activeElement).toBe(title)
      const focusAt = rec.log.indexOf('focus:result-title')
      expect(focusAt).toBeGreaterThan(-1)
      // 문서(html)·desktop 패널(main) 스크롤을 맨 위로 — 포커스 전에
      expect(rec.log.slice(0, focusAt)).toEqual(expect.arrayContaining(['scroll:html=0', 'scroll:main.workspace__panel=0']))
      // 포커스 뒤에는 스크롤 초기화가 없다(StrictMode 이중 실행이 포커스로 맞춘 화면을 되돌리지 않는다)
      expect(rec.log.slice(focusAt + 1).filter((l) => l.startsWith('scroll:'))).toEqual([])
      expect(rec.log.filter((l) => l === 'focus:result-title')).toHaveLength(1)
    } finally {
      rec.restore()
    }

    // 복귀: 누른 "전체 결과 보기" 버튼으로 포커스, 재요청 없음
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `${side} 전체 결과 보기` }))
    expect(screen.getByRole('heading', { level: 1, name: PANEL })).toBeInTheDocument()
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
    expect(nearbyCalls(fetchMock)).toHaveLength(2)
  })

  it('열기·복귀를 반복해도 매번 같은 순서이고 다시 조회하지 않는다', async () => {
    const fetchMock = await compareInStrictMode()
    for (const side of ['A', 'B', 'A', 'B'] as const) {
      const rec = recordScrollAndFocus()
      try {
        fireEvent.click(screen.getByRole('button', { name: `${side} 전체 결과 보기` }))
        const focusAt = rec.log.indexOf('focus:result-title')
        expect(focusAt).toBeGreaterThan(-1)
        expect(rec.log.slice(focusAt + 1).filter((l) => l.startsWith('scroll:'))).toEqual([])
      } finally {
        rec.restore()
      }
      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: `${side} 전체 결과 보기` }))
    }
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
    expect(nearbyCalls(fetchMock)).toHaveLength(2)
  })
})

describe('분석 반경 (8-D3, D-024, docs/UX_REDESIGN.md 4.3~4.6)', () => {
  const ok = (body: unknown) => ({ status: 200, body })
  const engine = (version: string, radius_options: number[]) => ({
    status: 200,
    body: { ...OLD_HEALTH, engine: { version, radius_options, default_radius_m: 500 } },
  })
  const V04 = engine('mvp-0.4', [300, 500, 1000])
  const NEW_V03 = engine('mvp-0.3', [500])
  const OLD = { status: 200, body: OLD_HEALTH }
  const invalidRadius = {
    status: 422,
    body: { error: { code: 'invalid_radius', message: '지원하지 않는 분석 반경입니다(가능: 500m).' } },
  }

  /** fixture 를 반경 r·엔진 버전으로 바꾼 사본 (점수는 그대로 — 화면 흐름만 본다) */
  function at<T>(fx: T, r: number, version = 'mvp-0.4'): T {
    const c = structuredClone(fx) as { result: { meta: Record<string, unknown>; 지표: { raw: Record<string, unknown> }[] } }
    c.result.meta.분석반경_m = r
    c.result.meta.엔진버전 = version
    c.result.지표[2]!.raw.반경m = r
    return c as T
  }
  function nearbyAt<T>(fx: T, r: number): T {
    return { ...(structuredClone(fx) as object), radius_m: r } as T
  }
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)
  const radiusGroup = () => screen.queryByRole('group', { name: '분석 반경' })
  const chip = (label: string) => within(screen.getByRole('group', { name: '분석 반경' })).getByRole('button', { name: label })
  const healthCalls = (f: Mock) => f.mock.calls.filter(([url]) => url === '/health')
  const RESULT = { level: 1, name: '부평구 부평1동 · PC방 분석' } as const
  const storesHeading = (r: string) => findInTab(STORES_TAB, 'heading', { name: new RegExp(`반경 ${r} 안 같은 업종 점포`) })

  async function analyzeAt(health: Reply | Reply[], analyzeReplies: Reply[], nearbyReplies: Reply[] = []) {
    const fetchMock = mockApi({ health, analyze: analyzeReplies, nearby: nearbyReplies })
    render(<App />)
    await selectBupyeongPcBang()
    await waitFor(() => expect(healthCalls(fetchMock).length).toBeGreaterThan(0))
    return fetchMock
  }

  describe('서버 세 종류의 광고 (4.6 표, 테스트 (g))', () => {
    it.each([
      ['구버전 서버(engine 없음)', OLD],
      ['새 v0.3 서버(radius_options [500])', NEW_V03],
    ])('%s: 반경 선택을 숨기고 요청 body 에 radius_m 을 넣지 않는다', async (_, health) => {
      const fetchMock = await analyzeAt(health, [ok(fixture)], [ok(nearbyFixture)])
      fireEvent.click(analyzeButton())
      expect(await screen.findByRole('heading', RESULT)).toBeInTheDocument()
      expect(radiusGroup()).not.toBeInTheDocument()
      expect(bodyOf(analyzeCalls(fetchMock)[0]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
      await waitFor(() => expect(nearbyCalls(fetchMock)).toHaveLength(1))
      expect(bodyOf(nearbyCalls(fetchMock)[0]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '500')
    })

    it('v0.4 서버(300·500·1,000): 반경 선택을 보이고 기본 500, 요청 body 에 radius_m 을 넣는다', async () => {
      const fetchMock = await analyzeAt(V04, [ok(at(fixture, 500))], [ok(nearbyAt(nearbyFixture, 500))])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      expect(within(radiusGroup()!).getAllByRole('button').map((b) => b.textContent)).toEqual(['300m', '500m', '1km'])
      expect(chip('500m')).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(analyzeButton())
      expect(await screen.findByRole('heading', RESULT)).toBeInTheDocument()
      expect(bodyOf(analyzeCalls(fetchMock)[0]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 500 })
      await waitFor(() => expect(nearbyCalls(fetchMock)).toHaveLength(1))
      expect(bodyOf(nearbyCalls(fetchMock)[0]!)).toMatchObject({ radius_m: 500 })
    })

    it('/health 실패는 광고 없음과 같다(반경 선택 없음, 지금과 같은 body)', async () => {
      const fetchMock = await analyzeAt('network-error', [ok(fixture)], [ok(nearbyFixture)])
      fireEvent.click(analyzeButton())
      expect(await screen.findByRole('heading', RESULT)).toBeInTheDocument()
      expect(radiusGroup()).not.toBeInTheDocument()
      expect(bodyOf(analyzeCalls(fetchMock)[0]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
    })
  })

  describe('반경 전환 상태표 (4.4)', () => {
    it('S1 분석 전 변경: 요청 없이 지도 원만 바꾸고, 분석하면 그 반경으로 요청한다', async () => {
      const fetchMock = await analyzeAt(V04, [ok(at(fixture, 1000))], [ok(nearbyAt(nearbyFixture, 1000))])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('1km'))
      expect(chip('1km')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '1000')
      expect(analyzeCalls(fetchMock)).toHaveLength(0)
      fireEvent.click(analyzeButton())
      expect(await screen.findByRole('heading', RESULT)).toBeInTheDocument()
      expect(bodyOf(analyzeCalls(fetchMock)[0]!)).toMatchObject({ radius_m: 1000 })
      expect(await storesHeading('1km')).toBeInTheDocument()
    })

    it('S3 결과에서 변경(미적중): 같은 조건을 새 반경으로 다시 분석하고, S2 이전 반경으로 돌아오면 요청 0', async () => {
      const fetchMock = await analyzeAt(
        V04,
        [ok(at(fixture, 500)), ok(at(fixture, 1000))],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(nearbyFixture, 1000))],
      )
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(analyzeButton())
      expect(await storesHeading('500m')).toBeInTheDocument()

      fireEvent.click(chip('1km'))
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '1000')   // 지도 원은 즉시
      expect(await storesHeading('1km')).toBeInTheDocument()
      expect(analyzeCalls(fetchMock).map(bodyOf).map((b) => b.radius_m)).toEqual([500, 1000])
      expect(nearbyCalls(fetchMock).map(bodyOf).map((b) => b.radius_m)).toEqual([500, 1000])

      fireEvent.click(chip('500m'))                                          // 캐시 적중
      expect(await storesHeading('500m')).toBeInTheDocument()
      expect(analyzeCalls(fetchMock)).toHaveLength(2)
      expect(nearbyCalls(fetchMock)).toHaveLength(2)
    })

    it('S15 분석 중에는 반경을 누를 수 없다', async () => {
      let respond!: (r: { status: number; body: unknown }) => void
      const pendingReply = new Promise<{ status: number; body: unknown }>((r) => (respond = r))
      await analyzeAt(V04, [pendingReply], [ok(nearbyAt(nearbyFixture, 500))])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(analyzeButton())
      for (const b of within(radiusGroup()!).getAllByRole('button')) expect(b).toBeDisabled()
      await act(async () => respond(ok(at(fixture, 500))))
      await screen.findByRole('heading', RESULT)
      for (const b of within(radiusGroup()!).getAllByRole('button')) expect(b).toBeEnabled()
    })

    it('부분 캐시: 점포만 실패한 반경으로 돌아오면 분석은 즉시, 점포만 다시 조회한다', async () => {
      const fetchMock = await analyzeAt(
        V04,
        [ok(at(fixture, 500)), ok(at(fixture, 300))],
        ['network-error', ok(nearbyAt(nearbyFixture, 300)), ok(nearbyAt(nearbyFixture, 500))],
      )
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(analyzeButton())
      await screen.findByRole('heading', RESULT)
      await waitFor(() => expect(nearbyCalls(fetchMock)).toHaveLength(1))
      fireEvent.click(chip('300m'))
      expect(await storesHeading('300m')).toBeInTheDocument()
      fireEvent.click(chip('500m'))
      expect(await storesHeading('500m')).toBeInTheDocument()
      expect(analyzeCalls(fetchMock)).toHaveLength(2)                         // 분석은 캐시
      expect(nearbyCalls(fetchMock).map(bodyOf).map((b) => b.radius_m)).toEqual([500, 300, 500])
    })

    it('S5 응답 반경 불일치인데 서버가 그 반경을 여전히 광고하면: 복구하지 않고 오류로 둔다(재분석 없음)', async () => {
      const fetchMock = await analyzeAt(V04, [ok(at(fixture, 500))])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('1km'))
      fireEvent.click(analyzeButton())
      expect(await screen.findByText('분석 결과를 표시할 수 없습니다')).toBeInTheDocument()
      await waitFor(() => expect(healthCalls(fetchMock)).toHaveLength(2))   // /health 재조회
      expect(analyzeCalls(fetchMock)).toHaveLength(1)
      expect(screen.queryByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).not.toBeInTheDocument()
      expect(radiusGroup()).toBeInTheDocument()
    })

    it('S8 반경 변경 실패: "이전 반경으로"는 캐시라 요청 0', async () => {
      const fetchMock = await analyzeAt(
        V04,
        [ok(at(fixture, 500)), { status: 500, body: internalError }],
        [ok(nearbyAt(nearbyFixture, 500))],
      )
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(analyzeButton())
      await storesHeading('500m')
      fireEvent.click(chip('1km'))
      expect(await screen.findByText('분석 중 문제가 생겼습니다')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '이전 반경(500m)으로 돌아가기' }))
      expect(await storesHeading('500m')).toBeInTheDocument()
      expect(analyzeCalls(fetchMock)).toHaveLength(2)
      expect(nearbyCalls(fetchMock)).toHaveLength(1)
    })
  })

  describe('복구 경로 R1·R2 (4.6, 테스트 (f))', () => {
    it('R1 구버전 서버로 바뀜: 1km 요청 → 500m 응답 → /health 재조회(광고 없음) → 선택 숨김·500 복귀·재분석 1회(radius_m 없음)', async () => {
      const fetchMock = await analyzeAt([V04, OLD], [ok(at(fixture, 500, 'mvp-0.3')), ok(fixture)], [ok(nearbyFixture)])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('1km'))
      fireEvent.click(analyzeButton())
      expect(await screen.findByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).toBeInTheDocument()
      expect(await screen.findByRole('heading', RESULT)).toBeInTheDocument()
      expect(radiusGroup()).not.toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '500')
      expect(analyzeCalls(fetchMock).map(bodyOf)).toEqual([
        { lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 1000 },
        { lat: 37.4894, lng: 126.7246, biz_code: 'R10406' },
      ])
      await waitFor(() => expect(nearbyCalls(fetchMock)).toHaveLength(1))
      expect(bodyOf(nearbyCalls(fetchMock)[0]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
    })

    it('R2 새 v0.3 서버로 바뀜: 300m 요청 → 422 invalid_radius → /health 재조회([500]) → 공통 복구, 재분석 1회', async () => {
      const fetchMock = await analyzeAt([V04, NEW_V03], [invalidRadius, ok(fixture)], [ok(nearbyFixture)])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('300m'))
      fireEvent.click(analyzeButton())
      expect(await screen.findByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).toBeInTheDocument()
      expect(await screen.findByRole('heading', RESULT)).toBeInTheDocument()
      expect(radiusGroup()).not.toBeInTheDocument()
      expect(analyzeCalls(fetchMock).map(bodyOf).map((b) => b.radius_m)).toEqual([300, undefined])
    })

    it('R2 재분석이 다시 실패해도 반복하지 않는다(오류로 둔다)', async () => {
      const fetchMock = await analyzeAt([V04, NEW_V03], [invalidRadius, { status: 500, body: internalError }])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('300m'))
      fireEvent.click(analyzeButton())
      expect(await screen.findByText('분석 중 문제가 생겼습니다')).toBeInTheDocument()
      await new Promise((r) => setTimeout(r, 50))
      expect(analyzeCalls(fetchMock)).toHaveLength(2)
      expect(healthCalls(fetchMock)).toHaveLength(2)
    })

    it('R2 인데 서버가 그 반경을 아직 광고하면 복구하지 않고 invalid_radius 오류로 둔다', async () => {
      const fetchMock = await analyzeAt(V04, [invalidRadius])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('300m'))
      fireEvent.click(analyzeButton())
      expect(await screen.findByText('선택한 분석 반경을 지금 분석할 수 없습니다')).toBeInTheDocument()
      await waitFor(() => expect(healthCalls(fetchMock)).toHaveLength(2))
      expect(analyzeCalls(fetchMock)).toHaveLength(1)
      expect(radiusGroup()).toBeInTheDocument()
    })

    it('R2 점포 조회(/nearby-stores)의 invalid_radius 도 같은 복구 — 분석·점포를 500m로 다시', async () => {
      const fetchMock = await analyzeAt([V04, NEW_V03], [ok(at(fixture, 1000)), ok(fixture)], [invalidRadius, ok(nearbyFixture)])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('1km'))
      fireEvent.click(analyzeButton())
      expect(await screen.findByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).toBeInTheDocument()
      expect(await storesHeading('500m')).toBeInTheDocument()
      expect(analyzeCalls(fetchMock).map(bodyOf).map((b) => b.radius_m)).toEqual([1000, undefined])
      expect(nearbyCalls(fetchMock).map(bodyOf).map((b) => b.radius_m)).toEqual([1000, undefined])
    })
    it('R2 복구 — 서버 엔진이 바뀌면(mvp-0.4 → mvp-0.3) 이전 500m 캐시를 쓰지 않고 새 서버에서 다시 조회한다', async () => {
      const fetchMock = await analyzeAt(
        [V04, NEW_V03],
        [ok(at(fixture, 500)), invalidRadius, ok(fixture)],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyFixture)],
      )
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(analyzeButton())
      await storesHeading('500m')
      fireEvent.click(chip('300m'))
      expect(await screen.findByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).toBeInTheDocument()
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(3))
      expect(await storesHeading('500m')).toBeInTheDocument()
      expect(bodyOf(analyzeCalls(fetchMock)[2]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
      await waitFor(() => expect(nearbyCalls(fetchMock)).toHaveLength(2))
    })

    it('R1 복구 — 버전을 알리지 않는 구버전 서버로 바뀌면 이전 캐시를 쓰지 않고 다시 조회한다', async () => {
      const fetchMock = await analyzeAt(
        [V04, OLD],
        [ok(at(fixture, 500)), ok(at(fixture, 500, 'mvp-0.3')), ok(fixture)],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyFixture)],
      )
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(analyzeButton())
      await storesHeading('500m')
      fireEvent.click(chip('1km'))                                           // 구버전 서버가 radius_m 을 무시하고 500m 응답
      expect(await screen.findByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).toBeInTheDocument()
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(3))
      expect(analyzeCalls(fetchMock).map(bodyOf).map((b) => b.radius_m)).toEqual([500, 1000, undefined])
      expect(await storesHeading('500m')).toBeInTheDocument()
    })

    it('무효가 된 이전 복구가 새 세대의 복구를 막지 않는다 — 이전 /health 응답이 끝난 뒤 새 요청이 /health 를 다시 보고 500m로 복구', async () => {
      let resolveOldHealth!: (r: { status: number; body: unknown }) => void
      const pendingOldHealth = new Promise<{ status: number; body: unknown }>((resolve) => (resolveOldHealth = resolve))
      const fetchMock = await analyzeAt([V04, pendingOldHealth, NEW_V03], [invalidRadius, invalidRadius, ok(fixture)], [ok(nearbyFixture)])
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('300m'))
      fireEvent.click(analyzeButton())
      await screen.findByText('선택한 분석 반경을 지금 분석할 수 없습니다')
      await waitFor(() => expect(healthCalls(fetchMock)).toHaveLength(2))   // 이전 세대 복구: 응답 보류
      fireEvent.click(chip('1km'))
      fireEvent.click(analyzeButton())                                       // 새 세대 — 이것도 invalid_radius
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(2))
      await waitFor(() => expect(healthCalls(fetchMock)).toHaveLength(3))   // 새 세대 복구가 바로 /health 를 본다
      await act(async () => resolveOldHealth(NEW_V03))                       // 이전 응답은 무효(아무것도 바꾸지 않음)
      expect(await screen.findByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).toBeInTheDocument()
      expect(await screen.findByRole('heading', RESULT)).toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '500')
      expect(analyzeCalls(fetchMock).map(bodyOf).map((b) => b.radius_m)).toEqual([300, 1000, undefined])   // 재분석 1회
    })

    it('늦게 온 복구용 /health 응답은 그사이 새로 성공한 분석을 덮지 않는다(광고·반경·캐시·안내·요청 그대로)', async () => {
      let resolveHealth!: (r: { status: number; body: unknown }) => void
      const pendingHealth = new Promise<{ status: number; body: unknown }>((resolve) => (resolveHealth = resolve))
      const fetchMock = await analyzeAt(
        [V04, pendingHealth],
        [invalidRadius, ok(at(fixture, 1000))],
        [ok(nearbyAt(nearbyFixture, 1000))],
      )
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('300m'))
      fireEvent.click(analyzeButton())
      await screen.findByText('선택한 분석 반경을 지금 분석할 수 없습니다')
      await waitFor(() => expect(healthCalls(fetchMock)).toHaveLength(2))   // 복구 시작(응답 보류)
      fireEvent.click(chip('1km'))
      fireEvent.click(analyzeButton())
      expect(await storesHeading('1km')).toBeInTheDocument()
      await act(async () => resolveHealth(NEW_V03))                         // 이제 도착한 이전 복구 응답
      await act(async () => new Promise((r) => setTimeout(r, 50)))
      expect(analyzeCalls(fetchMock)).toHaveLength(2)
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '1000')
      expect(screen.queryByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).not.toBeInTheDocument()
      expect(chip('1km')).toHaveAttribute('aria-pressed', 'true')            // 광고(반경 선택)도 그대로
      expect(await storesHeading('1km')).toBeInTheDocument()
    })

  })

  describe('비교 (S9·S11, 공통 복구의 A·B)', () => {
    const PANEL = '두 위치 비교 · PC방'
    const panel = () => screen.getByRole('region', { name: PANEL })
    const bCard = () => within(panel()).getByRole('region', { name: 'B 비교 위치' })
    const summaryTable = () => findScoreTable()

    async function startCompareAt(health: Reply | Reply[], analyzeReplies: Reply[], nearbyReplies: Reply[]) {
      const fetchMock = await analyzeAt(health, analyzeReplies, nearbyReplies)
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(analyzeButton())
      await screen.findByRole('heading', RESULT)
      fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
      fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.4475' } })
      fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.7015' } })
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
      return fetchMock
    }

    it('S9 비교 중 반경 변경: A·B 를 같은 새 반경으로 함께 다시 분석하고, 둘 다 되면 비교 요약을 다시 보인다', async () => {
      const fetchMock = await startCompareAt(
        V04,
        [ok(at(fixture, 500)), ok(at(guwolFixture, 500)), ok(at(fixture, 1000)), ok(at(guwolFixture, 1000))],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 1000))],
      )
      await summaryTable()
      fireEvent.click(chip('1km'))
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '1000')
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(4))
      expect(await summaryTable()).toBeInTheDocument()
      expect(analyzeCalls(fetchMock).map(bodyOf).slice(2)).toEqual([
        { lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 1000 },
        { lat: 37.4475, lng: 126.7015, biz_code: 'R10406', radius_m: 1000 },
      ])
      expect(screen.getByTestId('map')).toHaveAttribute('data-compare-location', '37.4475,126.7015')
    })

    it('S11 비교 중 반경 변경에서 A 실패: 비교를 유지하고, 다시 시도는 A·B 를 함께(B 는 캐시) 다시 분석한다', async () => {
      const fetchMock = await startCompareAt(
        V04,
        [
          ok(at(fixture, 500)),
          ok(at(guwolFixture, 500)),
          { status: 500, body: internalError },
          ok(at(guwolFixture, 300)),
          ok(at(fixture, 300)),
        ],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 300))],
      )
      await summaryTable()
      fireEvent.click(chip('300m'))
      expect(await screen.findByText('분석 중 문제가 생겼습니다')).toBeInTheDocument()
      expect(screen.getByText(/비교 중 A 위치를 다시 분석하지 못했습니다/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
      expect(await summaryTable()).toBeInTheDocument()
      expect(analyzeCalls(fetchMock).map(bodyOf).slice(2).map((b) => [b.lat, b.radius_m])).toEqual([
        [37.4894, 300],
        [37.4475, 300],
        [37.4894, 300],
      ])
    })

    it('비교 중 R2 복구(500m 캐시 없음): A·B 모두 500m(radius_m 없음)로 다시 분석한다', async () => {
      const fetchMock = mockApi({
        health: [V04, NEW_V03],
        analyze: [ok(at(fixture, 300)), ok(at(guwolFixture, 300)), invalidRadius, invalidRadius, ok(fixture), ok(guwolFixture)],
        nearby: [ok(nearbyAt(nearbyFixture, 300)), ok(nearbyAt(guwolNearbyFixture, 300)), ok(guwolNearbyFixture)],
      })
      render(<App />)
      await selectBupyeongPcBang()
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('300m'))                                          // 처음부터 300m — 500m 결과가 캐시에 없다
      fireEvent.click(analyzeButton())
      await screen.findByRole('heading', RESULT)
      fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
      fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.4475' } })
      fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.7015' } })
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
      await summaryTable()
      fireEvent.click(chip('1km'))
      expect(await screen.findByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).toBeInTheDocument()
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(6))
      expect(await summaryTable()).toBeInTheDocument()
      expect(radiusGroup()).not.toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '500')
      expect(analyzeCalls(fetchMock).map(bodyOf)).toEqual([
        { lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 300 },
        { lat: 37.4475, lng: 126.7015, biz_code: 'R10406', radius_m: 300 },
        { lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 1000 },
        { lat: 37.4475, lng: 126.7015, biz_code: 'R10406', radius_m: 1000 },
        { lat: 37.4894, lng: 126.7246, biz_code: 'R10406' },
        { lat: 37.4475, lng: 126.7015, biz_code: 'R10406' },
      ])
    })

    it('S11 A 실패·B 성공으로 요청이 모두 끝나면 반경 선택과 "이전 반경으로"가 가능하고, 누르면 캐시된 A·B 500m 비교로 돌아간다(요청 0)', async () => {
      const fetchMock = await startCompareAt(
        V04,
        [ok(at(fixture, 500)), ok(at(guwolFixture, 500)), { status: 500, body: internalError }, ok(at(guwolFixture, 300))],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 300))],
      )
      await summaryTable()
      fireEvent.click(chip('300m'))
      await screen.findByText('분석 중 문제가 생겼습니다')
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(4))
      await waitFor(() => expect(nearbyCalls(fetchMock)).toHaveLength(3))
      expect(queryScoreTable()).not.toBeInTheDocument()   // 표시 보류는 그대로
      for (const b of within(radiusGroup()!).getAllByRole('button')) expect(b).toBeEnabled()
      const back = screen.getByRole('button', { name: '이전 반경(500m)으로 돌아가기' })
      expect(back).toBeEnabled()
      fireEvent.click(back)
      expect(await summaryTable()).toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-radius', '500')
      expect(chip('500m')).toHaveAttribute('aria-pressed', 'true')
      expect(analyzeCalls(fetchMock)).toHaveLength(4)                         // A·B 500m 모두 캐시
    })

    it('S11 A 실패·B 요청 중에는 반경 조작을 막고(S15), B 가 끝나면 다시 가능하다', async () => {
      let resolveB!: (r: { status: number; body: unknown }) => void
      const pendingB = new Promise<{ status: number; body: unknown }>((resolve) => (resolveB = resolve))
      const fetchMock = await startCompareAt(
        V04,
        [ok(at(fixture, 500)), ok(at(guwolFixture, 500)), { status: 500, body: internalError }, pendingB],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 300))],
      )
      await summaryTable()
      fireEvent.click(chip('300m'))
      await screen.findByText('분석 중 문제가 생겼습니다')                    // A 실패, B 는 아직 요청 중
      for (const b of within(radiusGroup()!).getAllByRole('button')) expect(b).toBeDisabled()
      expect(screen.getByRole('button', { name: '이전 반경(500m)으로 돌아가기' })).toBeDisabled()
      fireEvent.click(chip('1km'))                                           // 눌러도(disabled) 아무 요청 없음
      expect(analyzeCalls(fetchMock)).toHaveLength(4)
      await act(async () => resolveB(ok(at(guwolFixture, 300))))
      await waitFor(() => expect(chip('1km')).toBeEnabled())
      expect(screen.getByRole('button', { name: '이전 반경(500m)으로 돌아가기' })).toBeEnabled()
    })

    it('비교 중 R2 복구 — 서버 엔진이 바뀌면(mvp-0.4 → mvp-0.3) 500m 캐시도 버리고 A·B 를 새 서버에서 다시 조회한다. 이어서 새 B 와 정상 비교', async () => {
      const fetchMock = await startCompareAt(
        [V04, NEW_V03],
        [
          ok(at(fixture, 500)),
          ok(at(guwolFixture, 500)),
          invalidRadius,
          invalidRadius,
          ok(fixture),
          ok(guwolFixture),
          ok(songdoFixture),
        ],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 500)), ok(guwolNearbyFixture), ok(songdoNearbyFixture)],
      )
      await summaryTable()
      fireEvent.click(chip('1km'))
      expect(await screen.findByText('서버가 바뀌어 반경 500m로 다시 분석합니다')).toBeInTheDocument()
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(6))
      expect(await summaryTable()).toBeInTheDocument()
      expect(radiusGroup()).not.toBeInTheDocument()
      expect(analyzeCalls(fetchMock).map(bodyOf).slice(4)).toEqual([
        { lat: 37.4894, lng: 126.7246, biz_code: 'R10406' },
        { lat: 37.4475, lng: 126.7015, biz_code: 'R10406' },
      ])
      // 복구 뒤 새 B(송도, mvp-0.3)와 정상 비교 — A도 새 서버(mvp-0.3) 결과라 버전이 맞는다
      fireEvent.click(screen.getByRole('button', { name: 'B 다시 고르기' }))
      fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.392512' } })
      fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.639034' } })
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
      expect(await summaryTable()).toBeInTheDocument()
      expect(bodyOf(analyzeCalls(fetchMock)[6]!)).toEqual({ lat: 37.392512, lng: 126.639034, biz_code: 'R10406' })
    })

    it('엔진버전 대조는 응답 순서와 무관 — B(mvp-0.3)가 먼저, A(mvp-0.4)가 나중에 와도 비교 요약을 보이지 않고 캐시를 버린다', async () => {
      let resolveA!: (r: { status: number; body: unknown }) => void
      const pendingA = new Promise<{ status: number; body: unknown }>((resolve) => (resolveA = resolve))
      const fetchMock = mockApi({
        health: V04,
        analyze: [ok(at(fixture, 300)), ok(at(guwolFixture, 300)), pendingA, ok(guwolFixture), ok(at(fixture, 300))],
        nearby: [ok(nearbyAt(nearbyFixture, 300)), ok(nearbyAt(guwolNearbyFixture, 300)), ok(guwolNearbyFixture), ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(nearbyFixture, 300))],
      })
      render(<App />)
      await selectBupyeongPcBang()
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('300m'))
      fireEvent.click(analyzeButton())
      await screen.findByRole('heading', RESULT)
      fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
      fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.4475' } })
      fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.7015' } })
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
      await summaryTable()
      fireEvent.click(chip('500m'))
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(4))   // A(보류)·B(mvp-0.3, 먼저 도착)
      await act(async () => new Promise((r) => setTimeout(r, 20)))
      await act(async () => resolveA(ok(at(fixture, 500))))                  // A(mvp-0.4) 나중
      expect(await screen.findByText('분석 결과를 표시할 수 없습니다')).toBeInTheDocument()
      expect(queryScoreTable()).not.toBeInTheDocument()
      expect(console.error).toHaveBeenCalledWith('[api] A·B 엔진·데이터 버전이 다릅니다', { a: ['mvp-0.4', null], b: ['mvp-0.3', null] })
      // 캐시를 버렸으므로 이전 300m A 도 다시 요청한다
      fireEvent.click(screen.getAllByRole('button', { name: /^비교 (종료|취소)$/ })[0]!)
      fireEvent.click(chip('300m'))
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(5))
      expect(bodyOf(analyzeCalls(fetchMock)[4]!)).toMatchObject({ lat: 37.4894, radius_m: 300 })
    })

    it.each([
      ['A→B', true],
      ['B→A', false],
    ])('엔진버전 대조 — A·B 가 같은 React 배치에서 함께 끝나도(%s) 섞인 결과를 비교표에 그리지 않는다', async (_, aFirst) => {
      let resolveA!: (r: { status: number; body: unknown }) => void
      let resolveB!: (r: { status: number; body: unknown }) => void
      const pendingA = new Promise<{ status: number; body: unknown }>((resolve) => (resolveA = resolve))
      const pendingB = new Promise<{ status: number; body: unknown }>((resolve) => (resolveB = resolve))
      const fetchMock = mockApi({
        health: V04,
        analyze: [ok(at(fixture, 300)), ok(at(guwolFixture, 300)), pendingA, pendingB],
        nearby: [ok(nearbyAt(nearbyFixture, 300)), ok(nearbyAt(guwolNearbyFixture, 300)), ok(nearbyAt(nearbyFixture, 500)), ok(guwolNearbyFixture)],
      })
      render(<App />)
      await selectBupyeongPcBang()
      await waitFor(() => expect(radiusGroup()).toBeInTheDocument())
      fireEvent.click(chip('300m'))
      fireEvent.click(analyzeButton())
      await screen.findByRole('heading', RESULT)
      fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
      fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.4475' } })
      fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.7015' } })
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
      await summaryTable()
      fireEvent.click(chip('500m'))
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(4))
      await act(async () => {
        if (aFirst) {
          resolveA(ok(at(fixture, 500)))                                   // A mvp-0.4
          resolveB(ok(guwolFixture))                                       // B mvp-0.3
        } else {
          resolveB(ok(guwolFixture))
          resolveA(ok(at(fixture, 500)))
        }
      })
      await act(async () => new Promise((r) => setTimeout(r, 30)))
      expect(queryScoreTable()).not.toBeInTheDocument()
      expect(await screen.findByText('분석 결과를 표시할 수 없습니다')).toBeInTheDocument()
      expect(console.error).toHaveBeenCalledWith('[api] A·B 엔진·데이터 버전이 다릅니다', { a: ['mvp-0.4', null], b: ['mvp-0.3', null] })
    })

    it('엔진버전 대조 — A(mvp-0.4)가 먼저, B(mvp-0.3)가 나중에 와도 같은 오류', async () => {
      let resolveB!: (r: { status: number; body: unknown }) => void
      const pendingB = new Promise<{ status: number; body: unknown }>((resolve) => (resolveB = resolve))
      const fetchMock = await startCompareAt(
        V04,
        [ok(at(fixture, 500)), ok(at(guwolFixture, 500)), ok(at(fixture, 300)), pendingB],
        [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(guwolNearbyFixture, 500)), ok(nearbyAt(nearbyFixture, 300))],
      )
      await summaryTable()
      fireEvent.click(chip('300m'))
      await waitFor(() => expect(analyzeCalls(fetchMock)).toHaveLength(4))
      await screen.findByRole('heading', { level: 1, name: PANEL })            // A 300m 먼저 도착, B 는 아직 분석 중
      await act(async () => resolveB(ok(at(guwolFixture, 300, 'mvp-0.3'))))
      expect(await within(bCard()).findByText('분석 결과를 표시할 수 없습니다')).toBeInTheDocument()
      expect(queryScoreTable()).not.toBeInTheDocument()
    })

    it('비교 점포 다시 시도는 원래 요청의 반경을 유지한다 — B 300m', async () => {
      const fetchMock = await startCompareAt(
        V04,
        [ok(at(fixture, 500)), ok(at(guwolFixture, 500)), ok(at(fixture, 300)), ok(at(guwolFixture, 300))],
        [
          ok(nearbyAt(nearbyFixture, 500)),
          ok(nearbyAt(guwolNearbyFixture, 500)),
          ok(nearbyAt(nearbyFixture, 300)),
          'network-error',
          ok(nearbyAt(guwolNearbyFixture, 300)),
        ],
      )
      await summaryTable()
      fireEvent.click(chip('300m'))
      await summaryTable()
      await screen.findByText('점포 목록을 불러오지 못했습니다. 분석 결과는 그대로입니다.')
      openTab(STORES_TAB)
      fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
      expect(await findInTab(STORES_TAB, 'heading', { name: /반경 300m 안 같은 업종 점포/ })).toBeInTheDocument()
      expect(bodyOf(nearbyCalls(fetchMock).at(-1)!)).toEqual({ lat: 37.4475, lng: 126.7015, biz_code: 'R10406', radius_m: 300 })
    })

    it('비교 점포 다시 시도 — A 기준 1km 도 반경을 유지한다', async () => {
      const fetchMock = await startCompareAt(
        V04,
        [ok(at(fixture, 500)), ok(at(guwolFixture, 500)), ok(at(fixture, 1000)), ok(at(guwolFixture, 1000))],
        [
          ok(nearbyAt(nearbyFixture, 500)),
          ok(nearbyAt(guwolNearbyFixture, 500)),
          'network-error',
          ok(nearbyAt(guwolNearbyFixture, 1000)),
          ok(nearbyAt(nearbyFixture, 1000)),
        ],
      )
      await summaryTable()
      fireEvent.click(chip('1km'))
      await summaryTable()
      fireEvent.click(within(getInTab(STORES_TAB, 'group', { name: '점포 기준 위치' })).getByRole('button', { name: /^A / }))   // 점포 기준 A
      await screen.findByText('점포 목록을 불러오지 못했습니다. 분석 결과는 그대로입니다.')
      openTab(STORES_TAB)
      fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
      expect(await findInTab(STORES_TAB, 'heading', { name: /반경 1km 안 같은 업종 점포/ })).toBeInTheDocument()
      expect(bodyOf(nearbyCalls(fetchMock).at(-1)!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 1000 })
    })

    it('구버전 서버에서는 비교 점포 다시 시도도 기존처럼 반경을 보내지 않는다', async () => {
      const fetchMock = mockApi({
        health: OLD,
        analyze: [ok(fixture), ok(guwolFixture)],
        nearby: [ok(nearbyFixture), 'network-error', ok(guwolNearbyFixture)],
      })
      render(<App />)
      await selectBupyeongPcBang()
      fireEvent.click(analyzeButton())
      await screen.findByRole('heading', RESULT)
      fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
      fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.4475' } })
      fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.7015' } })
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
      await summaryTable()
      await screen.findByText('점포 목록을 불러오지 못했습니다. 분석 결과는 그대로입니다.')
      openTab(STORES_TAB)
      fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
      await waitFor(() => expect(nearbyCalls(fetchMock)).toHaveLength(3))
      expect(bodyOf(nearbyCalls(fetchMock).at(-1)!)).toEqual({ lat: 37.4475, lng: 126.7015, biz_code: 'R10406' })
    })

    it('A·B 엔진버전이 다르면 B 를 계약 오류로 둔다(한 비교에 두 엔진을 섞지 않는다)', async () => {
      await startCompareAt(V04, [ok(at(fixture, 500)), ok(at(guwolFixture, 500, 'mvp-0.3'))], [ok(nearbyAt(nearbyFixture, 500))])
      expect(await within(bCard()).findByText('분석 결과를 표시할 수 없습니다')).toBeInTheDocument()
    })
  })
})

describe('모바일 지도 sheet — 주의 요약 띠 첫 줄 (8-C1a)', () => {
  const ok = (body: unknown) => ({ status: 200, body })

  it('단일 결과: sheet 에 띠 첫 줄만(지금 선택과 같은 좌표의 결과일 때)', async () => {
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    const sheet = document.querySelector<HTMLElement>('.map-sheet')!
    expect(within(sheet).getByText('학교 주변 규제 업종 · 300m 안 초·중·고 0곳')).toBeInTheDocument()
    expect(sheet.querySelectorAll('.band-peek')).toHaveLength(1)
  })

  it('비교 성공: sheet 에 비교 띠 첫 줄(†)', async () => {
    mockApi({ analyze: [ok(fixture), ok(ganghwaPeekFixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    const bCard = () => within(screen.getByRole('region', { name: '두 위치 비교 · PC방' })).getByRole('region', { name: 'B 비교 위치' })
    fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.7466' } })
    fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.4878' } })
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    await findScoreTable()
    const sheet = document.querySelector<HTMLElement>('.map-sheet')!
    expect(within(sheet).getByText('종합 계산 구성이 다릅니다 · A 5개 관점, B 4개(안정성 미산출)')).toBeInTheDocument()
  })
})

describe('테마 전환 (묶음 A, DESIGN.md §19.7)', () => {
  afterEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('첫 방문은 시스템 설정을 따르고, 버튼을 누르면 반대 테마로 바꿔 저장하며 MapView에 넘긴다', async () => {
    mockApi()
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-color-scheme: dark)', media: q }))
    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByTestId('map')).toHaveAttribute('data-theme', 'dark')
    const button = screen.getByRole('button', { name: '라이트 모드로 전환' })
    fireEvent.click(button)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByTestId('map')).toHaveAttribute('data-theme', 'light')
    expect(window.localStorage.getItem('theme')).toBe('light')
    expect(screen.getByRole('button', { name: '다크 모드로 전환' })).toBeInTheDocument()
  })

  it('저장된 선택이 있으면 시스템 설정보다 우선한다', async () => {
    mockApi()
    window.localStorage.setItem('theme', 'light')
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-color-scheme: dark)', media: q }))
    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('button', { name: '다크 모드로 전환' })).toBeInTheDocument()
  })
})

describe('첫 방문 안내 (묶음 D, docs/ONBOARDING_DESIGN.md)', () => {
  const COACH = { name: '사용 방법 안내' }
  const conditions = () => screen.getByRole('region', { name: '분석 조건' })
  /** 조건 패널 안의 말풍선(mobile 시트의 같은 단계는 DOM에 따로 있다 — CSS로만 숨김) */
  const coachInConditions = () => within(conditions()).queryByRole('status', COACH)
  const sheet = () => document.querySelector('.map-sheet') as HTMLElement
  const firstVisit = () => {
    window.localStorage.removeItem('onboarding')
    window.localStorage.removeItem('onboarding.result')
  }
  const analyzeOk = () => mockApi({ analyze: [{ status: 200, body: fixture }], nearby: [{ status: 200, body: nearbyFixture }] })
  const RESULT_HEADING = { level: 1, name: '부평구 부평1동 · PC방 분석' }

  afterEach(() => window.localStorage.clear())

  it('첫 방문: ①위치 → (위치 선택) ②업종 → (업종 선택) ③분석 → (분석 성공) ④결과 안내 → 확인하면 끝나고 저장된다', async () => {
    firstVisit()
    analyzeOk()
    render(<App />)
    expect(coachInConditions()).toHaveTextContent('1/3')
    expect(coachInConditions()).toHaveTextContent('지도를 누르거나 주소·좌표로 위치를 고릅니다')
    // 기본 화면 글은 그대로다(중복 금지): 기존 안내 문장은 여전히 하나씩
    expect(within(conditions()).getByText('위치와 업종을 고르면, 다섯 관점으로 살펴봅니다.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    expect(coachInConditions()).toHaveTextContent('2/3')
    const select = await screen.findByRole('combobox', { name: '업종' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'R10406' } })
    expect(coachInConditions()).toHaveTextContent('3/3')
    expect(coachInConditions()).toHaveTextContent('순위·매출 예측이 아닌 참고 지표입니다')
    expect(within(coachInConditions()!).getByRole('button', { name: '확인' })).toBeInTheDocument()   // 마지막 단계

    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', RESULT_HEADING)
    expect(window.localStorage.getItem('onboarding')).toBe('done')
    const result = screen.getAllByRole('status', COACH).find((el) => el.textContent?.includes('비교'))!
    expect(result).toHaveTextContent('다른 위치와 비교해 볼 수 있습니다')
    expect(result).not.toHaveTextContent('반경')                                   // 구버전 서버: 반경 선택 없음
    fireEvent.click(within(result).getByRole('button', { name: '확인' }))
    expect(screen.queryByRole('status', COACH)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('onboarding.result')).toBe('done')
  })

  it('두 번째 방문(저장됨)에는 아무 안내도 없다', async () => {
    analyzeOk()
    render(<App />)
    expect(screen.queryByRole('status', COACH)).not.toBeInTheDocument()
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', RESULT_HEADING)
    expect(screen.queryByRole('status', COACH)).not.toBeInTheDocument()
  })

  it('건너뛰기는 결과 안내까지 안내 전체를 끝낸다 — 결과 화면에서 새 말풍선이 뜨지 않는다(팀 D7)', async () => {
    firstVisit()
    analyzeOk()
    render(<App />)
    fireEvent.click(within(coachInConditions()!).getByRole('button', { name: '건너뛰기' }))
    expect(coachInConditions()).toBeNull()
    expect(window.localStorage.getItem('onboarding')).toBe('done')
    expect(window.localStorage.getItem('onboarding.result')).toBe('done')
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    expect(coachInConditions()).toBeNull()                                          // 건너뛴 뒤에는 행동해도 다시 안 나온다
    const select = await screen.findByRole('combobox', { name: '업종' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'R10406' } })
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', RESULT_HEADING)
    expect(screen.queryByRole('status', COACH)).not.toBeInTheDocument()
  })

  it('안내를 따라 첫 분석까지 오면 같은 흐름의 마지막으로 결과 안내가 이어지고, 반경 선택이 있는 서버면 반경도 안내한다', async () => {
    firstVisit()
    mockApi({
      analyze: [{ status: 200, body: fixture }],
      nearby: [{ status: 200, body: nearbyFixture }],
      health: { status: 200, body: { ...OLD_HEALTH, engine: { version: 'mvp-0.4', radius_options: [300, 500, 1000], default_radius_m: 500 } } },
    })
    render(<App />)
    await selectBupyeongPcBang()
    expect(coachInConditions()).toHaveTextContent('3/3')
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', RESULT_HEADING)
    const result = screen.getAllByRole('status', COACH)[0]!
    expect(result).toHaveTextContent('반경(300·500m·1km)을 바꾸거나')
    fireEvent.click(within(result).getByRole('button', { name: '확인' }))
    expect(screen.queryByRole('status', COACH)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('onboarding.result')).toBe('done')
  })

  it('예전에 안내를 마친 사용자는 첫 결과에서 결과 안내를 따로 보지 않는다(D7)', async () => {
    window.localStorage.setItem('onboarding', 'done')
    window.localStorage.removeItem('onboarding.result')
    analyzeOk()
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', RESULT_HEADING)
    expect(screen.queryByRole('status', COACH)).not.toBeInTheDocument()
  })

  it('Escape는 지금 말풍선만 숨기고(저장 안 함) 다음 행동을 하면 다음 단계가 다시 보인다', async () => {
    firstVisit()
    mockApi()
    render(<App />)
    fireEvent.keyDown(coachInConditions()!, { key: 'Escape' })
    expect(coachInConditions()).toBeNull()
    expect(window.localStorage.getItem('onboarding')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
    expect(coachInConditions()).toHaveTextContent('2/3')
  })

  it('다시 보기: 조건 머리 버튼은 ①부터, 결과 머리 버튼은 ④를 다시 연다 — 포커스는 그대로(비모달)', async () => {
    analyzeOk()
    render(<App />)
    const replay = within(conditions()).getByRole('button', { name: '사용 방법 다시 보기' })
    replay.focus()
    fireEvent.click(replay)
    expect(coachInConditions()).toHaveTextContent('1/3')
    expect(document.activeElement).toBe(replay)
    fireEvent.click(within(coachInConditions()!).getByRole('button', { name: '건너뛰기' }))
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', RESULT_HEADING)
    expect(screen.queryByRole('status', COACH)).not.toBeInTheDocument()
    const resultArticle = screen.getByRole('heading', RESULT_HEADING).closest('article')!
    fireEvent.click(within(resultArticle).getByRole('button', { name: '사용 방법 다시 보기' }))
    expect(screen.getAllByRole('status', COACH)[0]).toHaveTextContent('다른 위치와 비교')
  })

  it('결과 안내가 열린 채 조건을 바꾸면 닫히고(완료 아님), 다음 결과에서 다시 보인다', async () => {
    firstVisit()
    analyzeOk()
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', RESULT_HEADING)
    expect(screen.getAllByRole('status', COACH).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '조건 바꾸기' }))
    expect(screen.queryByRole('status', COACH)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('onboarding.result')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))    // 같은 조건 → 캐시 적중으로 다시 결과(요청 없음)
    fireEvent.click(analyzeButton())
    await waitFor(() => expect(screen.getAllByRole('status', COACH).length).toBeGreaterThan(0))
  })

  describe('mobile (<640px)', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 639px)', media: q }))
    })

    it('① 위치 안내는 지도 화면 시트의 segmented 아래에도 붙고, 위치를 고르면 ②는 패널에 있다', async () => {
      firstVisit()
      mockApi()
      render(<App />)
      const inSheet = within(sheet()).getByRole('status', COACH)
      expect(inSheet).toHaveTextContent('1/3')
      // 시트 안 말풍선은 segmented(위치 입력 방법) 바로 다음이다
      expect(inSheet.previousElementSibling).toBe(within(sheet()).getByRole('group', { name: '위치 입력 방법' }))
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 부평역' }))
      expect(within(sheet()).queryByRole('status', COACH)).toBeNull()
      expect(coachInConditions()).toHaveTextContent('2/3')
    })

    // Codex 검수 지적(9-R2): 시트 ①에서 "다음"을 누르면 상태만 ②가 되고 화면은 지도에 남아 ② 안내·업종 select가 숨겨진 패널에 있었다
    it('시트 ①에서 "다음"을 누르면 조건 패널 화면으로 가서 ② 안내와 업종 선택이 보인다', () => {
      firstVisit()
      mockApi()
      render(<App />)
      const app = document.querySelector('.app')!
      const first = within(sheet()).getByRole('status', COACH)
      expect(first).toHaveTextContent('1/3')
      expect(app).toHaveAttribute('data-screen', 'map')
      fireEvent.click(within(first).getByRole('button', { name: '다음' }))
      expect(app).toHaveAttribute('data-screen', 'panel')
      expect(coachInConditions()).toHaveTextContent('2/3')
      expect(within(conditions()).getByRole('combobox', { name: '업종' })).toBeInTheDocument()
    })
  })
})

describe('업데이트 내역 (D-031) — 지도 실패에도 열리고, 열고 닫아도 분석·비교 상태는 그대로', () => {
  const ok = (body: unknown) => ({ status: 200, body })
  const updatesButton = () => screen.getByRole('button', { name: '업데이트 내역' })
  function openAndCloseUpdates() {
    updatesButton().focus()
    fireEvent.click(updatesButton())
    const dialog = screen.getByRole('dialog', { name: '업데이트 내역' })
    expect(dialog).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(updatesButton()).toHaveFocus()
  }

  afterEach(() => {
    sdkMock.crash.on = false
  })

  it('지도 SDK 인증 실패 상태에서 분석 결과를 둔 채 열고 닫는다 — 결과·선택 위치가 그대로다', async () => {
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'SDK 인증 실패' }))
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })

    openAndCloseUpdates()

    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
  })

  it('지도 영역이 예외로 내려가도(지도 오류 경계) 업데이트 내역은 열리고, 비교 결과도 그대로다', async () => {
    mockApi({ analyze: [ok(fixture), ok(guwolFixture)], nearby: [ok(nearbyFixture), ok(guwolNearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    const bCard = () => screen.getByRole('region', { name: 'B 비교 위치' })
    fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.4475' } })
    fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.7015' } })
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    await waitFor(() => expect(bCard()).toHaveTextContent('남동구 구월3동'))

    // 지도 영역 예외 → 지도 칸만 실패 안내 (테마 전환으로 지도를 다시 그리게 한다)
    sdkMock.crash.on = true
    fireEvent.click(screen.getByRole('button', { name: /모드로 전환/ }))
    expect(await screen.findByText('지도를 표시하지 못했습니다')).toBeInTheDocument()

    openAndCloseUpdates()

    expect(screen.getByRole('heading', { level: 1, name: '두 위치 비교 · PC방' })).toBeInTheDocument()
    expect(bCard()).toHaveTextContent('남동구 구월3동')
    expect(overallRowText()).toMatch(/종합.*65\.8.*59\.1/)
  })

  const overallRowText = () => within(getScoreTable()).getAllByRole('row')[1]!.textContent ?? ''
})

describe('데이터 버전 (9-C4, D-033) — 응답 헤더 X-Data-Version 과 /health data', () => {
  const AS_OF = {
    shops: '2026-06-30', panel: '2026-08-31', market_panel: '2026-08', stability_pc: '2026-05-07',
    stability_food: '2026-09-29', stations: '2024-12', schools: '2026-03', rent: '2026Q2',
  }
  const HEALTH = { ...OLD_HEALTH, data: { version: '2026-06', as_of: AS_OF } }
  const v = (version: string) => ({ 'X-Data-Version': version })
  const ok = (body: unknown, version?: string) => ({ status: 200, body, headers: version ? v(version) : undefined })

  it('결과 머리줄에 "데이터 묶음 2026-06"(12-19), 데이터 출처 표·관점 설명 기준일은 /health data.as_of 로 채운다', async () => {
    mockApi({ health: { status: 200, body: HEALTH }, analyze: [ok(fixture, '2026-06')], nearby: [ok(nearbyFixture, '2026-06')] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(document.querySelector('.result__eyebrow')).toHaveTextContent('분석 결과 · 반경 500m · 데이터 묶음 2026-06')
    openTab(EVIDENCE_TAB)
    const sources = screen.getByRole('table', { name: '사용한 데이터와 기준시점' })
    expect(sources).toHaveTextContent('2026-06-30')
    expect(sources).toHaveTextContent('2026년 2분기')                      // rent 2026Q2
    expect(sources).toHaveTextContent('2024-12 / 2026-03')                 // stations / schools
    expect(sources).not.toHaveTextContent('—')
    expect(screen.getByText(/이 결과는 데이터 묶음 2026-06으로 계산했습니다/)).toBeInTheDocument()
  })

  it('/health 에 data 가 없는 서버(구버전)면 머리줄 표시 없음, 기준일은 "—" — 정적 날짜로 채우지 않는다', async () => {
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(document.querySelector('.result__eyebrow')).not.toHaveTextContent('데이터')
    openTab(EVIDENCE_TAB)
    const sources = screen.getByRole('table', { name: '사용한 데이터와 기준시점' })
    expect(sources).toHaveTextContent('—')
    expect(sources).not.toHaveTextContent('2026-06-30')
  })

  it('A·B 의 데이터 버전이 다르면 한 비교로 보이지 않고(계약 오류) 결과 캐시를 버린다', async () => {
    const fetchMock = mockApi({
      health: { status: 200, body: HEALTH },
      analyze: [ok(fixture, '2026-06'), ok(guwolFixture, '2026-09')],
      nearby: [ok(nearbyFixture, '2026-06'), ok(guwolNearbyFixture, '2026-09')],
    })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await findList('PC방 점포 목록')
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    const bCard = () => screen.getByRole('region', { name: 'B 비교 위치' })
    fireEvent.change(within(bCard()).getByLabelText('B 위도'), { target: { value: '37.4475' } })
    fireEvent.change(within(bCard()).getByLabelText('B 경도'), { target: { value: '126.7015' } })
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치로 선택' }))
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 분석하기' }))
    expect(await screen.findByText('분석 결과를 표시할 수 없습니다')).toBeInTheDocument()
    expect(queryScoreTable()).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith('[api] A·B 엔진·데이터 버전이 다릅니다', {
      a: [fixture.result.meta.엔진버전, '2026-06'],
      b: [guwolFixture.result.meta.엔진버전, '2026-09'],
    })
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
  })
})

describe('조건 공유 링크 (12-3, 계획 1-1) — 쿼리 조건으로 같은 조건을 다시 분석, 점수는 싣지 않는다', () => {
  const ok = (body: unknown, version?: string) => ({ status: 200, body, headers: version ? { 'X-Data-Version': version } : undefined })
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)
  const HEALTH_V05 = {
    status: 200,
    body: {
      ...OLD_HEALTH,
      engine: { version: 'mvp-0.5.1', radius_options: [300, 500, 1000], default_radius_m: 500 },
      data: { version: '2026-06', as_of: {} },
    },
  }
  const notice = () => document.querySelector('.share-notice')
  const open = (query: string) => window.history.replaceState(null, '', `/${query}`)
  /** fixture 를 반경 r 로 바꾼 사본 (점수는 그대로 — 요청·응답 반경 일치만 본다) */
  function at<T>(fx: T, r: number): T {
    const c = structuredClone(fx) as { result: { meta: Record<string, unknown>; 지표: { raw: Record<string, unknown> }[] } }
    c.result.meta.분석반경_m = r
    c.result.지표[2]!.raw.반경m = r
    return c as T
  }
  const nearbyAt = <T,>(fx: T, r: number): T => ({ ...(structuredClone(fx) as object), radius_m: r }) as T

  it('링크로 열면 업종 목록·/health 뒤 그 조건으로 /analyze 를 보내고 결과를 보인다. 주소창 쿼리는 결과 조건(+데이터 묶음·엔진)으로 둔다', async () => {
    open('?lat=37.4894&lng=126.7246&biz=R10406')
    const fetchMock = mockApi({ health: HEALTH_V05, analyze: [ok(fixture, '2026-06')], nearby: [ok(nearbyFixture, '2026-06')] })
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(analyzeCalls(fetchMock)).toHaveLength(1)
    expect(bodyOf(analyzeCalls(fetchMock)[0]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 500 })
    expect(notice()).toHaveTextContent('공유 링크의 조건으로 다시 분석했습니다 — 저장된 점수가 아니라 지금 서버의 결과입니다.')
    expect(notice()).not.toHaveTextContent('지원하지 않아')
    expect(notice()).not.toHaveTextContent('결과가 그때와 다를 수 있습니다')
    // 주소창: 결과 조건 + 그 결과의 데이터 묶음·엔진(링크를 받는 쪽이 버전 차이를 안내할 수 있게)
    await waitFor(() => expect(window.location.search).toBe('?lat=37.4894&lng=126.7246&biz=R10406&r=500&data=2026-06&engine=mvp-0.3'))
    // 조건 바꾸기 → 결과·안내·쿼리 모두 없음
    fireEvent.click(screen.getByRole('button', { name: /조건.*바꾸기|바꾸기/ }))
    expect(notice()).not.toBeInTheDocument()
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('B 좌표가 있으면 A 성공 뒤 같은 업종·반경으로 B 를 분석해 비교 화면을 연다', async () => {
    open('?lat=37.4894&lng=126.7246&biz=R10406&r=500&blat=37.4475&blng=126.7015')
    const fetchMock = mockApi({
      health: HEALTH_V05,
      analyze: [ok(fixture, '2026-06'), ok(guwolFixture, '2026-06')],
      nearby: [ok(nearbyFixture, '2026-06'), ok(guwolNearbyFixture, '2026-06')],
    })
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: '두 위치 비교 · PC방' })
    expect(analyzeCalls(fetchMock).map(bodyOf)).toEqual([
      { lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 500 },
      { lat: 37.4475, lng: 126.7015, biz_code: 'R10406', radius_m: 500 },
    ])
    await waitFor(() => expect(window.location.search).toBe('?lat=37.4894&lng=126.7246&biz=R10406&r=500&blat=37.4475&blng=126.7015&data=2026-06&engine=mvp-0.3'))
  })

  it('링크의 반경을 서버가 광고하면 그 반경으로, 광고하지 않으면(구버전) 기본 반경으로 분석하며 안내한다', async () => {
    open('?lat=37.4894&lng=126.7246&biz=R10406&r=1000')
    const fetchMock = mockApi({
      health: HEALTH_V05,
      analyze: [ok(at(fixture, 1000), '2026-06')],
      nearby: [ok(nearbyAt(nearbyFixture, 1000), '2026-06')],
    })
    const { unmount } = render(<App />)
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(bodyOf(analyzeCalls(fetchMock)[0]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 1000 })
    expect(notice()).toBeInTheDocument()
    // 조건 바에서 반경을 바꾸면 링크 안내는 사라진다(그 결과까지만의 안내)
    fireEvent.click(within(screen.getByRole('group', { name: '분석 반경' })).getByRole('button', { name: '300m' }))
    expect(notice()).not.toBeInTheDocument()
    unmount()

    open('?lat=37.4894&lng=126.7246&biz=R10406&r=1000')
    const oldServer = mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })   // 구버전 /health: 반경 광고 없음
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(bodyOf(analyzeCalls(oldServer)[0]!)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
    expect(notice()).toHaveTextContent('링크의 반경 1km는 이 서버가 지원하지 않아 500m로 분석합니다.')
  })

  it('링크의 데이터 묶음·엔진이 지금 서버와 다르면 결과가 다를 수 있다고 안내한다', async () => {
    open('?lat=37.4894&lng=126.7246&biz=R10406&data=2026-05&engine=mvp-0.5')
    mockApi({ health: HEALTH_V05, analyze: [ok(fixture, '2026-06')], nearby: [ok(nearbyFixture, '2026-06')] })
    render(<App />)
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(notice()).toHaveTextContent(
      '링크를 만들 때는 데이터 묶음 2026-05 · 엔진 mvp-0.5였고 지금은 데이터 묶음 2026-06 · 엔진 mvp-0.5.1입니다. 결과가 그때와 다를 수 있습니다.',
    )
  })

  it('링크의 업종이 이 서버 목록에 없으면 위치만 가져오고 분석하지 않는다', async () => {
    open('?lat=37.4894&lng=126.7246&biz=Z99999')
    const fetchMock = mockApi({ health: HEALTH_V05 })
    render(<App />)
    await waitFor(() => expect(notice()).toHaveTextContent('공유 링크의 업종을 이 서버에서 찾을 수 없어 위치만 가져왔습니다'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
    expect(analyzeCalls(fetchMock)).toHaveLength(0)
    expect(analyzeButton()).toBeDisabled()                 // 업종을 고르기 전
  })

  it('잘못된 링크(좌표 범위 밖)는 무시한다 — 보통 첫 화면', async () => {
    open('?lat=95&lng=126.7246&biz=R10406')
    const fetchMock = mockApi({ health: HEALTH_V05 })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '업종' })).toBeEnabled())
    expect(analyzeCalls(fetchMock)).toHaveLength(0)
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '')
    expect(notice()).not.toBeInTheDocument()
  })

  it('보통 흐름으로 분석해도 주소창 쿼리가 결과 조건이 되고, "링크 복사"는 그 주소를 클립보드에 넣는다 (막히면 입력란으로)', async () => {
    mockApi({ health: HEALTH_V05, analyze: [ok(fixture, '2026-06')], nearby: [ok(nearbyFixture, '2026-06')] })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    const expected = `${window.location.origin}/?lat=37.4894&lng=126.7246&biz=R10406&r=500&data=2026-06&engine=mvp-0.3`
    await waitFor(() => expect(window.location.href).toBe(expected))
    expect(notice()).not.toBeInTheDocument()               // 링크로 연 것이 아니면 안내 없음

    fireEvent.click(screen.getByRole('button', { name: '링크 복사' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('링크를 복사했습니다'))
    expect(writeText).toHaveBeenCalledWith(expected)

    writeText.mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(screen.getByRole('button', { name: '링크 복사' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('직접 복사하세요'))
    expect(screen.getByRole('textbox', { name: '공유 링크' })).toHaveValue(expected)
  })
})

describe('반경별 비교 표 (12-26, 계획 1-5) — 캐시된 반경만 채우고, 빈 반경의 "분석하기"는 반경 변경과 같은 경로', () => {
  const ok = (body: unknown) => ({ status: 200, body })
  const V04 = { status: 200, body: { ...OLD_HEALTH, engine: { version: 'mvp-0.4', radius_options: [300, 500, 1000], default_radius_m: 500 } } }
  function at<T>(fx: T, r: number, overall: number): T {
    const c = structuredClone(fx) as { result: { meta: Record<string, unknown>; 종합: Record<string, unknown>; 지표: { raw: Record<string, unknown> }[] } }
    c.result.meta.분석반경_m = r
    c.result.meta.엔진버전 = 'mvp-0.4'
    c.result.종합.점수 = overall
    c.result.지표[2]!.raw.반경m = r
    return c as T
  }
  const nearbyAt = <T,>(fx: T, r: number): T => ({ ...(structuredClone(fx) as object), radius_m: r }) as T
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)
  // R1: 반경별 표는 "반경별 비교" 탭 안(13-10) — 사용자처럼 탭을 먼저 연다
  const table = () => getInTab(/^반경별 비교/, 'table', { name: /반경별 종합/ })
  const rows = () => within(table()).getAllByRole('row').slice(1)

  it('500m 결과: 500 행만 채워지고 300·1km 는 "분석하기". 1km 분석하기 → 1km 로 전환·요청, 두 행이 채워지고 범위 문구. 500 으로 돌아가도(캐시) 1km 행이 남는다', async () => {
    const fetchMock = mockApi({
      health: V04,
      analyze: [ok(at(fixture, 500, 62.3)), ok(at(fixture, 1000, 64.8))],
      nearby: [ok(nearbyAt(nearbyFixture, 500)), ok(nearbyAt(nearbyFixture, 1000))],
    })
    render(<App />)
    await selectBupyeongPcBang()
    await waitFor(() => expect(screen.getByRole('group', { name: '분석 반경' })).toBeInTheDocument())
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('300m 분석하기'),
      expect.stringMatching(/^500m · 지금62\.3/),
      expect.stringContaining('1km 분석하기'),
    ])
    expect(screen.queryByText(/종합 점수 범위/)).not.toBeInTheDocument()

    fireEvent.click(within(table()).getByRole('button', { name: '1km 분석하기' }))
    expect(bodyOf(analyzeCalls(fetchMock)[1]!)).toMatchObject({ radius_m: 1000 })
    await waitFor(() => expect(document.querySelector('.result__eyebrow')).toHaveTextContent('반경 1km'))
    expect(rows()[1]).toHaveTextContent(/^500m62\.3/)
    expect(rows()[2]).toHaveTextContent(/^1km · 지금64\.8/)
    expect(rows()[2]).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText(/분석한 반경 2개의 종합 점수 범위 62\.3~64\.8/)).toBeInTheDocument()

    // 조건 바의 500m 로 돌아가면 캐시 적중(요청 없음) — 표에는 1km 행이 그대로 남는다
    fireEvent.click(within(screen.getByRole('group', { name: '분석 반경' })).getByRole('button', { name: '500m' }))
    await waitFor(() => expect(document.querySelector('.result__eyebrow')).toHaveTextContent('반경 500m'))
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
    expect(rows()[1]).toHaveTextContent(/^500m · 지금62\.3/)
    expect(rows()[2]).toHaveTextContent(/^1km64\.8/)
  })

  it('반경을 광고하지 않는 서버(구버전)에서는 표가 없다', async () => {
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(screen.queryByRole('table', { name: /반경별 종합/ })).not.toBeInTheDocument()
  })
})

describe('현장 확인 카드 탭 (12-27, 계획 1-4) — 체크·메모는 조건 키별로 이 브라우저에 저장', () => {
  const ok = (body: unknown) => ({ status: 200, body })
  const FIELD_TAB = /^현장 확인/
  beforeEach(() => window.localStorage.removeItem('fieldNotes.v1'))

  it('결과의 "현장 확인" 탭에 카드 3장, 확인함을 켜고 메모를 쓰면 저장되고 다시 열어도(새 마운트·같은 조건) 남아 있다', async () => {
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    const first = render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    openTab(FIELD_TAB)
    expect(screen.getByRole('tab', { name: /현장 확인/ })).toHaveTextContent('3')
    expect(document.querySelectorAll('.field-check')).toHaveLength(3)
    fireEvent.click(screen.getAllByRole('checkbox', { name: '확인함' })[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: '후보 점포의 임대 조건 확인 메모' }), { target: { value: '월세 150' } })
    expect(JSON.parse(window.localStorage.getItem('fieldNotes.v1')!)['37.4894,126.7246,R10406,500'].notes).toEqual({
      competitors: { done: true, memo: '' },
      rent: { done: false, memo: '월세 150' },
    })
    first.unmount()
    window.history.replaceState(null, '', '/')               // 결과 조건 쿼리(12-3)로 자동 분석되지 않게 — 보통 흐름으로 다시 연다

    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    openTab(FIELD_TAB)
    expect(screen.getAllByRole('checkbox', { name: '확인함' })[0]).toBeChecked()
    expect(screen.getByRole('textbox', { name: '후보 점포의 임대 조건 확인 메모' })).toHaveValue('월세 150')
  })
})

describe('후보 보관함 (12-25, 계획 1-2) — 로컬 저장, 저장 당시 결과와 다시 분석을 구분', () => {
  const ok = (body: unknown, version?: string) => ({ status: 200, body, headers: version ? { 'X-Data-Version': version } : undefined })
  beforeEach(() => {
    window.localStorage.removeItem('savedSites.v1')
    window.localStorage.removeItem('fieldNotes.v1')
  })

  it('"보관" → 저장 안내·버튼 개수, 보관함의 "같은 조건으로 다시 분석"은 조건을 되살려 캐시를 우회해 서버에 다시 요청하고(12-28-R2) 스냅샷이 아니라고 안내한다', async () => {
    const fresh = structuredClone(fixture) as typeof fixture
    fresh.result.종합.점수 = 63.1                                   // 서버가 그사이 바뀐 상황
    const fetchMock = mockApi({
      analyze: [ok(fixture, '2026-06'), ok(fresh, '2026-06')],
      nearby: [ok(nearbyFixture, '2026-06'), ok(nearbyFixture, '2026-06')],
    })
    render(<App />)
    expect(screen.getByRole('button', { name: '보관함 0곳' })).toBeInTheDocument()
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })

    fireEvent.click(screen.getByRole('button', { name: '보관' }))
    expect(screen.getByText(/보관함에 저장했습니다\(1\/3\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '보관함 1곳' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '보관됨 · 갱신' })).toHaveAttribute('aria-pressed', 'true')
    const stored = JSON.parse(window.localStorage.getItem('savedSites.v1')!)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      key: '37.4894,126.7246,R10406,500',
      conditions: { lat: 37.4894, lng: 126.7246, biz: 'R10406', bizName: 'PC방', radius: null },
      snapshot: { locationName: '부평구 부평1동', overall: fixture.result.종합.점수, stores: 12 },
      versions: { data: '2026-06', engine: 'mvp-0.3' },
    })

    // 조건을 바꾼 뒤 보관함에서 다시 분석 → 같은 조건으로 /analyze 를 다시 보내고(캐시 우회) 새 응답을 보인다
    fireEvent.click(screen.getByRole('button', { name: /바꾸기/ }))
    fireEvent.click(screen.getByRole('button', { name: '보관함 1곳' }))
    const dialog = screen.getByRole('dialog', { name: '후보 보관함' })
    expect(dialog).toHaveTextContent('저장 당시 결과')
    fireEvent.click(within(dialog).getByRole('button', { name: '같은 조건으로 다시 분석' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
    expect(JSON.parse((analyzeCalls(fetchMock)[1]![1] as RequestInit).body as string)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
    await waitFor(() => expect(screen.getByRole('region', { name: '종합 적합도' })).toHaveTextContent('63.1'))
    expect(document.querySelector('.share-notice')).toHaveTextContent('보관함의 조건으로 다시 분석했습니다 — 저장 당시 결과가 아니라 지금 서버의 결과입니다.')
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')

    // 삭제 → 0곳, "보관" 버튼으로 돌아온다
    fireEvent.click(screen.getByRole('button', { name: '보관함 1곳' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }))
    expect(screen.getByRole('button', { name: '보관함 0곳' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: '보관' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('3곳이 차 있으면 새 조건은 저장하지 않고 안내한다', async () => {
    const full = [1, 2, 3].map((i) => ({
      id: `s${i}`, key: `k${i}`, savedAt: '2026-10-29T00:00:00.000Z',
      conditions: { lat: 37 + i, lng: 126, biz: 'R10406', bizName: 'PC방', radius: null },
      snapshot: { locationName: `동 ${i}`, overall: 50, perspectives: [], stores: 0, gaps: [] },
      versions: { data: null, engine: 'mvp-0.3' }, memo: '',
    }))
    window.localStorage.setItem('savedSites.v1', JSON.stringify(full))
    mockApi({ analyze: [ok(fixture)], nearby: [ok(nearbyFixture)] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    fireEvent.click(screen.getByRole('button', { name: '보관' }))
    expect(screen.getByText(/보관함이 가득 찼습니다\(3곳\)/)).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('savedSites.v1')!)).toHaveLength(3)
    expect(screen.getByRole('button', { name: '보관함 3곳' })).toBeInTheDocument()
  })
})

describe('인쇄 (12-15, 계획 1-3)', () => {
  it('결과·비교 요약의 "인쇄"는 브라우저 인쇄를 부르고 상태는 그대로다. 인쇄 머리말은 결과가 있을 때만(화면에서는 숨김)', async () => {
    mockApi({ analyze: [{ status: 200, body: fixture }], nearby: [{ status: 200, body: nearbyFixture }] })
    const print = vi.fn()
    vi.stubGlobal('print', print)
    render(<App />)
    expect(document.querySelector('.print-only')).not.toBeInTheDocument()
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(document.querySelector('.print-only')).toHaveTextContent(/우리동네 상권분석 매니저 · 참고 지표\(순위·매출 예측 아님\) · 앱 v\d+\.\d+\.\d+ · 인쇄 /)
    fireEvent.click(screen.getByRole('button', { name: '인쇄' }))
    expect(print).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
  })
})

describe('대시보드 지도 카드 (13-10) — 키보드로 확대·복귀해도 포커스가 사라지지 않는다 (Codex R1-8)', () => {
  it('"지도 크게 보기" → "결과로 돌아가기"로, 돌아오면 다시 "지도 크게 보기"로 포커스가 옮겨진다', async () => {
    mockApi({ analyze: [{ status: 200, body: fixture }], nearby: [{ status: 200, body: nearbyFixture }] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    const expand = screen.getByRole('button', { name: '지도 크게 보기' })
    expand.focus()
    fireEvent.click(expand)
    const collapse = screen.getByRole('button', { name: '‹ 결과로 돌아가기' })
    expect(document.activeElement).toBe(collapse)
    expect(screen.queryByRole('button', { name: '지도 크게 보기' })).toBeNull()
    fireEvent.click(collapse)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '지도 크게 보기' }))
    expect(document.activeElement).not.toBe(document.body)
  })
})

describe('결과 옆 보조 요청 — /insights 는 /analyze 와 따로 (Codex R1-3)', () => {
  it('결과가 나오면 같은 좌표·업종으로 /insights 를 한 번 요청하고, 404(이전 서버)면 시간대 카드만 빠진다', async () => {
    const fetchMock = mockApi({ analyze: [{ status: 200, body: fixture }], nearby: [{ status: 200, body: nearbyFixture }] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/insights')).toHaveLength(1))
    const call = fetchMock.mock.calls.find(([url]) => url === '/insights') as unknown[]
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
    expect(screen.queryByRole('heading', { name: '시간대와 사람' })).toBeNull()
    expect(screen.getByRole('region', { name: '5대 관점' })).toBeInTheDocument()
  })
})

describe('AI 요약·질문 (R2 13-23·13-24) — 서버가 /health ai 로 광고할 때만', () => {
  const AI_HEALTH = { ...OLD_HEALTH, ai: { enabled: true, model: 'claude-sonnet-5-5', budget: 'ok' } }
  const SUMMARY = {
    engine_version: fixture.result.meta.엔진버전, prompt_version: 'r2-1', model: 'claude-sonnet-5-5', cached: false,
    good: [{ text: '주요 손님층이 많이 사는 편이에요.', fields: ['지표.customer.score'] }],
    bad: [{ text: '같은 업종이 많아요.', fields: [] }],
    check: [{ text: '저녁 유동을 확인하세요.', fields: [] }],
  }

  it('광고하지 않는 서버(키 없음)면 /summary 를 부르지 않고 AI 카드도 없다 — 한 줄 결론이 요약', async () => {
    const fetchMock = mockApi({ analyze: [{ status: 200, body: fixture }], nearby: [{ status: 200, body: nearbyFixture }] })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock.mock.calls.filter(([url]) => url === '/summary')).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'AI 요약' })).toBeNull()
  })

  it('광고하면 결과 뒤 /summary 1회 → AI 요약 카드, "AI에게 질문"으로 질문 창, 닫으면 버튼으로 포커스', async () => {
    const fetchMock = mockApi({
      health: { status: 200, body: AI_HEALTH },
      analyze: [{ status: 200, body: fixture }],
      nearby: [{ status: 200, body: nearbyFixture }],
      summary: [{ status: 200, body: SUMMARY }],
    })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(await screen.findByText('주요 손님층이 많이 사는 편이에요.', { exact: false })).toBeInTheDocument()
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/summary')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(((calls[0] as unknown[])[1] as RequestInit).body as string)).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406' })
    const ask = screen.getByRole('button', { name: 'AI에게 질문' })
    fireEvent.click(ask)
    const dialog = screen.getByRole('dialog', { name: '이 분석에 대해 질문하기' })
    expect(dialog).toHaveTextContent('부평구 부평1동 · PC방')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '이 분석에 대해 질문하기' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'AI에게 질문' })))
  })
})

describe('장소 이름으로 찾기 (12-14, 계획 1-6, D-036) — 서버가 /health 로 광고할 때만', () => {
  const HEALTH_PLACES = { status: 200, body: { ...OLD_HEALTH, places: { enabled: true } } }
  const PLACES = {
    status: 200,
    body: { count: 1, places: [{ name: '부평역 1호선', category: '교통', road_address: '인천광역시 부평구 부평대로 1', jibun_address: null, lat: 37.4894, lng: 126.7246 }] },
  }
  const method = (name: string) => within(screen.getAllByRole('group', { name: '위치 입력 방법' })[0]!).queryByRole('button', { name })

  it('광고 없는 서버(구버전·enabled false)에는 "장소 이름" 입력 방법이 없고 주소 안내는 기존 문구', async () => {
    mockApi()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '업종' })).toBeEnabled())
    expect(method('장소 이름')).toBeNull()
    expect(screen.getAllByRole('group', { name: '위치 입력 방법' })).toHaveLength(2)   // 조건 패널 + mobile 시트, 둘 다 없음
  })

  it('광고하면 "장소 이름"이 있고, 검색 결과를 고르면 그 좌표가 위치가 된다(분석 없음, /places 1회). 주소 안내는 장소 이름을 가리킨다', async () => {
    const fetchMock = mockApi({ health: HEALTH_PLACES, places: [PLACES] })
    render(<App />)
    await waitFor(() => expect(method('장소 이름')).toBeInTheDocument())
    fireEvent.click(method('장소 이름')!)
    fireEvent.change(screen.getByRole('textbox', { name: '장소 이름' }), { target: { value: '부평역' } })
    fireEvent.submit(screen.getByRole('search', { name: '장소 이름 검색' }))
    const list = await screen.findByRole('list', { name: /검색 결과 1건/ })
    fireEvent.click(within(list).getByRole('button'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')
    expect(analyzeCalls(fetchMock)).toHaveLength(0)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/places')).toHaveLength(1)
    expect(screen.queryByRole('list', { name: /검색 결과/ })).not.toBeInTheDocument()
    // 선택 뒤 포커스는 위치 요약(주소 검색과 같은 규칙)
    expect(document.activeElement).toHaveClass('location__selected')
  })

  it('비교 B 카드에도 "B 장소 이름으로 찾기"가 있고, 결과를 고르면 B 좌표만 바뀐다', async () => {
    const fetchMock = mockApi({
      health: HEALTH_PLACES,
      analyze: [{ status: 200, body: fixture }],
      nearby: [{ status: 200, body: nearbyFixture }],
      places: [{ ...PLACES, body: { count: 1, places: [{ ...PLACES.body.places[0]!, lat: 37.4475, lng: 126.7015 }] } }],
    })
    render(<App />)
    await selectBupyeongPcBang()
    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    fireEvent.click(screen.getAllByRole('button', { name: '다른 위치와 비교' })[0]!)
    const bCard = screen.getByRole('region', { name: 'B 비교 위치' })
    fireEvent.click(within(bCard).getByRole('button', { name: 'B 장소 이름으로 찾기' }))
    fireEvent.change(within(bCard).getByRole('textbox', { name: 'B 장소 이름' }), { target: { value: '구월' } })
    fireEvent.submit(within(bCard).getByRole('search', { name: 'B 장소 이름 검색' }))
    const list = await within(bCard).findByRole('list', { name: /검색 결과 1건/ })
    fireEvent.click(within(list).getByRole('button'))
    expect(bCard).toHaveTextContent('선택됨 · 37.4475, 126.7015')
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', '37.4894,126.7246')   // A 그대로
    expect(analyzeCalls(fetchMock)).toHaveLength(1)
    expect(document.activeElement).toBe(within(bCard).getByRole('button', { name: 'B 분석하기' }))
  })
})
