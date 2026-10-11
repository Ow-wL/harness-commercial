import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Mock } from 'vitest'
import App from './App.tsx'
import type { MapViewProps } from './components/MapView.tsx'
import fixture from './fixtures/bupyeong-pcbang.json'
import nearbyFixture from './fixtures/bupyeong-pcbang-nearby.json'
import guwolFixture from './fixtures/compare-guwol-pcbang.json'
import songdoFixture from './fixtures/compare-songdo-pcbang.json'

// 지도는 SDK 경계(MapView) 통째로 mock한다 — 실제 NAVER SDK를 부르지 않는다.
// mock은 실제 MapView와 같은 계약: interactive=false면 클릭을 무시하고, 클릭 좌표를 onSelect로 넘긴다.
vi.mock('./components/MapView.tsx', () => ({
  MapView: (props: MapViewProps) => (
    <div
      data-testid="map"
      data-selected={props.selected ? `${props.selected.lat},${props.selected.lng}` : ''}
      data-tone={props.markerTone}
      data-dong={props.dong ? `${props.dong.guCode} ${props.dong.dongName}` : ''}
      data-stores={props.stores ? String(props.stores.length) : ''}
      data-active-store={props.activeStoreId ?? ''}
    >
      <button type="button" onClick={() => props.interactive && props.onSelect({ lat: 37.4894, lng: 126.7246 })}>
        지도 클릭: 부평역
      </button>
      <button type="button" onClick={() => props.interactive && props.onSelect({ lat: 37.392512, lng: 126.639034 })}>
        지도 클릭: 송도
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
  const ok = (body: unknown) => ({ status: 200, body })

  /** A(부평역·PC방) 분석과 A 점포 목록까지 마친 상태. analyze 뒤쪽 replies는 B 요청에 쓰인다 */
  async function analyzeA(bReplies: Reply[] = []) {
    const fetchMock = mockApi({ analyze: [ok(fixture), ...bReplies], nearby: [ok(nearbyFixture)] })
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
    const fetchMock = await analyzeA([ok(guwolFixture)])
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
    expect(await within(bCard()).findByText('남동구 구월3동')).toBeInTheDocument()
    expect(bCard()).toHaveTextContent('남동구 구월3동 · 종합 59.1')
    expect(bCard()).toHaveTextContent('B 위치 분석을 마쳤습니다: 남동구 구월3동')
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
    expect(nearbyCalls(fetchMock)).toHaveLength(1)                   // A 점포 데이터를 보존했다(다시 조회하지 않음)
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
    expect(bCard()).toHaveTextContent('연수구 송도2동 · 종합 64.9')
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
    expect(await within(bCard()).findByText('연수구 송도2동')).toBeInTheDocument()
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
    expect(await within(bCard()).findByText('남동구 구월3동')).toBeInTheDocument()
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
    expect(await within(bCard()).findByText('남동구 구월3동')).toBeInTheDocument()

    await act(async () => b1.respond(ok(songdoFixture)))             // 늦게 온 B1
    expect(bCard()).toHaveTextContent('남동구 구월3동 · 종합 59.1')
    expect(bCard()).not.toHaveTextContent('송도')
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
