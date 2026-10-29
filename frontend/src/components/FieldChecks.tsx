import { useId } from 'react'
import type { FieldCheck } from '../content/fieldChecks.ts'
import type { FieldNote, FieldNotes } from '../lib/fieldNotes.ts'
import { Icon } from './Icon.tsx'
import './FieldChecks.css'

/**
 * 현장 확인 카드 (계획 1-4, 12-27): 결과 패널 "현장 확인" 탭. 카드 3장 = 제목 · 근거(엔진 값 인용) · 기록할 것 3줄 · "확인함" 체크 · 메모.
 * 체크·메모는 조건 키마다 이 브라우저에 저장된다(lib/fieldNotes, App 이 넘긴다). notes 를 넘기지 않으면 체크·메모 없이 카드만.
 * 카드는 결과가 보지 못한 것을 확인하라는 안내일 뿐, 점수·순위·성공 가능성을 말하지 않는다.
 */
export function FieldChecks({
  checks,
  notes,
  onChange,
}: {
  checks: readonly FieldCheck[]
  notes?: FieldNotes
  onChange?: (id: string, note: FieldNote) => void
}) {
  const idBase = useId()
  const editable = notes !== undefined && onChange !== undefined
  return (
    <section className="field-checks" aria-labelledby="field-checks-title">
      <h2 id="field-checks-title" className="result-section__title">
        현장에서 확인할 것
      </h2>
      <p className="field-checks__lead">
        이 결과가 보지 못한 것을 현장에서 확인하는 순서입니다. 기록은 이 브라우저에만 저장되며 서버로 보내지 않습니다.
      </p>
      <ol className="field-checks__list">
        {checks.map((c, i) => {
          const note = notes?.[c.id] ?? { done: false, memo: '' }
          const checkId = `${idBase}-${c.id}-done`
          const memoId = `${idBase}-${c.id}-memo`
          return (
            <li key={c.id} className={`field-check${note.done ? ' field-check--done' : ''}`}>
              <article aria-labelledby={`${idBase}-${c.id}-title`}>
                <h3 id={`${idBase}-${c.id}-title`} className="field-check__title">
                  <span className="field-check__index" aria-hidden="true">
                    {i + 1}
                  </span>
                  {c.title}
                </h3>
                <p className="field-check__because">
                  <Icon name="info" size={14} />
                  <span>{c.because}</span>
                </p>
                <ul className="field-check__record" aria-label={`${c.title} — 기록할 것`}>
                  {c.record.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {editable && (
                  <div className="field-check__notes">
                    <label className="field-check__done" htmlFor={checkId}>
                      <input
                        id={checkId}
                        type="checkbox"
                        checked={note.done}
                        onChange={(e) => onChange(c.id, { ...note, done: e.target.checked })}
                      />
                      확인함
                    </label>
                    <label className="visually-hidden" htmlFor={memoId}>
                      {c.title} 메모
                    </label>
                    <textarea
                      id={memoId}
                      className="input field-check__memo"
                      rows={2}
                      placeholder="현장에서 본 것, 들은 것"
                      value={note.memo}
                      onChange={(e) => onChange(c.id, { ...note, memo: e.target.value })}
                    />
                  </div>
                )}
              </article>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
