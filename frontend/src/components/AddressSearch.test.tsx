import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import forwardFixture from '../fixtures/geocoder-forward-bupyeong-daero.json'
import type { NaverMapsApi } from '../map/naverMaps.ts'
import { brokenControls, brokenReferences, duplicateIds, expandAll } from '../test/a11yRefs.ts'
import { AddressSearch } from './AddressSearch.tsx'

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

/** 정방향 성공 응답 (실제 fixture와 같은 모양, 쓰는 필드만) */
function forward(items: { road: string; jibun?: string; sido: string; x: string; y: string }[]) {
  return {
    v2: {
      status: 'OK',
      meta: { totalCount: items.length, page: 1, count: items.length },
      addresses: items.map((i) => ({
        roadAddress: i.road,
        jibunAddress: i.jibun ?? '',
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

function setup({ disabled = false } = {}) {
  const { api, calls } = fakeApi()
  const onSelect = vi.fn()
  const onFocusLost = vi.fn()
  const utils = render(<AddressSearch api={api} disabled={disabled} onSelect={onSelect} onFocusLost={onFocusLost} />)
  return { ...utils, api, calls, onSelect, onFocusLost }
}

const open = () => fireEvent.click(screen.getByRole('button', { name: '주소로 찾기' }))
const input = () => screen.getByRole('textbox', { name: '주소' })
const type = (v: string) => fireEvent.change(input(), { target: { value: v } })
const submit = () => fireEvent.submit(screen.getByRole('search', { name: '주소 검색' }))
const status = () => document.querySelector('.address-search__status')!
const respond = async (call: Call | undefined, status: number, response?: unknown) => {
  await act(async () => {
    call!.callback(status, response)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('AddressSearch — 지원 범위 안내·예시 주소 (12-21)', () => {
  it('폼 아래에 "도로명·지번 주소만" 안내와 예시 버튼 3개가 있고, 예시를 누르면 입력란에 넣고 바로 1회 검색한다', async () => {
    const { calls, onSelect } = setup()
    open()
    expect(screen.getByText('도로명·지번 주소만 찾습니다. 역·건물·가게 이름은 아직 되지 않습니다.')).toBeInTheDocument()
    const examples = ['부평대로 1', '인하로 497-23', '인천타워대로 99']
    for (const q of examples) expect(screen.getByRole('button', { name: q })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '인하로 497-23' }))
    expect(input()).toHaveValue('인하로 497-23')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options.query).toBe('인하로 497-23')
    expect(onSelect).not.toHaveBeenCalled()                 // 검색만, 선택은 결과를 눌러야
    await respond(calls[0], 200, forward([{ road: '인천광역시 남동구 인하로 497-23', sido: '인천광역시', x: '126.73', y: '37.45' }]))
    expect(status()).toHaveTextContent('‘인하로 497-23’ 검색 결과 1건')
  })
})

describe('AddressSearch — 주소로 찾기 (7-B4, ADDRESS_DESIGN §5.2 A)', () => {
  it('펼침 버튼으로 보이는 라벨·입력·검색 버튼을 연다. 입력 중에는 부르지 않고, 제출 1회에 호출 1회(trim·인천시청 기준·10건)', async () => {
    const { calls } = setup()
    const toggle = screen.getByRole('button', { name: '주소로 찾기' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    open()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(input())
    expect(screen.getByRole('button', { name: '검색' })).toHaveAttribute('type', 'submit')

    type('부평대로')
    type('부평대로 1')
    expect(calls).toHaveLength(0)                                   // 입력 중 자동 호출 없음
    type('  인천광역시 부평구 부평대로 1  ')
    submit()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options).toEqual({ query: '인천광역시 부평구 부평대로 1', coordinate: '126.7052,37.4563', count: 10 })
    expect(status()).toHaveTextContent('주소를 찾는 중…')
    expect(status()).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: '검색' })).toHaveAttribute('aria-busy', 'true')
  })

  it('공백만 제출하면 부르지 않고 aria-invalid·안내를 보인다. 내용을 쓰면 안내가 사라진다', () => {
    const { calls } = setup()
    open()
    submit()
    type('   ')
    submit()
    expect(calls).toHaveLength(0)
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    expect(input()).toHaveAccessibleDescription('검색할 주소를 입력하세요')
    type('부평')
    expect(input()).not.toHaveAttribute('aria-invalid')
  })

  it('실제 응답(fixture): 도로명 우선 + 지번 보조, 고르면 adapter lat/lng 그대로 onSelect 1회, 폼은 접힌다(분석 시작 없음)', async () => {
    const { calls, onSelect } = setup()
    open()
    type('인천광역시 부평구 부평대로 1')
    submit()
    await respond(calls[0], 200, forwardFixture.response)
    expect(status()).toHaveTextContent('‘인천광역시 부평구 부평대로 1’ 검색 결과 1건')
    const list = screen.getByRole('list', { name: '‘인천광역시 부평구 부평대로 1’ 검색 결과 1건' })
    const item = within(list).getByRole('button')
    expect(item).toHaveTextContent('인천광역시 부평구 부평대로 3')
    expect(item).toHaveTextContent('지번 인천광역시 부평구 부평동 549-39')
    expect(item).not.toHaveTextContent('인천광역시 부평구 부평대로 3인천광역시')   // 시·도 caption은 인천 밖만
    fireEvent.click(item)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith({ lat: 37.4918321, lng: 126.7227259 })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '주소로 찾기' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('인천을 앞에 두고 인천 밖 결과도 고를 수 있다(시·도 caption만). 5개 먼저, "더 보기"는 받은 목록을 펼치며 다시 부르지 않는다', async () => {
    const { calls, onSelect } = setup()
    open()
    type('중앙로')
    submit()
    const items = [
      { road: '서울특별시 중구 중앙로 1', sido: '서울특별시', x: '126.98', y: '37.56' },
      ...Array.from({ length: 6 }, (_, i) => ({ road: `인천광역시 남동구 중앙로 ${i + 1}`, sido: '인천광역시', x: '126.70', y: `37.4${i}` })),
    ]
    await respond(calls[0], 200, forward(items))
    const list = () => screen.getByRole('list', { name: /검색 결과 7건/ })
    expect(within(list()).getAllByRole('button')).toHaveLength(5)
    expect(within(list()).getAllByRole('button')[0]).toHaveTextContent('인천광역시 남동구 중앙로 1')   // 인천 먼저(받은 순서 유지)
    fireEvent.click(screen.getByRole('button', { name: '더 보기 (2건)' }))
    const buttons = within(list()).getAllByRole('button')
    expect(buttons).toHaveLength(7)
    expect(document.activeElement).toBe(buttons[5])                // 펼친 첫 새 항목으로 포커스
    expect(screen.queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument()
    expect(calls).toHaveLength(1)                                  // 추가 호출 없음
    const seoul = buttons[6]!
    expect(seoul).toHaveTextContent('서울특별시 중구 중앙로 1')
    expect(seoul).toHaveTextContent('서울특별시')
    expect(seoul).toBeEnabled()                                    // 사전 차단 없음 — 판정은 backend
    fireEvent.click(seoul)
    expect(onSelect).toHaveBeenCalledWith({ lat: 37.56, lng: 126.98 })
  })

  it('도로명이 없으면 지번을 주 문구로 쓴다', async () => {
    const { calls } = setup()
    open()
    type('부평동 549')
    submit()
    await respond(calls[0], 200, forward([{ road: '', jibun: '인천광역시 부평구 부평동 549-39', sido: '인천광역시', x: '126.72', y: '37.49' }]))
    const item = within(screen.getByRole('list')).getByRole('button')
    expect(item).toHaveTextContent(/^인천광역시 부평구 부평동 549-39$/)
  })

  it('0건·오류는 aria-live로 안내하고 입력값을 지우지 않는다. 다시 검색할 수 있다', async () => {
    const { calls } = setup()
    open()
    type('없는주소123')
    submit()
    await respond(calls[0], 200, { v2: { status: 'OK', meta: { totalCount: 0, page: 1, count: 0 }, addresses: [], errorMessage: '' } })
    expect(status()).toHaveTextContent('‘없는주소123’에 맞는 주소를 찾지 못했습니다. 역·건물 이름이 아니라 도로명·번지로 적어 보세요(예: 부평대로 1).')
    expect(input()).toHaveValue('없는주소123')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    submit()
    await respond(calls[1], 500, undefined)                        // SDK ERROR + 응답 없음 → unknown
    expect(status()).toHaveTextContent('주소 검색을 지금 쓸 수 없습니다. 지도에서 고르거나 좌표를 입력하세요.')
    expect(input()).toHaveValue('없는주소123')

    submit()
    await respond(calls[2], 500, { v2: { status: 'INVALID_REQUEST', errorMessage: '' } })
    expect(status()).toHaveTextContent('검색어를 확인해 주세요')
    expect(calls).toHaveLength(3)
  })

  describe('늦은 응답 폐기 (요청 번호)', () => {
    const ok = forward([{ road: '인천광역시 부평구 부평대로 3', sido: '인천광역시', x: '126.72', y: '37.49' }])

    it('검색 중 입력을 바꾸면 그 응답은 버린다(검색 중 안내도 사라짐)', async () => {
      const { calls } = setup()
      open()
      type('부평대로')
      submit()
      type('부평대로 3')
      expect(status()).toHaveTextContent('')
      await respond(calls[0], 200, ok)
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(status()).toHaveTextContent('')
    })

    it('재검색하면 앞 요청의 늦은 응답은 버리고 마지막 요청만 보인다', async () => {
      const { calls } = setup()
      open()
      type('부평대로')
      submit()
      submit()
      await respond(calls[1], 200, forward([{ road: '두 번째 결과', sido: '인천광역시', x: '126.7', y: '37.4' }]))
      await respond(calls[0], 200, ok)
      expect(within(screen.getByRole('list')).getByRole('button')).toHaveTextContent('두 번째 결과')
      expect(screen.queryByText('인천광역시 부평구 부평대로 3')).not.toBeInTheDocument()
    })

    it('폼을 닫으면 늦은 응답은 버리고, 다시 열어도 보이지 않는다(입력값은 남는다)', async () => {
      const { calls } = setup()
      open()
      type('부평대로')
      submit()
      open()                                                       // 닫기
      await respond(calls[0], 200, ok)
      open()                                                       // 다시 열기
      expect(input()).toHaveValue('부평대로')
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
      expect(status()).toHaveTextContent('')
    })

    it('언마운트(예: SDK 실패로 부모가 내림) 뒤 응답은 아무것도 하지 않는다', async () => {
      const { calls, unmount, onSelect } = setup()
      open()
      type('부평대로')
      submit()
      unmount()
      await respond(calls[0], 200, ok)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('api가 바뀌면(새 SDK 상태) 앞 요청의 응답은 버린다', async () => {
      const first = fakeApi()
      const second = fakeApi()
      function Host() {
        const [api, setApi] = useState(first.api)
        return (
          <>
            <button type="button" onClick={() => setApi(second.api)}>api 교체</button>
            <AddressSearch api={api} disabled={false} onSelect={() => {}} />
          </>
        )
      }
      render(<Host />)
      open()
      type('부평대로')
      submit()
      fireEvent.click(screen.getByRole('button', { name: 'api 교체' }))
      await respond(first.calls[0], 200, ok)
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
    })
  })

  it('포커스를 가진 채로 언마운트되면 onFocusLost, 포커스가 밖이면 부르지 않는다', () => {
    const a = setup()
    open()
    input().focus()
    a.unmount()
    expect(a.onFocusLost).toHaveBeenCalledTimes(1)

    const b = setup()
    b.unmount()
    expect(b.onFocusLost).not.toHaveBeenCalled()
  })

  it('labelPrefix("B ")는 펼침 버튼·라벨·검색 영역 이름에만 붙고 동작은 같다 (7-B5)', async () => {
    const { api, calls } = fakeApi()
    const onSelect = vi.fn()
    render(<AddressSearch api={api} disabled={false} onSelect={onSelect} labelPrefix="B " />)
    fireEvent.click(screen.getByRole('button', { name: 'B 주소로 찾기' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'B 주소' }), { target: { value: '부평대로 1' } })
    fireEvent.submit(screen.getByRole('search', { name: 'B 주소 검색' }))
    expect(calls).toHaveLength(1)
    await respond(calls[0], 200, forwardFixture.response)
    fireEvent.click(within(screen.getByRole('list')).getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith({ lat: 37.4918321, lng: 126.7227259 })
  })

  it('disabled면 펼침·입력·검색·결과 선택을 모두 막는다', async () => {
    const { calls, rerender, api, onSelect } = setup()
    open()
    type('부평대로')
    submit()
    await respond(calls[0], 200, forward([{ road: '인천광역시 부평구 부평대로 3', sido: '인천광역시', x: '126.72', y: '37.49' }]))
    rerender(<AddressSearch api={api} disabled onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: '주소로 찾기' })).toBeDisabled()
    expect(input()).toBeDisabled()
    expect(screen.getByRole('button', { name: '검색' })).toBeDisabled()
    expect(within(screen.getByRole('list')).getByRole('button')).toBeDisabled()
  })

  it('결과가 있을 때 id가 유일하고 접근성 참조가 이어진다', async () => {
    const { calls } = setup()
    open()
    submit()                                                       // 공백 안내(aria-describedby)
    type('부평대로')
    submit()
    await respond(calls[0], 200, forward([{ road: '인천광역시 부평구 부평대로 3', sido: '인천광역시', x: '126.72', y: '37.49' }]))
    expandAll()
    expect(duplicateIds()).toEqual([])
    expect(brokenReferences()).toEqual([])
    expect(brokenControls()).toEqual([])
  })
})

describe('AddressSearch — embedded (위치 입력 방법 segmented, P2·P3)', () => {
  it('펼침 버튼 없이 폼이 열려 있고, 결과를 고르면 목록만 닫히고 폼·입력값은 남는다', async () => {
    const { api, calls } = fakeApi()
    const onSelect = vi.fn()
    render(<AddressSearch api={api} disabled={false} onSelect={onSelect} embedded />)
    expect(screen.queryByRole('button', { name: '주소로 찾기' })).not.toBeInTheDocument()
    type('부평대로 3')
    submit()
    await respond(calls[0], 200, forwardFixture.response)
    const list = screen.getByRole('list', { name: /검색 결과/ })
    fireEvent.click(within(list).getAllByRole('button')[0]!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('list', { name: /검색 결과/ })).not.toBeInTheDocument()
    expect(input()).toHaveValue('부평대로 3')
    expect(status()).toHaveTextContent('')
  })
})
