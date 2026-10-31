import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { PROFILE_KEY, readProfile } from '../lib/profile.ts'
import { AskDialog } from './AskDialog.tsx'

const TARGET = { lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 500, title: '부평구 부평1동 · PC방' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const answer = (text: string, extra: object = {}) => ({
  engine_version: 'mvp-0.5.1',
  model: 'claude-sonnet-5-5',
  answer: text,
  fields: [],
  out_of_scope: false,
  profile_suggestion: null,
  ...extra,
})
const bodies = (m: Mock) => m.mock.calls.map((c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string))

describe('AskDialog — AI 자유 질문 (R2 13-24·13-26)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.removeItem(PROFILE_KEY)
  })

  it('추천 질문 칩 → 질문·답변, 보내는 값은 조건(좌표·업종·반경)과 질문뿐, 고지 문구', async () => {
    const fetchMock = vi.fn(async () => json(200, answer('경쟁성은 31.9점이에요.')))
    vi.stubGlobal('fetch', fetchMock)
    render(<AskDialog target={TARGET} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: '이 분석에 대해 질문하기' })
    expect(dialog).toHaveTextContent('30일 보관')
    expect(dialog).toHaveTextContent('위치 좌표·IP는 남기지 않습니다')
    fireEvent.click(within(screen.getByRole('group', { name: '추천 질문' })).getByRole('button', { name: '왜 이 점수가 나왔나요?' }))
    expect(await screen.findByText('경쟁성은 31.9점이에요.')).toBeInTheDocument()
    expect(bodies(fetchMock)[0]).toEqual({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 500, question: '왜 이 점수가 나왔나요?', history: [], profile: null })
  })

  it('지난 대화는 최근 6턴만 보낸다', async () => {
    let n = 0
    const fetchMock = vi.fn(async () => json(200, answer(`답${++n}`)))
    vi.stubGlobal('fetch', fetchMock)
    render(<AskDialog target={TARGET} onClose={() => {}} />)
    const input = screen.getByLabelText('질문')
    for (let i = 1; i <= 5; i++) {
      fireEvent.change(input, { target: { value: `질문${i}` } })
      fireEvent.click(screen.getByRole('button', { name: '질문하기' }))
      await screen.findByText(`답${i}`)
    }
    const last = bodies(fetchMock).at(-1)
    expect(last.history).toHaveLength(6)
    expect(last.history[0]).toEqual({ role: 'user', content: '질문2' })
    expect(last.question).toBe('질문5')
  })

  it('AI 가 알아낸 프로필은 "저장"을 눌러야 저장되고, 다음 질문부터 함께 보낸다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, answer('예비 창업자시군요.', { profile_suggestion: { stage: '예비', youth: true, preferred: null } })))
      .mockResolvedValueOnce(json(200, answer('네.')))
    vi.stubGlobal('fetch', fetchMock)
    render(<AskDialog target={TARGET} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('질문'), { target: { value: '저는 30살 예비 창업자예요' } })
    fireEvent.click(screen.getByRole('button', { name: '질문하기' }))
    await screen.findByText(/창업 단계 예비 · 청년\(39세 이하\)/)
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(readProfile()).toEqual({ stage: '예비', youth: true, preferred: [] })
    fireEvent.change(screen.getByLabelText('질문'), { target: { value: '다음 질문' } })
    fireEvent.click(screen.getByRole('button', { name: '질문하기' }))
    await screen.findByText('네.')
    expect(bodies(fetchMock)[1].profile).toEqual({ stage: '예비', youth: true, preferred: null })
  })

  it('하루 한도 오류는 코드별 문구, Escape 로 닫는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(429, { error: { code: 'ai_limited', message: '서버 문구' } })))
    const onClose = vi.fn()
    render(<AskDialog target={TARGET} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('질문'), { target: { value: '?' } })
    fireEvent.click(screen.getByRole('button', { name: '질문하기' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('오늘 이 기기에서 쓸 수 있는 AI 횟수를 다 썼어요'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
