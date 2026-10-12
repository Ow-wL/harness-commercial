import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Mock } from 'vitest'
import App from './App.tsx'
import type { MapViewProps } from './components/MapView.tsx'
import fixture from './fixtures/bupyeong-pcbang.json'
import nearbyFixture from './fixtures/bupyeong-pcbang-nearby.json'
import guwolFixture from './fixtures/compare-guwol-pcbang.json'
import guwolNearbyFixture from './fixtures/compare-guwol-pcbang-nearby.json'
import songdoFixture from './fixtures/compare-songdo-pcbang.json'
import songdoNearbyFixture from './fixtures/compare-songdo-pcbang-nearby.json'
import { brokenControls, brokenReferences, duplicateIds, expandAll } from './test/a11yRefs.ts'

// 지도는 SDK 경계(MapView) 통째로 mock한다 — 실제 NAVER SDK를 부르지 않는다.
// mock은 실제 MapView와 같은 계약: interactive=false면 클릭을 무시하고, 클릭 좌표를 onSelect로 넘긴다.
// 7-B2: 참고 주소 — MapView mock이 SDK 상태를 App에 올리고(onSdkState), 역지오코딩 콜백은 테스트가 보낸다
const sdkMock = vi.hoisted(() => {
  const reverseCalls: { options: Record<string, unknown>; callback: (status: number, response?: unknown) => void }[] = []
  const api = {
    Service: {
      Status: { OK: 200, ERROR: 500 },
      geocode: () => {},
      reverseGeocode: (options: Record<string, unknown>, callback: (status: number, response?: unknown) => void) => {
        reverseCalls.push({ options, callback })
      },
    },
  }
  return { reverseCalls, api }
})

vi.mock('./components/MapView.tsx', () => ({
  MapView: (props: MapViewProps) => (
    <div
      data-testid="map"
      data-selected={props.selected ? `${props.selected.lat},${props.selected.lng}` : ''}
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
  ),
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

type Reply = { status: number; body: unknown } | 'network-error' | Promise<{ status: number; body: unknown }>

const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' },
  })

/** fetch mock: /businesses는 CATALOG, /analyze·/nearby-stores는 각자 차례대로 replies (분석 뒤 /nearby-stores가 없으면 네트워크 실패로 끝난다) */
function mockApi({
  businesses = { status: 200, body: CATALOG } as Reply,
  analyze = [] as Reply[],
  nearby = [] as Reply[],
} = {}) {
  const queue = [...analyze]
  const nearbyQueue = [...nearby]
  const fetchMock = vi.fn(async (url: string) => {
    const reply = url === '/businesses' ? businesses : url === '/nearby-stores' ? nearbyQueue.shift() : queue.shift()
    if (reply === undefined) throw new Error(`예상하지 못한 요청: ${url}`)
    if (reply === 'network-error') throw new TypeError('Failed to fetch')
    const { status, body } = await reply
    return json(status, body)
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
    fireEvent.click(within(conditions).getByRole('button', { name: '좌표 직접 입력' }))   // 펼침 토글(mobile sheet에도 같은 이름 버튼이 있다)
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
    expect(screen.getByText('위치와 업종을 고르면 이곳에 분석 결과가 나옵니다')).toBeInTheDocument()
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
    const sheet = () => container.querySelector('.map-sheet__text')!
    // 분석 전: 행정동은 아직 모른다 → 고른 좌표만
    expect(sheet()).toHaveTextContent('선택됨 · 37.4894, 126.7246')

    fireEvent.click(analyzeButton())
    await screen.findByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })
    expect(within(screen.getByRole('group', { name: '분석 조건' })).getByText('부평역 · 직선거리 85m')).toBeInTheDocument()
    expect(sheet()).toHaveTextContent('부평구 부평1동 · 부평역 직선거리 85m')
    expect(sheet()).not.toHaveTextContent('37.4894')
    // 결과 패널: 최근접역 + 접힌 좌표
    const summary = container.querySelector('.conditions-summary')!
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

    fireEvent.click(screen.getByRole('button', { name: '조건 변경' }))
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

    const section = await screen.findByRole('region', { name: NEARBY })
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
    const list = await screen.findByRole('list', { name: 'PC방 점포 목록' })
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
    const list = await screen.findByRole('list', { name: 'PC방 점포 목록' })
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
    const toggle = await screen.findByRole('checkbox', { name: '지도에 표시' })
    expect(toggle).toBeChecked()
    fireEvent.click(within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')[0]!)
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

    fireEvent.click(within(screen.getByRole('region', { name: NEARBY })).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('list', { name: 'PC방 점포 목록' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
  })

  it('새 위치를 고르면 목록·마커를 지우고, 늦게 도착한 이전 조회 응답은 버린다', async () => {
    let respond!: (r: { status: number; body: unknown }) => void
    const late = new Promise<{ status: number; body: unknown }>((r) => (respond = r))
    await analyzeBupyeong([late])
    expect(await screen.findByText('점포 목록을 불러오는 중…')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
    await act(async () => respond({ status: 200, body: nearbyFixture }))

    expect(screen.queryByRole('region', { name: NEARBY })).not.toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')
  })

  it('조건 변경으로 결과를 지우면 목록·마커도 지운다', async () => {
    await analyzeBupyeong([{ status: 200, body: nearbyFixture }])
    await screen.findByRole('list', { name: 'PC방 점포 목록' })
    fireEvent.click(screen.getByRole('button', { name: '조건 변경' }))
    expect(screen.queryByRole('region', { name: NEARBY })).not.toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')
  })

  it('응답 조건이 요청과 다르면(다른 업종) 쓰지 않고 오류로 보여 준다', async () => {
    await analyzeBupyeong([{ status: 200, body: { ...nearbyFixture, biz_code: 'R10407' } }])
    expect(await screen.findByText(/점포 목록을 불러오지 못했습니다/)).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '')
  })

  it('목록 수가 분석의 동종 점포 수와 다르면 경고한다', async () => {
    await analyzeBupyeong([{ status: 200, body: { ...nearbyFixture, count: 0, stores: [] } }])
    const section = await screen.findByRole('region', { name: NEARBY })
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
  const overallRow = () => within(within(panel()).getByRole('table', { name: /종합·5대 관점 점수 비교/ })).getAllByRole('row')[1]!
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
    await screen.findByRole('list', { name: 'PC방 점포 목록' })
    return fetchMock
  }

  const startCompare = () => fireEvent.click(screen.getByRole('button', { name: '다른 위치와 비교' }))

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
    expect(aCard()).toHaveTextContent('부평구 부평1동 · 종합 65.8')
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
    expect(within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')).toHaveLength(5)
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '다른 위치와 비교' }))
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
    expect(aCard()).toHaveTextContent('부평구 부평1동 · 종합 65.8')
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
    fireEvent.click(within(panel()).getByRole('button', { name: '비교 취소' }))
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

    fireEvent.click(within(panel()).getByRole('button', { name: '조건 변경' }))
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
    fireEvent.click(within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')[0]!)
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', nearbyFixture.stores[0]!.id)

    startCompare()
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', '')
    fireEvent.click(within(panel()).getByRole('button', { name: '비교 취소' }))
    expect(screen.getByTestId('map')).toHaveAttribute('data-active-store', '')
    expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
  })

  describe('비교 요약 ↔ 위치별 전체 결과 (5차-B3, §3.3)', () => {
    const header = () => screen.getByRole('group', { name: '분석 조건' })

    async function compareWithGuwol() {
      const fetchMock = await analyzeA([ok(guwolFixture)], [ok(guwolNearbyFixture)])
      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })
      return fetchMock
    }

    it('전체 결과로 갔다 돌아와도 다시 요청하지 않고, 제목으로 포커스·복귀 시 누른 버튼으로 돌려준다', async () => {
      const fetchMock = await compareWithGuwol()
      // 비교 요약: 헤더는 A·B, 점포는 기본 기준 B(5차-B5), 데이터 출처는 한 번
      expect(header()).toHaveTextContent('A 부평구 부평1동')
      expect(header()).toHaveTextContent('B 남동구 구월3동')
      expect(await screen.findByRole('list', { name: 'B 남동구 구월3동 PC방 점포 목록' })).toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '6')
      expect(document.querySelectorAll('#data-sources')).toHaveLength(1)
      expect(screen.getByRole('link', { name: '데이터 출처' })).toHaveAttribute('href', '#data-sources')

      // B 전체 결과
      fireEvent.click(screen.getByRole('button', { name: 'B 전체 결과 보기' }))
      const bTitle = screen.getByRole('heading', { level: 1, name: 'B · 남동구 구월3동 · PC방 분석' })
      expect(document.activeElement).toBe(bTitle)
      expect(screen.queryByRole('region', { name: PANEL })).not.toBeInTheDocument()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)        // AnalysisResult 하나만
      expect(within(screen.getByRole('region', { name: '종합 적합도' })).getByText('59.1')).toBeInTheDocument()
      expect(header()).toHaveTextContent('남동구 구월3동')
      expect(header()).not.toHaveTextContent('부평1동')
      // B 전체 결과에는 B 점포만 (A 점포를 보이지 않는다)
      expect(screen.getByRole('list', { name: 'B 남동구 구월3동 PC방 점포 목록' })).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: /부평1동 PC방 점포 목록/ })).not.toBeInTheDocument()
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '6')
      expect(document.querySelectorAll('#data-sources')).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'B 전체 결과 보기' }))

      // A 전체 결과
      fireEvent.click(screen.getByRole('button', { name: 'A 전체 결과 보기' }))
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'A · 부평구 부평1동 · PC방 분석' }))
      expect(within(screen.getByRole('region', { name: '종합 적합도' })).getByText('65.8')).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'A 부평구 부평1동 PC방 점포 목록' })).toBeInTheDocument()   // A 전체 → A 점포
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '12')
      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'A 전체 결과 보기' }))
      expect(overallRow()).toHaveTextContent(/65\.8.*59\.1/)

      expect(analyzeCalls(fetchMock)).toHaveLength(2)                             // A 1번 + B 1번
      expect(nearbyCalls(fetchMock)).toHaveLength(2)                              // 점포도 A 1번 + B 1번 — 화면을 오가도 다시 조회하지 않는다
      expect(screen.getByTestId('map')).toHaveAttribute('data-stores', '6')        // 요약으로 돌아오면 기준 B 그대로

      // 비교 종료 → A 단일 결과·A 점포 목록·마커 복원
      fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))
      expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'PC방 점포 목록' })).toBeInTheDocument()
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
      fireEvent.click(screen.getByRole('button', { name: 'A 전체 결과 보기' }))
      check('A 전체 결과')
      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      fireEvent.click(screen.getByRole('button', { name: 'B 전체 결과 보기' }))
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
      await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })     // 전체 결과가 아니라 요약부터
      expect(overallRow()).toHaveTextContent(/65\.8.*64\.9/)
      expect(screen.queryByRole('button', { name: '비교로 돌아가기' })).not.toBeInTheDocument()
    })

    it('요약의 "B 위치 다시 고르기"는 B 고르기로 돌아가고 A는 그대로다', async () => {
      await compareWithGuwol()
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치 다시 고르기' }))
      expect(within(bCard()).getByLabelText('B 위도')).toBeInTheDocument()
      expect(aCard()).toHaveTextContent('부평구 부평1동 · 종합 65.8')
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

      fireEvent.click(screen.getByRole('button', { name: 'B 전체 결과 보기' }))
      expect(shown()).toEqual(summary)
      fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
      fireEvent.click(screen.getByRole('button', { name: 'A 전체 결과 보기' }))
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
      await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })
      expect(map()).toHaveAttribute('data-compare-dong', '28185 송도2동')

      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치 다시 고르기' }))
      expect(map()).toHaveAttribute('data-compare-location', '')
      expect(map()).toHaveAttribute('data-compare-dong', '')

      fireEvent.click(within(panel()).getByRole('button', { name: '비교 취소' }))
      expect(map()).not.toHaveAttribute('data-compare')
    })

    it('B 성공 뒤 패널 포커스(비교 제목)는 지도 갱신으로 바뀌지 않는다', async () => {
      await analyzeA([ok(guwolFixture)])
      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })
      expect(map()).toHaveAttribute('data-compare-dong', '28200 구월3동')
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: PANEL }))
    })
  })

  describe('비교 중 동종 점포 조회·기준 전환 (5차-B5, §3.3·4.3)', () => {
    const map = () => screen.getByTestId('map')
    const B_LIST = 'B 남동구 구월3동 PC방 점포 목록'
    const A_LIST = 'A 부평구 부평1동 PC방 점포 목록'
    const sideButton = (name: RegExp) => within(screen.getByRole('group', { name: '점포 기준 위치' })).getByRole('button', { name })
    const items = (list: string) => within(screen.getByRole('list', { name: list })).getAllByRole('button')

    /** A 분석 → 비교 → B(구월3동) 분석 성공까지. bNearby는 B 점포 조회 응답들 */
    async function compareGuwol(bNearby: Reply[] = [ok(guwolNearbyFixture)], more: Reply[] = []) {
      const fetchMock = await analyzeA([ok(guwolFixture), ...more], bNearby)
      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })
      return fetchMock
    }

    it('B 성공 뒤 같은 좌표·업종으로 B 점포를 조회하고, 기본 기준은 B다 (제목·개수·막대에 A/B와 위치)', async () => {
      const fetchMock = await compareGuwol()
      expect(bodyOf(nearbyCalls(fetchMock)[1]!)).toEqual({ lat: 37.4475, lng: 126.7015, biz_code: 'R10406' })
      expect(await screen.findByRole('list', { name: B_LIST })).toBeInTheDocument()
      const region = screen.getByRole('region', { name: /반경 500m 안 같은 업종 점포/ })
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
      await screen.findByRole('list', { name: B_LIST })
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
      expect(screen.queryByRole('list', { name: B_LIST })).not.toBeInTheDocument()
      expect(sideButton(/^A 부평1동$/)).toHaveAttribute('aria-pressed', 'true')
      expect(document.activeElement).toBe(sideButton(/^A 부평1동$/))         // 목록이 새로 그려져도 누른 버튼에

      fireEvent.click(sideButton(/^B 구월3동$/))
      expect(items(B_LIST)).toHaveLength(5)                                  // 다시 접힌 상태로 시작
      expect(map()).toHaveAttribute('data-stores', '6')
      expect(nearbyCalls(fetchMock)).toHaveLength(2)                         // 전환해도 다시 조회하지 않는다
    })

    it('전체 결과는 그 위치의 점포, 요약으로 돌아오면 열기 전 기준을 되살린다', async () => {
      await compareGuwol()
      await screen.findByRole('list', { name: B_LIST })
      fireEvent.click(sideButton(/^A 부평1동$/))                               // 요약 기준 A
      fireEvent.click(items(A_LIST)[0]!)
      expect(map()).not.toHaveAttribute('data-active-store', '')

      fireEvent.click(screen.getByRole('button', { name: 'B 전체 결과 보기' }))
      expect(screen.getByRole('list', { name: B_LIST })).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: A_LIST })).not.toBeInTheDocument()
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
      const region = await screen.findByRole('region', { name: /반경 500m 안 같은 업종 점포/ })
      expect(await within(region).findByText(/점포 목록을 불러오지 못했습니다. 분석 결과는 그대로입니다./)).toBeInTheDocument()
      expect(overallRow()).toHaveTextContent(/65\.8.*59\.1/)
      expect(map()).toHaveAttribute('data-stores', '')

      fireEvent.click(within(region).getByRole('button', { name: '다시 시도' }))
      expect(await screen.findByRole('list', { name: B_LIST })).toBeInTheDocument()
      expect(analyzeCalls(fetchMock)).toHaveLength(2)                         // 분석은 다시 요청하지 않는다
      const [, b1, b2] = nearbyCalls(fetchMock).map(bodyOf)
      expect(b2).toEqual(b1)
    })

    it('B 목록 수가 B의 동종점포수와 다르면 경고한다 (A가 아니라 지금 기준 위치와 대조)', async () => {
      await compareGuwol([ok({ ...guwolNearbyFixture, count: 12, stores: nearbyFixture.stores })])
      const region = await screen.findByRole('region', { name: /반경 500m 안 같은 업종 점포/ })
      await waitFor(() => expect(region).toHaveTextContent('목록 수(12곳)가 분석의 동종 점포 수(6곳)와 다릅니다'))
      fireEvent.click(sideButton(/^A 부평1동$/))
      expect(screen.getByRole('region', { name: /반경 500m 안 같은 업종 점포/ })).not.toHaveTextContent('목록 수(')
    })

    it('B 고르기·분석 중·분석 실패에는 점포 목록·마커가 없다', async () => {
      const b = pending()
      await analyzeA([b.promise])
      startCompare()
      expect(map()).toHaveAttribute('data-stores', '')
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()
      expect(screen.queryByRole('region', { name: /반경 500m 안 같은 업종 점포/ })).not.toBeInTheDocument()
      expect(map()).toHaveAttribute('data-stores', '')
      await act(async () => b.respond({ status: 422, body: { error: { code: 'location_outside', message: 'x' } } }))
      expect(screen.queryByRole('region', { name: /반경 500m 안 같은 업종 점포/ })).not.toBeInTheDocument()
      expect(map()).toHaveAttribute('data-stores', '')
    })

    it.each([
      ['비교 종료', () => fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))],
      ['조건 변경', () => fireEvent.click(within(panel()).getByRole('button', { name: '조건 변경' }))],
    ])('B 점포 조회 중 %s → 늦게 온 B 점포 응답은 버린다', async (_, act1) => {
      const late = pending()
      const fetchMock = await compareGuwol([late.promise])
      expect(nearbyCalls(fetchMock)).toHaveLength(2)
      const signal = (nearbyCalls(fetchMock)[1]![1] as RequestInit).signal!
      act1()
      expect(signal.aborted).toBe(true)
      await act(async () => late.respond(ok(guwolNearbyFixture)))
      expect(screen.queryByRole('list', { name: B_LIST })).not.toBeInTheDocument()
      expect(map()).not.toHaveAttribute('data-store-context')
    })

    it('B1 점포 조회 중 → B 다시 고르기 → B2 성공 → 늦은 B1 점포 응답은 버린다', async () => {
      const b1Stores = pending()
      const fetchMock = await compareGuwol([b1Stores.promise, ok(songdoNearbyFixture)], [ok(songdoFixture)])
      const b1Signal = (nearbyCalls(fetchMock)[1]![1] as RequestInit).signal!
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치 다시 고르기' }))
      expect(b1Signal.aborted).toBe(true)                                     // 다시 고르면 B1 점포 요청을 바로 취소
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      analyzeB()                                                              // B2 (송도, 0곳)
      expect(await screen.findByText('반경 500m 안에 같은 업종 점포가 없습니다.')).toBeInTheDocument()

      await act(async () => b1Stores.respond(ok(guwolNearbyFixture)))        // 늦은 B1(구월 6곳)
      expect(screen.getByText('반경 500m 안에 같은 업종 점포가 없습니다.')).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: B_LIST })).not.toBeInTheDocument()
      expect(map()).toHaveAttribute('data-stores', '0')
      expect(map()).toHaveAttribute('data-store-context', 'B 송도2동 주변')
    })

    it('비교 종료 뒤 A 점포와 표시 설정("지도에 표시")을 되살린다', async () => {
      await analyzeA([ok(guwolFixture)], [ok(guwolNearbyFixture)])
      fireEvent.click(screen.getByRole('checkbox', { name: '지도에 표시' }))    // A 단일 결과에서 끔
      expect(map()).toHaveAttribute('data-stores', '')

      startCompare()
      typeB(37.4475, 126.7015)
      analyzeB()
      await screen.findByRole('list', { name: B_LIST })
      expect(screen.getByRole('checkbox', { name: '지도에 표시' })).toBeChecked()  // 비교는 따로(기본 켬)
      expect(map()).toHaveAttribute('data-stores', '6')

      fireEvent.click(within(panel()).getByRole('button', { name: '비교 종료' }))
      expect(screen.getByRole('list', { name: 'PC방 점포 목록' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: '지도에 표시' })).not.toBeChecked()
      expect(map()).toHaveAttribute('data-stores', '')
      expect(map()).not.toHaveAttribute('data-store-context')
    })

    it('비교 요약 목록에서도 Escape는 선택만 지우고 포커스는 그 항목에 남는다', async () => {
      await compareGuwol()
      await screen.findByRole('list', { name: B_LIST })
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
      await screen.findByRole('list', { name: B_LIST })
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
      fireEvent.click(within(bCard()).getByRole('button', { name: 'B 전체 결과 보기' }))
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

      fireEvent.click(within(panel()).getByRole('button', { name: '지도 보기' }))
      expect(app()).toHaveAttribute('data-screen', 'map')
      expect(sheet()).toHaveTextContent('B 연수구 송도2동 분석을 마쳤습니다')
      expect(document.activeElement).toBe(within(sheet()).getByRole('button', { name: '비교 화면 보기' }))
      fireEvent.click(within(sheet()).getByRole('button', { name: '비교 종료' }))
      expect(app()).toHaveAttribute('data-screen', 'panel')
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '다른 위치와 비교' }))
    })

    it('B 실패 뒤 지도 화면 sheet는 실패를 알리고 비교 화면으로 돌아갈 수 있다', async () => {
      await analyzeA([{ status: 422, body: { error: { code: 'location_outside', message: 'x' } } }])
      startCompare()
      fireEvent.click(screen.getByRole('button', { name: '지도 클릭: 송도' }))
      fireEvent.click(within(sheet()).getByRole('button', { name: 'B 분석하기' }))
      await waitFor(() => expect(app()).toHaveAttribute('data-screen', 'panel'))
      expect(document.activeElement).toBe(within(bCard()).getByRole('button', { name: '지도에서 다시 선택' }))

      fireEvent.click(within(panel()).getByRole('button', { name: '지도 보기' }))
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
      fireEvent.click(screen.getByRole('button', { name: '지도 보기' }))
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
    expect(screen.getByText('37.4894, 126.7246', { selector: '.location__value .mono' })).toBeInTheDocument()   // 좌표 표시는 그대로

    const select = screen.getByRole('combobox', { name: '업종' })
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'R10406' } })
    fireEvent.click(analyzeButton())
    await screen.findByRole('list', { name: 'PC방 점포 목록' })
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
    fireEvent.click(within(conditions).getByRole('button', { name: '좌표 직접 입력' }))
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
    fireEvent.click(screen.getByRole('button', { name: '조건 변경' }))
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
    await screen.findByRole('list', { name: 'PC방 점포 목록' })
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
      await screen.findByRole('list', { name: 'PC방 점포 목록' })
      fireEvent.click(screen.getByRole('button', { name: '지도 보기' }))
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
  const lineIn = (el: HTMLElement) => within(el).queryByTestId('reference-address')
  const sideButton = (name: RegExp) => within(screen.getByRole('group', { name: '점포 기준 위치' })).getByRole('button', { name })
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
    await screen.findByRole('list', { name: 'PC방 점포 목록' })
    fireEvent.click(screen.getByRole('button', { name: '다른 위치와 비교' }))
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
    await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })

    // 비교 요약: A 카드는 A context 좌표, B 카드는 B context 좌표 — 선택 단계와 같은 키라 추가 조회 없음
    expect(lineIn(aCard())).toHaveTextContent(`참고 주소 · ${A_ADDR} (NAVER 지도)`)
    expect(aCard()).not.toHaveTextContent(B1_ADDR)
    expect(lineIn(bCard())).toHaveTextContent(`참고 주소 · ${B1_ADDR} (NAVER 지도)`)
    expect(bCard()).not.toHaveTextContent(A_ADDR)
    expect(aCard()).toHaveTextContent('부평구 부평1동')                              // 행정동·최근접역은 그대로
    expect(bCard()).toHaveTextContent('남동구 구월3동')
    expect(screen.getByRole('group', { name: '분석 조건' })).not.toHaveTextContent('참고 주소')   // Context Bar에는 없음
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: PANEL }))
    expect(sdkMock.reverseCalls).toHaveLength(2)

    // 점포 기준 A/B 전환: 주소 줄·조회 그대로
    await screen.findByRole('list', { name: 'B 남동구 구월3동 PC방 점포 목록' })
    fireEvent.click(sideButton(/^A 부평1동$/))
    fireEvent.click(sideButton(/^B 구월3동$/))
    expect(addressLines()).toHaveLength(2)

    // B 전체 결과: 보고 있는 B 위치의 주소 한 줄만
    fireEvent.click(screen.getByRole('button', { name: 'B 전체 결과 보기' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'B · 남동구 구월3동 · PC방 분석' }))
    expect(addressLines()).toHaveLength(1)
    expect(addressLines()[0]).toHaveTextContent(B1_ADDR)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'B 전체 결과 보기' }))

    // A 전체 결과: A 주소만
    fireEvent.click(screen.getByRole('button', { name: 'A 전체 결과 보기' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'A · 부평구 부평1동 · PC방 분석' }))
    expect(addressLines()).toHaveLength(1)
    expect(addressLines()[0]).toHaveTextContent(A_ADDR)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'A 전체 결과 보기' }))
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
    await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })
    expect(lineIn(aCard())).toHaveTextContent(A_ADDR)
    expect(lineIn(bCard())).toHaveTextContent(B2_ADDR)
    expect(screen.queryByText(B1_ADDR, { exact: false })).not.toBeInTheDocument()
    expect(sdkMock.reverseCalls).toHaveLength(3)

    // B를 다시 고르면 B2 주소는 사라진다. B1 좌표로 돌아가면 늦게 온 B1 응답(자기 키 캐시)을 조회 없이 쓴다
    fireEvent.click(within(bCard()).getByRole('button', { name: 'B 위치 다시 고르기' }))
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
    await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })
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
    await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })
    expect(addressLines()).toHaveLength(0)
    expect(aCard()).toHaveTextContent('부평구 부평1동')
    expect(bCard()).toHaveTextContent('남동구 구월3동')
    expect(await screen.findByRole('list', { name: 'B 남동구 구월3동 PC방 점포 목록' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'B 전체 결과 보기' }))
    expect(screen.getByRole('heading', { level: 1, name: 'B · 남동구 구월3동 · PC방 분석' })).toBeInTheDocument()
    expect(addressLines()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    fireEvent.click(screen.getByRole('button', { name: 'A 전체 결과 보기' }))
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
    await screen.findByRole('table', { name: /종합·5대 관점 점수 비교/ })
    expect(lineIn(aCard())).toHaveTextContent(A_ADDR)
    expect(lineIn(bCard())).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'SDK 인증 실패' }))
    expect(addressLines()).toHaveLength(0)
    await respond(1, 200, reverseOk(B1_ADDR))                                      // 늦은 B 응답
    expect(addressLines()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'B 전체 결과 보기' }))
    expect(addressLines()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '비교로 돌아가기' }))
    expect(screen.getByRole('table', { name: /종합·5대 관점 점수 비교/ })).toBeInTheDocument()
    expect(sdkMock.reverseCalls).toHaveLength(2)
    expect(analyzeCalls(fetchMock)).toHaveLength(2)
  })
})
