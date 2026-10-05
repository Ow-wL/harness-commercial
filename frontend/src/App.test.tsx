import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Mock } from 'vitest'
import App from './App.tsx'
import type { MapViewProps } from './components/MapView.tsx'
import fixture from './fixtures/bupyeong-pcbang.json'

// 지도는 SDK 경계(MapView) 통째로 mock한다 — 실제 NAVER SDK를 부르지 않는다.
// mock은 실제 MapView와 같은 계약: interactive=false면 클릭을 무시하고, 클릭 좌표를 onSelect로 넘긴다.
vi.mock('./components/MapView.tsx', () => ({
  MapView: (props: MapViewProps) => (
    <div
      data-testid="map"
      data-selected={props.selected ? `${props.selected.lat},${props.selected.lng}` : ''}
      data-tone={props.markerTone}
      data-dong={props.dong ? `${props.dong.guCode} ${props.dong.dongName}` : ''}
    >
      <button type="button" onClick={() => props.interactive && props.onSelect({ lat: 37.4894, lng: 126.7246 })}>
        지도 클릭: 부평역
      </button>
      <button type="button" onClick={() => props.interactive && props.onSelect({ lat: 37.392512, lng: 126.639034 })}>
        지도 클릭: 송도
      </button>
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

/** fetch mock: /businesses는 CATALOG, /analyze는 차례대로 replies */
function mockApi({ businesses = { status: 200, body: CATALOG } as Reply, analyze = [] as Reply[] } = {}) {
  const queue = [...analyze]
  const fetchMock = vi.fn(async (url: string) => {
    const reply = url === '/businesses' ? businesses : queue.shift()
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
