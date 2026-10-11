import { useId, useState } from 'react'
import type { EngineResult } from '../api/schemas.ts'
import { confidenceLabel, formatRatio, formatScore, notComputedText, type Indicator } from '../lib/format.ts'
import { Chip } from './Chip.tsx'
import { Icon } from './Icon.tsx'
import { PerspectiveGuide, ScoreReadingGuide } from './ScoreGuide.tsx'
import './IndicatorDetails.css'

/**
 * "왜 이런 점수가 나왔나" — 관점별 아코디언 (DESIGN.md §7.8, §8.9, §8.10, §9 L2·L3).
 * 기본은 모두 접힘. 여러 개를 동시에 펼칠 수 있고 "모두 펼치기"가 있다.
 * 섹션 맨 위 "점수 읽는 법"(접힘, §8.9b). 펼친 내용: note → 계산 메타 → 관점 설명(2차 disclosure, §8.9a)
 * → breakdown 표 → flags → 원시값(2차 disclosure). "모두 펼치기"는 관점 아코디언만 연다(설명은 각자 접힘 유지).
 * 차트(§8.9 표)는 그 데이터가 현재 API에 없어 그리지 않는다.
 */

/**
 * 안정성 note는 엔진이 폴백 레벨만 보고 "표본이 부족해 … 단위로 계산했습니다"라고 쓴다(scoring.score_stability).
 * 관점 점수가 null이면 실제로 계산된 값이 없으므로 이 note 대신 score·coverage로 만든 안내를 보인다
 * (docs/SCORE_EXPLANATION_AUDIT.md 4장). 엔진 원문은 API 응답에 그대로 있다.
 */
function showsEngineNote(ind: Indicator): boolean {
  return ind.note !== '' && !(ind.key === 'stability' && ind.score === null)
}
export function IndicatorDetails({
  indicators,
  summary,
  meta,
}: {
  indicators: readonly Indicator[]
  summary: EngineResult['종합']
  meta: EngineResult['meta']
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const allOpen = open.size === indicators.length

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <section className="result-section" aria-labelledby="details-title">
      <div className="result-section__head">
        <h2 id="details-title" className="result-section__title">
          왜 이런 점수가 나왔나
        </h2>
        <button
          type="button"
          className="button-ghost"
          onClick={() => setOpen(allOpen ? new Set() : new Set(indicators.map((i) => i.key)))}
        >
          {allOpen ? '모두 접기' : '모두 펼치기'}
        </button>
      </div>
      <ScoreReadingGuide summary={summary} meta={meta} indicators={indicators} />
      <div className="details">
        {indicators.map((ind) => (
          <IndicatorAccordion
            key={ind.key}
            indicator={ind}
            summary={summary}
            open={open.has(ind.key)}
            onToggle={() => toggle(ind.key)}
          />
        ))}
      </div>
    </section>
  )
}

function IndicatorAccordion({
  indicator: ind,
  summary,
  open,
  onToggle,
}: {
  indicator: Indicator
  summary: EngineResult['종합']
  open: boolean
  onToggle: () => void
}) {
  const panelId = useId()

  return (
    <div className={`detail persp-${ind.key}`}>
      <h3 className="detail__heading">
        <button type="button" className="detail__toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <span className="chevron" data-open={open}>
            <Icon name="chevron-right" />
          </span>
          <span className="detail__label">{ind.label}</span>
          <span className="detail__summary">
            {ind.score === null ? (
              <span className="detail__missing">데이터 없음</span>
            ) : (
              <span className="detail__score">{formatScore(ind.score)}</span>
            )}
            <Chip tone={ind.confidence === 'low' ? 'warning' : 'neutral'}>신뢰도 {confidenceLabel(ind.confidence)}</Chip>
          </span>
        </button>
      </h3>
      {open && (
        <div id={panelId} className="detail__panel">
          {ind.score === null && <p className="detail__note">{notComputedText(ind)}</p>}
          {showsEngineNote(ind) && <p className="detail__note">{ind.note}</p>}
          <dl className="detail__meta">
            <div>
              <dt>세부지표 충족률</dt>
              <dd>{formatRatio(ind.coverage)}</dd>
            </div>
            <div>
              <dt>계산 단위</dt>
              {ind.score === null ? <dd>산출하지 않음</dd> : <dd className="mono">{ind.fallback}</dd>}
            </div>
          </dl>
          <PerspectiveGuide indicator={ind} summary={summary} />
          <BreakdownTable indicator={ind} />
          {ind.flags.length > 0 && (
            <div className="detail__flags">
              <span className="detail__flags-label">flags</span>
              {ind.flags.map((f) => (
                <Chip key={f}>{f}</Chip>
              ))}
            </div>
          )}
          <RawData raw={ind.raw} />
        </div>
      )}
    </div>
  )
}

/** 세부 지표 표: 지표 / 점수 / 적용 가중치 / 기여도 / 상태 (§8.9). 제외된 행은 muted + "제외". */
function BreakdownTable({ indicator: ind }: { indicator: Indicator }) {
  if (ind.breakdown.length === 0) {
    return <p className="result-section__empty">세부 지표 계산 결과가 없습니다.</p>
  }
  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption className="visually-hidden">{ind.label} 세부 지표</caption>
        <thead>
          <tr>
            <th scope="col">지표</th>
            <th scope="col" className="num">
              점수
            </th>
            <th scope="col" className="num">
              적용 가중치
            </th>
            <th scope="col" className="num">
              기여도
            </th>
            <th scope="col">상태</th>
          </tr>
        </thead>
        <tbody>
          {ind.breakdown.map((b) => (
            <tr key={b.key} className={b.score === null ? 'is-excluded' : undefined}>
              <th scope="row">{b.label}</th>
              <td className="num">{b.score === null ? '데이터 없음' : formatScore(b.score)}</td>
              <td className="num">{b.적용_가중치}</td>
              <td className="num">{b.기여도 === null ? '제외' : formatScore(b.기여도)}</td>
              <td className="nowrap">{b.상태}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** raw 값 표시: 키·값은 엔진 그대로. null은 "데이터 없음", 객체는 "키 값" 나열. */
function rawValue(value: unknown): string {
  if (value === null || value === undefined) return '데이터 없음'
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length === 0 ? '없음' : entries.map(([k, v]) => `${k} ${rawValue(v)}`).join(', ')
  }
  return String(value)
}

/** Raw Data Disclosure "원시값 보기" (§8.10). 첫 화면에서는 보이지 않는다. */
function RawData({ raw }: { raw: Indicator['raw'] }) {
  const [open, setOpen] = useState(false)
  const rawId = useId()

  return (
    <div className="raw">
      <button
        type="button"
        className="button-ghost button-ghost--small"
        aria-expanded={open}
        aria-controls={rawId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chevron" data-open={open}>
          <Icon name="chevron-right" />
        </span>
        원시값 보기
      </button>
      {open && (
        <div id={rawId} className="raw__body">
          <table className="data-table data-table--raw">
            <caption className="visually-hidden">원시값</caption>
            <tbody>
              {Object.entries(raw).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td className={typeof v === 'number' ? 'num' : undefined}>{rawValue(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
