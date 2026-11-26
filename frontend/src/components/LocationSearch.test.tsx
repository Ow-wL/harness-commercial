import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { NaverMapsApi } from '../map/naverMaps.ts'
import { availableMethod } from '../lib/locationSearch.ts'
import { LocationMethodSwitch } from './LocationMethodSwitch.tsx'
import { LocationSearch } from './LocationSearch.tsx'

type Call = { options: Record<string, unknown>; callback: (status: number, response?: unknown) => void }

function fakeApi() {
  const calls: Call[] = []
  const api = {
    Service: {
      Status: { OK: 200, ERROR: 500 },
      geocode: (options: Record<string, unknown>, callback: Call['callback']) => {
        calls.push({ options, callback })
      },
      reverseGeocode: () => {},
    },
  } as unknown as NaverMapsApi
  return { api, calls }
}

function forward(items: { road: string; sido: string; x: string; y: string }[]) {
  return {
    v2: {
      status: 'OK',
      meta: { totalCount: items.length, page: 1, count: items.length },
      addresses: items.map((i) => ({
        roadAddress: i.road,
        jibunAddress: '',
        englishAddress: '',
        addressElements: [{ types: ['SIDO'], longName: i.sido, shortName: i.sido, code: '' }],
        x: i.x,
        y: i.y,
        distance: 100,
      })),
      errorMessage: '',
    },
  }
}

const PLACES = {
  count: 1,
  places: [{ name: '부평역 1호선', category: '교통,운수>지하철,전철', road_address: '인천광역시 부평구 광장로 16', jibun_address: null, lat: 37.4895, lng: 126.7246 }],
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

afterEach(() => vi.unstubAllGlobals())

describe('검색으로 찾기 — 주소와 장소 이름을 검색창 하나로 (13-52)', () => {
  it('제출하면 주소와 장소를 1회씩 함께 찾고, 한 목록(주소 먼저)으로 보이며, 고르면 좌표 그대로 onSelect', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => (url === '/places' ? json(200, PLACES) : json(404, {})))
    vi.stubGlobal('fetch', fetchMock)
    const { api, calls } = fakeApi()
    const onSelect = vi.fn()
    render(<LocationSearch api={api} disabled={false} onSelect={onSelect} />)
    fireEvent.change(screen.getByRole('textbox', { name: '주소 또는 장소 이름' }), { target: { value: ' 부평 ' } })
    expect(calls).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByRole('search', { name: '위치 검색' }))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options.query).toBe('부평')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ q: '부평' })
    act(() => calls[0]!.callback(200, forward([{ road: '인천광역시 부평구 부평대로 1', sido: '인천광역시', x: '126.7236', y: '37.4901' }])))
    await flush()
    const list = screen.getByRole('list', { name: /검색 결과 2건/ })
    const buttons = within(list).getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('인천광역시 부평구 부평대로 1')
    expect(buttons[1]).toHaveTextContent('부평역 1호선 · 지하철,전철')
    expect(buttons[0]).toHaveFocus()
    fireEvent.click(buttons[1]!)
    expect(onSelect).toHaveBeenCalledWith({ lat: 37.4895, lng: 126.7246 })
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('한쪽이 실패해도 다른 쪽 결과는 보이고 실패한 쪽을 알린다. 둘 다 없으면 못 찾았다고 한다', async () => {
    const replies = [json(200, PLACES), json(200, { count: 0, places: [] })]
    vi.stubGlobal('fetch', vi.fn(async () => replies.shift()!))
    const { api, calls } = fakeApi()
    render(<LocationSearch api={api} disabled={false} onSelect={() => {}} />)
    const input = screen.getByRole('textbox', { name: '주소 또는 장소 이름' })
    fireEvent.change(input, { target: { value: '부평역' } })
    fireEvent.submit(screen.getByRole('search', { name: '위치 검색' }))
    act(() => calls[0]!.callback(500))                       // 주소 검색 실패
    await flush()
    expect(screen.getByRole('list', { name: /검색 결과 1건/ })).toBeInTheDocument()
    expect(screen.getByText('주소 검색은 지금 쓸 수 없어 장소 이름 결과만 보입니다.')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '없는곳' } })
    fireEvent.submit(screen.getByRole('search', { name: '위치 검색' }))
    act(() => calls[1]!.callback(200, forward([])))
    await flush()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(document.querySelector('.address-search__status')).toHaveTextContent('‘없는곳’에 맞는 곳을 찾지 못했습니다')
  })

  it('빈 검색어는 부르지 않고, 입력을 바꾸면 늦은 응답을 버린다', async () => {
    const fetchMock = vi.fn(async () => json(200, PLACES))
    vi.stubGlobal('fetch', fetchMock)
    const { api, calls } = fakeApi()
    render(<LocationSearch api={api} disabled={false} onSelect={() => {}} />)
    fireEvent.submit(screen.getByRole('search', { name: '위치 검색' }))
    expect(screen.getByText('찾을 주소나 장소 이름을 입력하세요')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    const input = screen.getByRole('textbox', { name: '주소 또는 장소 이름' })
    fireEvent.change(input, { target: { value: '부평역' } })
    fireEvent.submit(screen.getByRole('search', { name: '위치 검색' }))
    fireEvent.change(input, { target: { value: '부평역 2' } })   // 응답 전에 입력이 바뀜
    act(() => calls[0]!.callback(200, forward([{ road: '인천광역시 부평구 부평대로 1', sido: '인천광역시', x: '126.7', y: '37.4' }])))
    await flush()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('위치 입력 방법 — 검색 둘이 다 되면 하나로 합친다 (13-52)', () => {
  const labels = () => screen.getAllByRole('button').map((b) => b.textContent)

  it('둘 다 되면 "검색으로 찾기" 하나, 하나만 되면 기존 이름', () => {
    const { rerender } = render(<LocationMethodSwitch value="map" addressReady placesReady disabled={false} onChange={() => {}} />)
    expect(labels()).toEqual(['지도에서 고르기', '검색으로 찾기', '좌표 입력'])
    rerender(<LocationMethodSwitch value="map" addressReady placesReady={false} disabled={false} onChange={() => {}} />)
    expect(labels()).toEqual(['지도에서 고르기', '주소로 찾기', '좌표 입력'])
    rerender(<LocationMethodSwitch value="map" addressReady={false} placesReady disabled={false} onChange={() => {}} />)
    expect(labels()).toEqual(['지도에서 고르기', '장소 이름', '좌표 입력'])
  })

  it('availableMethod: 고른 검색 방법을 지금 되는 것으로 바꾼다', () => {
    expect(availableMethod('address', true, true)).toBe('search')
    expect(availableMethod('search', true, false)).toBe('address')    // 장소 검색이 꺼짐
    expect(availableMethod('search', false, true)).toBe('place')      // 지도 SDK 실패로 주소 검색이 꺼짐
    expect(availableMethod('search', false, false)).toBe('map')
    expect(availableMethod('coords', false, false)).toBe('coords')
    expect(availableMethod('map', true, true)).toBe('map')
  })
})
