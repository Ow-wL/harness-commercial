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

  it('불러오는 중은 aria-live로 알린다', () => {
    renderList({ status: 'loading' })
    expect(screen.getByText('점포 목록을 불러오는 중…')).toHaveAttribute('aria-live', 'polite')
  })
})
