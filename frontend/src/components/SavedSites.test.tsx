import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import fixture from '../fixtures/bupyeong-pcbang-v05.json'
import { stampDataVersion } from '../lib/dataVersion.ts'
import { FIELD_NOTES_KEY, writeFieldNotes } from '../lib/fieldNotes.ts'
import { readSavedSites, SAVED_SITES_KEY, siteFrom, type SavedSite } from '../lib/savedSites.ts'
import { SavedSites } from './SavedSites.tsx'

const response = stampDataVersion(AnalyzeResponseSchema.parse(fixture), '2026-06')
const site = siteFrom({ lat: 37.4894, lng: 126.7246, biz_code: 'R10406', radius_m: 500 }, response, new Date('2026-10-29T03:00:00Z'))

beforeEach(() => window.localStorage.removeItem(FIELD_NOTES_KEY))

describe('후보 보관함 화면 (12-25)', () => {
  it('버튼에 개수, 모달에 조건·저장 당시 결과(스냅샷·데이터 묶음·엔진·저장일)·현장 확인 진행·메모·다시 분석·삭제', () => {
    writeFieldNotes(site.key, { competitors: { done: true, memo: '' } })
    const onReanalyze = vi.fn()
    const onMemo = vi.fn()
    const onRemove = vi.fn()
    render(<SavedSites sites={[{ ...site, memo: '역 앞' }]} onReanalyze={onReanalyze} onMemo={onMemo} onRemove={onRemove} />)
    const button = screen.getByRole('button', { name: '보관함 1곳' })
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: '후보 보관함' })
    expect(dialog).toHaveFocus()
    expect(dialog).toHaveTextContent('저장 당시 결과는 그때 서버의 값이고')
    const item = within(dialog).getByRole('article', { name: '부평구 부평1동 · PC방 · 반경 500m' })
    expect(item).toHaveTextContent(`저장 당시 결과${response.result.종합.점수}`)
    expect(item).toHaveTextContent('2026.10.29 저장 · 데이터 묶음 2026-06 · 엔진 mvp-0.5')
    expect(item).toHaveTextContent('같은 업종 12곳')
    expect(item).toHaveTextContent('확인 필요 · 임대료 미반영')
    expect(item).toHaveTextContent('현장 확인 1/3 확인함')
    expect(within(item).getByRole('textbox', { name: '부평구 부평1동 메모' })).toHaveValue('역 앞')
    fireEvent.change(within(item).getByRole('textbox', { name: '부평구 부평1동 메모' }), { target: { value: '역 앞 2층' } })
    expect(onMemo).toHaveBeenCalledWith(site.id, '역 앞 2층')
    fireEvent.click(within(item).getByRole('button', { name: '삭제' }))
    expect(onRemove).toHaveBeenCalledWith(site.id)
    fireEvent.click(within(item).getByRole('button', { name: '같은 조건으로 다시 분석' }))
    expect(onReanalyze).toHaveBeenCalledWith(expect.objectContaining({ id: site.id }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()     // 다시 분석하면 닫힌다
    expect(button).toHaveFocus()
  })

  it('R1 카드(13-21): 등급·규제 배지·저장 당시 한 줄 결론·업종 순위 요약 — 예전 항목은 새 줄 없이 그대로', () => {
    const withCards = {
      ...site,
      snapshot: { ...site.snapshot, overall: 70.2, regulated: true, conclusion: '고객성이 특히 좋은 자리예요(주요 손님층 거주).', rank: { top: [{ name: '노래방', overall: 78.3 }, { name: '세탁소', overall: 77.9 }, { name: '당구장', overall: 76.7 }], current: 6, count: 29 } },
    }
    render(<SavedSites sites={[withCards]} onReanalyze={() => {}} onMemo={() => {}} onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '보관함 1곳' }))
    const item = within(screen.getByRole('dialog', { name: '후보 보관함' })).getByRole('article')
    expect(item).toHaveTextContent('70.2좋음규제 확인 필요')
    expect(item).toHaveTextContent('고객성이 특히 좋은 자리예요(주요 손님층 거주).')
    expect(item).toHaveTextContent('점수가 높은 업종 · 노래방 78.3 · 세탁소 77.9 · 당구장 76.7 · 이 업종은 29개 중 6번째')
    cleanup()
    const oldSnap: SavedSite['snapshot'] = { ...withCards.snapshot }
    delete oldSnap.conclusion
    delete oldSnap.regulated
    delete oldSnap.rank
    render(<SavedSites sites={[{ ...withCards, snapshot: oldSnap }]} onReanalyze={() => {}} onMemo={() => {}} onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '보관함 1곳' }))
    const old = within(screen.getByRole('dialog', { name: '후보 보관함' })).getByRole('article')
    expect(old).toHaveTextContent('70.2좋음')
    expect(old).not.toHaveTextContent('규제 확인 필요')
    expect(old).not.toHaveTextContent('점수가 높은 업종')
  })

  it('손상 항목이 저장소에 섞여 있어도 readSavedSites 가 거르므로 모달은 정상 항목만 그린다 — 렌더 예외 없음 (12-28-R4)', () => {
    window.localStorage.setItem(
      SAVED_SITES_KEY,
      JSON.stringify([{ ...site, id: 'broken', snapshot: { locationName: '부평구 부평1동', perspectives: [null], gaps: [] } }, site]),
    )
    render(<SavedSites sites={readSavedSites()} onReanalyze={() => {}} onMemo={() => {}} onRemove={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '보관함 1곳' }))
    expect(within(screen.getByRole('dialog')).getAllByRole('article')).toHaveLength(1)
    window.localStorage.removeItem(SAVED_SITES_KEY)
  })

  it('비어 있으면 안내, Escape 로 닫고 버튼으로 포커스가 돌아온다', () => {
    render(<SavedSites sites={[]} onReanalyze={() => {}} onMemo={() => {}} onRemove={() => {}} />)
    const button = screen.getByRole('button', { name: '보관함 0곳' })
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: '후보 보관함' })
    expect(dialog).toHaveTextContent('아직 보관한 후보가 없습니다')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })
})
