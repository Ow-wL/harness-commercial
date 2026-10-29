import { PERSPECTIVE_KEYS } from '../api/schemas.ts'
import { formatRadius, formatScore } from '../lib/format.ts'
import { overallRange, rowCells, type RadiusRow } from '../lib/radiusTable.ts'
import './RadiusTable.css'

const PERSPECTIVE_LABELS = ['시장성', '고객성', '경쟁성', '입지성', '안정성'] as const

/**
 * 반경별 비교 표 (계획 1-5, 12-26, lib/radiusTable). 요약 탭 아래. 분석하지 않은 반경은 "분석하기"로 채운다(그 반경으로 전환·다시 분석).
 * 점수는 엔진 값 그대로이며 반경 사이의 차이는 자료 범위가 달라진 결과일 뿐 어느 반경이 맞다는 뜻이 아니다.
 */
export function RadiusTable({ rows, busy, onAnalyze }: { rows: readonly RadiusRow[]; busy: boolean; onAnalyze: (radius: number) => void }) {
  if (rows.length < 2) return null
  const range = overallRange(rows)
  const score = (v: number | null) => (v === null ? <span className="radius-table__none">미산출</span> : formatScore(v))
  return (
    <section className="radius-table" aria-labelledby="radius-table-title">
      <h2 id="radius-table-title" className="result-section__title">
        반경별 비교
      </h2>
      <p className="radius-table__lead">
        이미 분석한 반경만 채웁니다. 반경이 넓어지면 점포·인구 자료의 범위가 함께 달라집니다 — 어느 반경이 맞다는 뜻은 아닙니다.
      </p>
      <div className="radius-table__scroll">
        <table className="radius-table__table">
          <caption className="visually-hidden">반경별 종합·관점 점수, 같은 업종 점포 수, 확인 필요 항목 수</caption>
          <thead>
            <tr>
              <th scope="col">반경</th>
              <th scope="col">종합</th>
              {PERSPECTIVE_LABELS.map((label, i) => (
                <th key={PERSPECTIVE_KEYS[i]} scope="col">
                  {label}
                </th>
              ))}
              <th scope="col">같은 업종</th>
              <th scope="col">확인 필요</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cells = row.response ? rowCells(row.response) : null
              return (
                <tr key={row.radius} className={row.current ? 'radius-table__row--current' : undefined} aria-current={row.current ? 'true' : undefined}>
                  <th scope="row">
                    {formatRadius(row.radius)}
                    {row.current && <span className="radius-table__now"> · 지금</span>}
                  </th>
                  {cells ? (
                    <>
                      <td className="radius-table__overall">{score(cells.overall)}</td>
                      {cells.perspectives.map((v, i) => (
                        <td key={PERSPECTIVE_KEYS[i]}>{score(v)}</td>
                      ))}
                      <td>{cells.stores.toLocaleString('ko-KR')}곳</td>
                      <td>{cells.gaps}개</td>
                    </>
                  ) : (
                    <td colSpan={8} className="radius-table__empty">
                      <button type="button" className="button-ghost button-ghost--small" disabled={busy} onClick={() => onAnalyze(row.radius)}>
                        {formatRadius(row.radius)} 분석하기
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {range && (
        <p className="radius-table__range">
          분석한 반경 {range.count}개의 종합 점수 범위 {formatScore(range.min)}~{formatScore(range.max)} — 반경에 따른 차이일 뿐,
          오차범위나 신뢰구간이 아닙니다.
        </p>
      )}
    </section>
  )
}
