import { fireEvent, render, screen, within } from '@testing-library/react'
import { APP_VERSION, RELEASES } from '../lib/patchNotes.ts'
import { UpdateNotes } from './UpdateNotes.tsx'

const openButton = () => screen.getByRole('button', { name: '업데이트 내역' })
/** 항목(article)을 버전 표시로 찾는다 */
const articleOf = (dialog: HTMLElement, v: string) =>
  [...dialog.querySelectorAll('article')].find((a) => a.querySelector('.updates__version')?.textContent === v)!

function open() {
  render(
    <>
      <button type="button">앞 버튼</button>
      <UpdateNotes />
    </>,
  )
  openButton().focus()
  fireEvent.click(openButton())
  return screen.getByRole('dialog', { name: '업데이트 내역' })
}

describe('업데이트 내역 (D-031)', () => {
  it('버튼은 대화상자를 연다는 것을 알리고, 열면 모달 대화상자로 포커스가 옮겨진다', () => {
    render(<UpdateNotes />)
    expect(openButton()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(openButton()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(openButton())
    const dialog = screen.getByRole('dialog', { name: '업데이트 내역' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    expect(openButton()).toHaveAttribute('aria-expanded', 'true')
  })

  it('지금 보고 있는 빌드의 앱 버전과 재부여 안내를 보여 준다', () => {
    const dialog = open()
    expect(within(dialog).getByText(APP_VERSION, { selector: 'strong' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('기존 변경 이력을 정리하며 부여한 앱 버전')
    expect(dialog).toHaveTextContent('점수 엔진 버전과 따로')
  })

  it('최신순으로 모든 버전을 보여 주고, 항목마다 버전·날짜·제목·종류 표시가 있다', () => {
    const dialog = open()
    const heads = within(dialog).getAllByRole('heading', { level: 3 })
    expect(heads.map((h) => h.querySelector('.updates__version')?.textContent)).toEqual(RELEASES.map((r) => r.version))
    const v006 = articleOf(dialog, 'v0.0.6')
    expect(v006).toHaveTextContent('v0.0.6 · 2026.10.19')
    expect(v006).toHaveTextContent('테마 전환과 지도 경계')
    expect(v006).toHaveTextContent('추가밝은 화면과 어두운 화면을 선택할 수 있습니다.')
    expect(v006).toHaveTextContent('개선인천 외곽선과 구 경계를 지도에서 확인할 수 있습니다.')
    expect(articleOf(dialog, 'v0.0.1')).toHaveTextContent('v0.0.1 · 2026.10.05~10.08')
  })

  it('운영 반영은 운영 전환 기록으로 계산하고, 무트래픽 검증 기록은 상세 보기에 따로 남는다', () => {
    const dialog = open()
    const article = (v: string) => articleOf(dialog, v)
    expect(article('v0.0.1')).toHaveTextContent('운영 반영 2026.10.08')
    expect(article('v0.0.2')).toHaveTextContent('운영 반영 2026.10.13 · v0.0.4 배포에 포함')
    expect(article('v0.0.5')).toHaveTextContent('운영 반영 2026.10.19')
    // 2026-10-25 운영 전환(v0.0.11): 그 전 버전은 함께 반영, 무트래픽 검증만 있던 v0.0.9·v0.0.10도 이 전환으로 반영
    expect(article('v0.0.6')).toHaveTextContent('운영 반영 2026.10.25 · v0.0.11 배포에 포함')
    expect(article('v0.0.10')).toHaveTextContent('운영 반영 2026.10.25 · v0.0.11 배포에 포함')
    expect(article('v0.0.11')).toHaveTextContent('운영 반영 2026.10.25')
    expect(article('v0.0.11')).not.toHaveTextContent('배포에 포함')
    // 배포 기록은 추가만 하므로 이미 기록된 운영 반영일은 바뀌지 않는다 — "아직 없음"처럼 다음 전환 때 깨지는 단언은 두지 않는다
    expect(article('v0.0.12')).toHaveTextContent('운영 반영 2026.10.28')
    expect(article('v0.0.12')).not.toHaveTextContent('배포에 포함')
    // 상세 보기: 무트래픽 검증 기록과 커밋 해시(검증 기록은 운영 반영과 따로 남는다)
    const v0010 = article('v0.0.10')
    expect(v0010).toHaveTextContent('2026.10.25 무트래픽 검증 통과')
    expect(within(v0010).getByText('276157e', { selector: '.updates__commits code' })).toBeInTheDocument()
  })

  it('사용자 요약에는 커밋 해시가 없고, 해시는 "자세히" 안에만 있다', () => {
    const dialog = open()
    for (const list of dialog.querySelectorAll('.updates__changes')) expect(list.textContent).not.toMatch(/\b[0-9a-f]{7}\b/)
    for (const code of dialog.querySelectorAll('code')) expect(code.closest('details')).not.toBeNull()
  })

  it('Escape로 닫으면 연 버튼으로 포커스가 돌아온다', () => {
    const dialog = open()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
    expect(openButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('닫기 버튼·배경 클릭으로도 닫히고 포커스가 돌아온다. 대화상자 안을 누르면 닫히지 않는다', () => {
    let dialog = open()
    fireEvent.mouseDown(dialog)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '업데이트 내역 닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()

    fireEvent.click(openButton())
    dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(dialog.parentElement!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
  })

  it('Tab은 대화상자 안에서만 돈다(닫힌 "자세히" 안은 건너뛴다)', () => {
    const dialog = open()
    const close = within(dialog).getByRole('button', { name: '업데이트 내역 닫기' })
    const summaries = dialog.querySelectorAll('summary')
    const last = summaries[summaries.length - 1] as HTMLElement
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    // 열린 "자세히"의 마지막 항목 뒤에서도 처음으로 돈다
    ;(last.parentElement as HTMLDetailsElement).open = true
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(close).toHaveFocus()
  })

  it('대화상자 안의 Escape는 바깥(문서) Escape 처리로 번지지 않는다', () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    const dialog = open()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    document.removeEventListener('keydown', outer)
    expect(outer).not.toHaveBeenCalled()
  })
})
