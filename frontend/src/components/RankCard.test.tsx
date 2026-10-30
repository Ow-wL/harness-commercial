import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RankResponseSchema, type RankItem } from '../api/schemas.ts'
import { RankCard } from './RankCard.tsx'

const item = (biz_code: string, name: string, overall: number | null, extra: Partial<RankItem> = {}): RankItem => ({
  biz_code,
  name,
  group: '목적방문형',
  overall,
  weakest: overall === null ? null : { key: 'competition', label: '경쟁성', score: 30.2 },
  coverage: 1,
  regulated: false,
  warnings: 0,
  ...extra,
})

const DATA = RankResponseSchema.parse({
  lat: 37.4894,
  lng: 126.7246,
  radius_m: 500,
  gu_name: '부평구',
  dong_name: '부평1동',
  count: 8,
  items: [
    item('R10404', '노래방', 72.4, { regulated: true }),
    item('P10501', '독서실/스터디 카페', 72.1),
    item('R10402', '당구장', 71.1),
    item('I21201', '카페', 69.7),
    item('I20101', '치킨', 67.4),
    item('G20405', '편의점', 65.0),
    item('R10406', 'PC방', 62.3, { regulated: true }),
    item('S20703', '네일숍', null),
  ],
})

describe('RankCard — 이 자리 업종 순위 (13-16, 팀 C1)', () => {
  it('상위 5 + 지금 업종(7위) 자리, 규제 업종 배지, 점수·등급, 누르면 그 업종으로', () => {
    const onPick = vi.fn()
    render(<RankCard state={{ status: 'success', data: DATA }} currentBiz="R10406" onPick={onPick} />)
    const list = screen.getByRole('list', { name: '업종별 종합점수 순위' })
    const rows = within(list).getAllByRole('listitem').filter((li) => li.classList.contains('rank-item'))
    expect(rows.map((r) => within(r).getByRole('button').textContent)).toEqual([
      expect.stringContaining('1노래방규제 확인'),
      expect.stringContaining('2독서실/스터디 카페'),
      expect.stringContaining('3당구장'),
      expect.stringContaining('4카페'),
      expect.stringContaining('5치킨'),
      expect.stringContaining('7PC방지금 업종규제 확인'),
    ])
    expect(rows[0]).toHaveTextContent('72.4좋음')
    expect(rows[5]!.querySelector('button')).toBeDisabled()                       // 지금 업종은 다시 고르지 않는다
    fireEvent.click(within(rows[0]!).getByRole('button'))
    expect(onPick).toHaveBeenCalledWith('R10404')
    expect(screen.getByText(/추천이 아닙니다/)).toBeInTheDocument()
  })

  it('"전체 N개 보기"로 29개(여기선 8개) 전부, 미산출은 "산출 불가"로 맨 아래', () => {
    render(<RankCard state={{ status: 'success', data: DATA }} currentBiz="R10406" onPick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '전체 8개 보기' }))
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('rank-item'))
    expect(rows).toHaveLength(8)
    expect(rows[7]).toHaveTextContent('네일숍')
    expect(rows[7]).toHaveTextContent('산출 불가')
    expect(screen.getByRole('button', { name: '상위 5개만 보기' })).toBeInTheDocument()
  })

  it('로딩·오류 상태 문구, idle 이면 그리지 않는다', () => {
    const { rerender, container } = render(<RankCard state={{ status: 'loading' }} currentBiz="R10406" onPick={() => {}} />)
    expect(screen.getByText(/계산하는 중/)).toBeInTheDocument()                        // role=status 는 쓰지 않는다(링크 복사 안내와 겹침)
    rerender(<RankCard state={{ status: 'error', failure: { kind: 'network' } }} currentBiz="R10406" onPick={() => {}} />)
    expect(screen.getByText(/불러오지 못했습니다/)).toBeInTheDocument()
    rerender(<RankCard state={{ status: 'idle' }} currentBiz="R10406" onPick={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
