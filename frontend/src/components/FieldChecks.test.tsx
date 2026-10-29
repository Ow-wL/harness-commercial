import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import { fieldChecks } from '../content/fieldChecks.ts'
import fixture from '../fixtures/bupyeong-pcbang-v05.json'
import { FieldChecks } from './FieldChecks.tsx'

const checks = fieldChecks(AnalyzeResponseSchema.parse(fixture))

describe('현장 확인 카드 화면 (12-27)', () => {
  it('카드 3장: 번호·제목·근거·기록할 것 3줄, 확인함 체크와 메모가 조건 기록으로 올라간다', () => {
    const onChange = vi.fn()
    render(<FieldChecks checks={checks} notes={{ rent: { done: true, memo: '월세 150' } }} onChange={onChange} />)
    expect(document.querySelectorAll('.field-check')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 3, name: '가까운 같은 업종 점포 둘러보기' })).toBeInTheDocument()   // 번호는 aria-hidden
    expect(screen.getByText('반경 500m 안 PC방 12곳 · 점포당 잠재수요(거주+종사자) 1,925명 — 점포 목록은 주변 점포 탭')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '후보 점포의 임대 조건 확인 — 기록할 것' })).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('이 위치에는 임대료 조사 상권이 연결되지 않아 임대료를 점수에 반영하지 않았습니다')).toBeInTheDocument()
    // 저장된 기록이 보인다
    const rentDone = screen.getByRole('checkbox', { name: '확인함', checked: true })
    expect(rentDone.closest('.field-check')).toHaveClass('field-check--done')
    expect(screen.getByRole('textbox', { name: '후보 점포의 임대 조건 확인 메모' })).toHaveValue('월세 150')
    // 인쇄용 메모 전문(12-28-R5): 메모가 있는 카드에만, 값 그대로(줄바꿈 보존은 print.css pre-wrap). 빈 메모 카드에는 없다
    const prints = document.querySelectorAll('.field-check__memo-print')
    expect(prints).toHaveLength(1)
    expect(prints[0]).toHaveTextContent('월세 150')
    expect(prints[0]!.closest('.field-check')).toBe(screen.getByRole('textbox', { name: '후보 점포의 임대 조건 확인 메모' }).closest('.field-check'))
    // 체크·메모 변경
    fireEvent.click(screen.getAllByRole('checkbox', { name: '확인함' })[0]!)
    expect(onChange).toHaveBeenCalledWith('competitors', { done: true, memo: '' })
    fireEvent.change(screen.getByRole('textbox', { name: '실제 유동 인구 관찰 메모' }), { target: { value: '점심 30명' } })
    expect(onChange).toHaveBeenCalledWith('market-gu', { done: false, memo: '점심 30명' })
  })

  it('기록을 넘기지 않으면 체크·메모 없이 카드만 보인다 (비교 전체 결과 등)', () => {
    render(<FieldChecks checks={checks} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('서버로 보내지 않습니다', { exact: false })).toBeInTheDocument()
  })
})
