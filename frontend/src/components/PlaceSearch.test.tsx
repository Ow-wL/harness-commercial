import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PlaceSearch } from './PlaceSearch.tsx'

const PLACES = {
  count: 2,
  places: [
    { name: '부평역 1호선', category: '교통,운수>지하철,전철', road_address: '인천광역시 부평구 부평대로 1', jibun_address: '인천광역시 부평구 부평동 738', lat: 37.4894, lng: 126.724 },
    { name: '부평역 서울', category: '교통', road_address: '서울특별시 어딘가 1', jibun_address: null, lat: 37.55, lng: 126.98 },
  ],
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())
const status = () => document.querySelector('.address-search__status')!

describe('장소 이름으로 찾기 (12-14)', () => {
  it('제출 때만 POST /places {q} 를 1회 부르고, 결과를 고르면 좌표 그대로 onSelect, 인천 밖은 표시로만 알린다', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => (url === '/places' ? json(200, PLACES) : json(404, {})))
    vi.stubGlobal('fetch', fetchMock)
    const onSelect = vi.fn()
    render(<PlaceSearch disabled={false} onSelect={onSelect} embedded />)
    const input = screen.getByRole('textbox', { name: '장소 이름' })
    fireEvent.change(input, { target: { value: ' 부평역 ' } })
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByRole('search', { name: '장소 이름 검색' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/places')
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ q: '부평역' })   // 다듬은 검색어, 본문으로
    const list = await screen.findByRole('list', { name: /검색 결과 2건/ })
    const buttons = within(list).getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('부평역 1호선 · 지하철,전철')
    expect(buttons[0]).toHaveTextContent('인천광역시 부평구 부평대로 1')
    expect(buttons[1]).toHaveTextContent('인천 밖일 수 있음')
    expect(buttons[0]).toHaveFocus()
    fireEvent.click(buttons[0]!)
    expect(onSelect).toHaveBeenCalledWith({ lat: 37.4894, lng: 126.724 })
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('빈 검색어는 부르지 않고, 예시 버튼은 바로 검색하며, 없음·설정 없음·네트워크 오류 문구를 구분한다', async () => {
    const replies: Response[] = [json(200, { count: 0, places: [] }), json(503, { error: { code: 'places_unavailable', message: 'x' } })]
    const fetchMock = vi.fn(async () => replies.shift() ?? Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlaceSearch disabled={false} onSelect={() => {}} embedded />)
    fireEvent.submit(screen.getByRole('search', { name: '장소 이름 검색' }))
    expect(screen.getByText('검색할 장소 이름을 입력하세요')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '부평역' }))
    expect(screen.getByRole('textbox', { name: '장소 이름' })).toHaveValue('부평역')
    await waitFor(() => expect(status()).toHaveTextContent('‘부평역’에 맞는 장소를 찾지 못했습니다'))

    fireEvent.click(screen.getByRole('button', { name: '인천시청' }))
    await waitFor(() => expect(status()).toHaveTextContent('이 서버에는 장소 이름 검색이 설정되어 있지 않습니다'))

    fireEvent.click(screen.getByRole('button', { name: '송도 트리플스트리트' }))
    await waitFor(() => expect(status()).toHaveTextContent('장소 검색을 지금 쓸 수 없습니다'))
  })

  it('펼침 버튼 모드(B): "B 장소 이름으로 찾기"로 열고, 입력이 바뀌면 진행 중 응답을 버린다', async () => {
    let resolve!: (r: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)))
    vi.stubGlobal('fetch', fetchMock)
    render(<PlaceSearch disabled={false} onSelect={() => {}} labelPrefix="B " />)
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'B 장소 이름으로 찾기' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'B 장소 이름' }), { target: { value: '부평역' } })
    fireEvent.submit(screen.getByRole('search', { name: 'B 장소 이름 검색' }))
    expect(status()).toHaveTextContent('장소를 찾는 중')
    fireEvent.change(screen.getByRole('textbox', { name: 'B 장소 이름' }), { target: { value: '부평역 2' } })
    resolve(json(200, PLACES))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(status()).toHaveTextContent('')
  })
})
