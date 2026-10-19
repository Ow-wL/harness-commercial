import { fireEvent, render, screen, within } from '@testing-library/react'
import { NearbyStoresResponseSchema, type NearbyStoresResponse } from '../api/schemas.ts'
import nearbyFixture from '../fixtures/bupyeong-pcbang-nearby.json'
import { NearbyStores, type NearbyState } from './NearbyStores.tsx'

/** 실제 POST /nearby-stores 응답 (부평역 · PC방 12곳) */
const NEARBY = NearbyStoresResponseSchema.parse(nearbyFixture)

function renderList(state: NearbyState, expectedCount = 12, onSelect = vi.fn()) {
  render(
    <NearbyStores
      state={state}
      bizName="PC방"
      radiusM={500}
      expectedCount={expectedCount}
      show
      onShowChange={() => {}}
      activeId={null}
      onSelect={onSelect}
      onRetry={() => {}}
    />,
  )
  return onSelect
}

describe('NearbyStores (DESIGN.md §8.14)', () => {
  it('fixture는 응답 계약을 통과하고 count == stores 수, 가까운 순이다', () => {
    expect(NEARBY.count).toBe(NEARBY.stores.length)
    const d = NEARBY.stores.map((s) => s.distance_m)
    expect(d).toEqual([...d].sort((a, b) => a - b))
    expect(NearbyStoresResponseSchema.safeParse({ ...nearbyFixture, count: 3 }).success).toBe(false)
  })

  it('상호·주소가 없으면 없다고 표시하고, 도로명이 없으면 지번주소를 쓴다', () => {
    const data: NearbyStoresResponse = {
      ...NEARBY,
      count: 2,
      stores: [
        { ...NEARBY.stores[0]!, name: null, road_address: null, jibun_address: null },
        { ...NEARBY.stores[1]!, road_address: null, jibun_address: '인천광역시 부평구 부평동 1-1' },
      ],
    }
    renderList({ status: 'success', data }, 2)
    const items = within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')
    expect(items[0]).toHaveTextContent('상호 정보 없음')
    expect(items[0]).toHaveTextContent('주소 정보 없음')
    expect(items[1]).toHaveTextContent('인천광역시 부평구 부평동 1-1')
  })

  it('0곳이면 없다고 표시하고 지도 토글을 두지 않는다', () => {
    renderList({ status: 'success', data: { ...NEARBY, count: 0, stores: [] } }, 0)
    expect(screen.getByText('반경 500m 안에 같은 업종 점포가 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '지도에 표시' })).not.toBeInTheDocument()
    expect(screen.queryByText(/분석의 동종 점포 수/)).not.toBeInTheDocument()
  })

  it('목록 항목은 키보드로 누를 수 있는 버튼이고, 누르면 그 점포 id를 넘긴다', () => {
    const onSelect = renderList({ status: 'success', data: NEARBY })
    const first = within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')[0]!
    expect(first.tagName).toBe('BUTTON')
    expect(first).toHaveAttribute('type', 'button')
    expect(first).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(first)
    expect(onSelect).toHaveBeenCalledWith(NEARBY.stores[0]!.id)
  })

  it('지도에서 고른 점포가 접힌 뒤쪽(6번째 이후)이면 목록을 펼쳐 선택 상태를 보인다', () => {
    render(
      <NearbyStores
        state={{ status: 'success', data: NEARBY }}
        bizName="PC방"
        radiusM={500}
        expectedCount={12}
        show
        onShowChange={() => {}}
        activeId={NEARBY.stores[8]!.id}
        onSelect={() => {}}
        onRetry={() => {}}
      />,
    )
    const items = within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')
    expect(items).toHaveLength(12)
    expect(items[8]).toHaveAttribute('aria-pressed', 'true')
    const collapse = screen.getByRole('button', { name: '가까운 5곳만 보기' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)                                     // 사용자가 다시 접으면 접힌다
    expect(within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')).toHaveLength(5)
  })

  it('목록 영역에서 Escape를 누르면 선택을 지우고(onSelect(null)), 포커스는 그 항목에 남는다', () => {
    const onSelect = vi.fn()
    render(
      <NearbyStores
        state={{ status: 'success', data: NEARBY }}
        bizName="PC방"
        radiusM={500}
        expectedCount={12}
        show
        onShowChange={() => {}}
        activeId={NEARBY.stores[1]!.id}
        onSelect={onSelect}
        onRetry={() => {}}
      />,
    )
    const item = within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')[1]!
    item.focus()
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(onSelect).toHaveBeenCalledWith(null)
    expect(document.activeElement).toBe(item)
  })

  it('선택이 없으면 Escape는 아무것도 하지 않는다', () => {
    const onSelect = renderList({ status: 'success', data: NEARBY })
    const item = within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')[0]!
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('불러오는 중은 aria-live로 알린다', () => {
    renderList({ status: 'loading' })
    expect(screen.getByText('점포 목록을 불러오는 중…')).toHaveAttribute('aria-live', 'polite')
  })
})

describe('NearbyStores — 두 위치 비교 중 기준 위치 (5차-B5)', () => {
  it('place가 있으면 제목·개수 안내·목록 이름에 붙이고, sideSwitch를 제목 아래에 둔다', () => {
    render(
      <NearbyStores
        state={{ status: 'success', data: NEARBY }}
        bizName="PC방"
        radiusM={500}
        expectedCount={12}
        show
        onShowChange={() => {}}
        activeId={null}
        onSelect={() => {}}
        onRetry={() => {}}
        place="A 부평구 부평1동"
        sideSwitch={<div role="group" aria-label="점포 기준 위치" />}
      />,
    )
    const region = screen.getByRole('region', { name: '반경 500m 안 같은 업종 점포 · A 부평구 부평1동' })
    expect(region).toHaveTextContent('A 부평구 부평1동 · PC방 12곳')
    expect(within(region).getByRole('list', { name: 'A 부평구 부평1동 PC방 점포 목록' })).toBeInTheDocument()
    const group = within(region).getByRole('group', { name: '점포 기준 위치' })
    expect(group.previousElementSibling).toHaveClass('result-section__head')
  })

  it('place가 없으면 지금(단일 분석) 문구 그대로', () => {
    renderList({ status: 'success', data: NEARBY })
    expect(screen.getByRole('region', { name: '반경 500m 안 같은 업종 점포' })).toHaveTextContent(/^반경 500m 안 같은 업종 점포/)
    expect(screen.getByRole('list', { name: 'PC방 점포 목록' })).toBeInTheDocument()
  })
})

describe('NearbyStores — 점포 거리 띠 (P7)', () => {
  const strip = () => document.querySelector('.nearby__strip')!

  it('점포 1개 = 점 1개(접힌 목록과 무관하게 전체), 위치는 distance_m / 반경, 점은 장식이다', () => {
    renderList({ status: 'success', data: NEARBY })
    const dots = [...strip().querySelectorAll<HTMLElement>('.nearby__dot')]
    expect(dots).toHaveLength(NEARBY.count)
    expect(dots.map((d) => d.style.left)).toEqual(NEARBY.stores.map((s) => `${(s.distance_m / 500) * 100}%`))
    expect(strip()).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('.nearby__axis')).toHaveTextContent('분석 지점250m500m')
  })

  it('텍스트 대체는 반경보다 짧은 구간만, 수는 distance_m 그대로 센다', () => {
    renderList({ status: 'success', data: NEARBY })
    const n = (m: number) => NEARBY.stores.filter((s) => s.distance_m <= m).length
    expect(screen.getByText(`100m 안 ${n(100)}곳 · 300m 안 ${n(300)}곳`)).toBeInTheDocument()
  })

  it('반경 300m면 100m 구간만, 0곳이면 띠를 그리지 않는다', () => {
    const { rerender } = render(
      <NearbyStores state={{ status: 'success', data: NEARBY }} bizName="PC방" radiusM={300} expectedCount={12}
        show onShowChange={() => {}} activeId={null} onSelect={() => {}} onRetry={() => {}} />,
    )
    expect(document.querySelector('.nearby__bands')).toHaveTextContent(/^100m 안 \d+곳$/)
    expect(document.querySelector('.nearby__axis')).toHaveTextContent('분석 지점150m300m')
    rerender(
      <NearbyStores state={{ status: 'success', data: { ...NEARBY, count: 0, stores: [] } }} bizName="PC방" radiusM={300}
        expectedCount={0} show onShowChange={() => {}} activeId={null} onSelect={() => {}} onRetry={() => {}} />,
    )
    expect(document.querySelector('.nearby__strip')).toBeNull()
  })

  it('선택한 점포의 점만 강조한다', () => {
    const id = NEARBY.stores[3]!.id
    render(
      <NearbyStores state={{ status: 'success', data: NEARBY }} bizName="PC방" radiusM={500} expectedCount={12}
        show onShowChange={() => {}} activeId={id} onSelect={() => {}} onRetry={() => {}} />,
    )
    const active = strip().querySelectorAll('.nearby__dot[data-active]')
    expect(active).toHaveLength(1)
    expect([...strip().children].indexOf(active[0]!)).toBe(3)
  })
})

describe('NearbyStores — 선택 항목의 네이버·구글 검색 링크 (묶음 B, 계획 2-4)', () => {
  const renderActive = (data: NearbyStoresResponse, activeId: string | null) =>
    render(
      <NearbyStores
        state={{ status: 'success', data }}
        bizName="PC방"
        radiusM={500}
        expectedCount={data.count}
        show
        onShowChange={() => {}}
        activeId={activeId}
        onSelect={() => {}}
        onRetry={() => {}}
      />,
    )

  it('선택한 항목 아래에만 "네이버 지도"·"구글 지도"(새 탭·noopener)와 안내 문구가 있고, 버튼 안에는 넣지 않는다', () => {
    const first = NEARBY.stores[0]!
    renderActive(NEARBY, first.id)
    const row = screen.getByLabelText(`${first.name} 외부 지도 검색`)
    const links = within(row).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['네이버 지도', '구글 지도'])
    expect(links[1]).toHaveAttribute('href', expect.stringContaining('https://www.google.com/maps/search/?api=1&query='))
    expect(links[1]!.getAttribute('href')).toContain(encodeURIComponent(first.name!))
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank')
      expect((a as HTMLAnchorElement).rel.split(' ')).toContain('noopener')
    }
    expect(row).toHaveTextContent('검색 결과로 열립니다(같은 가게가 아닐 수 있음)')
    expect(screen.getAllByRole('link')).toHaveLength(2)                              // 다른 항목에는 없다
    const item = within(screen.getByRole('list', { name: 'PC방 점포 목록' })).getAllByRole('button')[0]!
    expect(item.querySelector('a')).toBeNull()
  })

  it('선택이 없으면 링크가 없고, 상호·주소가 모두 없는 점포는 선택해도 링크 줄이 없다', () => {
    const { unmount } = renderActive(NEARBY, null)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    unmount()
    const bare = { ...NEARBY.stores[0]!, name: null, road_address: null, jibun_address: null }
    renderActive({ ...NEARBY, count: 1, stores: [bare] }, bare.id)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryByText(/검색 결과로 열립니다/)).not.toBeInTheDocument()
  })
})
