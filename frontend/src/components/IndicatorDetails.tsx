import { useId, useLayoutEffect, useState } from 'react'
import type { EngineResult } from '../api/schemas.ts'
import { calcUnitLabel, flagItems } from '../lib/flags.ts'
import { decimal, percent } from '../lib/evidence.ts'
import { confidenceLabel, formatRadius, formatRatio, formatScore, notComputedText, type Indicator } from '../lib/format.ts'
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
  openRequest,
}: {
  indicators: readonly Indicator[]
  summary: EngineResult['종합']
  meta: EngineResult['meta']
  /** 요약 탭의 관점 행을 누르면(A3): 그 관점을 펼치고 그 토글로 포커스 — n이 바뀔 때마다 */
  openRequest?: { key: string; n: number } | null
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  // 요청을 받으면 그 관점을 펼친다(렌더 중 상태 조정). 포커스는 펼친 뒤 layout effect에서
  const [seenRequest, setSeenRequest] = useState(openRequest)
  if (openRequest && openRequest !== seenRequest) {
    setSeenRequest(openRequest)
    if (!open.has(openRequest.key)) setOpen(new Set(open).add(openRequest.key))
  }
  useLayoutEffect(() => {
    if (!openRequest) return
    const toggle = document.getElementById(`detail-toggle-${openRequest.key}`)
    toggle?.scrollIntoView?.({ block: 'start' })
    toggle?.focus({ preventScroll: true })
  }, [openRequest])
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
            radiusM={meta.분석반경_m}
            engineVersion={meta.엔진버전}
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
  radiusM,
  engineVersion,
  open,
  onToggle,
}: {
  indicator: Indicator
  summary: EngineResult['종합']
  radiusM: number
  engineVersion: string
  open: boolean
  onToggle: () => void
}) {
  const panelId = useId()

  return (
    <div className={`detail persp-${ind.key}`}>
      <h3 className="detail__heading">
        <button
          id={`detail-toggle-${ind.key}`}
          type="button"
          className="detail__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
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
            <Chip tone={ind.confidence === 'low' ? 'warning' : 'neutral'}>자료 등급 {confidenceLabel(ind.confidence)}</Chip>
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
              <dd>{calcUnitLabel(ind, radiusM)}</dd>
            </div>
          </dl>
          <PerspectiveGuide indicator={ind} summary={summary} engineVersion={engineVersion} />
          <BreakdownTable indicator={ind} />
          <CalcBasis indicator={ind} radiusM={radiusM} />
          <FlagList indicator={ind} />
          <RawData raw={ind.raw} fallback={ind.fallback} flags={ind.flags} />
        </div>
      )}
    </div>
  )
}

/**
 * 계산 기준 (엔진 v0.5, D-028): raw 의 v0.5 항목을 화면 말로 — 값은 엔진 그대로, 재계산·순위 표현 없음.
 * v0.3·v0.4 응답에는 이 항목들이 없어 아무것도 그리지 않는다.
 */
function CalcBasis({ indicator: ind, radiusM }: { indicator: Indicator; radiusM: number }) {
  const items: string[] = []
  if (ind.key === 'customer' && ind.raw.인구_기준 !== undefined) {
    items.push(
      ind.raw.인구_기준.startsWith('반경')
        ? `인구 기준: 반경 ${formatRadius(radiusM)} 안 인구를 행정동 경계 면적 비율로 나눈 값(타겟 연령 인구·종사자). 1인 세대 비중은 행정동 값`
        : `인구 기준: ${ind.raw.인구_기준}`,
    )
    const solo = ind.raw['1인가구_민감도']
    if (solo !== undefined && solo < 0) items.push(`1인 세대가 많을수록 불리한 업종으로 계산합니다(민감도 ${solo}).`)
  }
  if (ind.key === 'competition' && '동종점포수_실효(대체업종_포함)' in ind.raw) {
    const raw = ind.raw
    const eff = raw['동종점포수_실효(대체업종_포함)']
    if (eff !== undefined) {
      items.push(
        `같은 업종(정확 일치) ${raw.동종점포수.toLocaleString('ko-KR')}곳 — 지도 점포 목록과 같은 수` +
          (eff !== raw.동종점포수 ? ` · 비슷한 업종을 계수만큼 더한 실효 동종 수 약 ${decimal(eff)}곳(점수 계산용)` : ''),
      )
    }
    if (raw.잠재수요_구성 && Object.hasOwn(raw.잠재수요_구성, '종사자수')) {
      items.push('잠재수요: 반경 안 거주인구 + 종사자(행정동 경계 면적 배분). 외부 방문객은 들어 있지 않습니다.')
    }
    if (raw.업종_집적유형 !== undefined) {
      items.push(
        raw.상권_집적도_백분위 != null
          ? `업종 집적 유형: ${raw.업종_집적유형} · 상권 집적도(반경 안 전체 점포 수의 백분위) ${formatScore(raw.상권_집적도_백분위)} — 점포가 모인 정도이며 상권 우수성·성공 가능성 순위가 아닙니다.`
          : `업종 집적 유형: ${raw.업종_집적유형}(집적도 가점 없음)`,
      )
    }
  }
  if (ind.key === 'location' && ind.raw.역_의존도 !== undefined) {
    items.push(`역 의존도 ${ind.raw.역_의존도} — 역 근접 비중을 이만큼만 두고 나머지는 유인시설 근접도로 넘깁니다.`)
    const excluded = ind.raw.학교구역_제외_학교수
    if (excluded != null && excluded > 0) items.push(`학교 200m 안 초·중·고 ${excluded}곳은 유인시설 가점에서 뺐습니다(학교 주변 영업 규제 업종).`)
  }
  if (ind.key === 'stability') {
    // raw.인천_업종평균_3년생존율 = 엔진 고정 기준선(C_BASELINE_SURVIVAL_3Y, 업종 무관). 점수 입력이 아니라 raw 설명용 값이다 (12-16)
    if (ind.raw['3년_생존율'] !== null) {
      items.push(
        `참고 기준선 ${percent(ind.raw.인천_업종평균_3년생존율)}: 인천시 소상공인통계(2021년 기준)의 3년 생존율로, ` +
          '업종 구분이 없어 이 업종의 인천 평균이 아닙니다. 점수 계산에는 쓰지 않습니다.',
      )
    }
    if (ind.raw.임대료_해석) items.push(`임대료: ${ind.raw.임대료_해석}`)
  }
  if (items.length === 0) return null
  return (
    <div className="detail__flags">
      <h4 className="detail__flags-label">계산 기준</h4>
      <ul className="detail__flags-list">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

/** 특이사항 (8-C1d, UX_REDESIGN 2.4): 엔진 flag를 한글 라벨 + 한 줄 설명으로. 해상도 flag는 빼고, 모르는 flag는 원문 그대로 */
function FlagList({ indicator: ind }: { indicator: Indicator }) {
  const items = flagItems(ind)
  if (items.length === 0) return null
  return (
    <div className="detail__flags">
      <h4 className="detail__flags-label">특이사항</h4>
      <ul className="detail__flags-list">
        {items.map((item) =>
          item.kind === 'known' ? (
            <li key={item.flag}>
              <strong>{item.text.label}</strong>
              <span className="detail__flags-note"> — {item.text.note}</span>
            </li>
          ) : (
            <li key={item.flag}>
              <span className="mono">{item.flag}</span>
            </li>
          ),
        )}
      </ul>
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

/**
 * Raw Data Disclosure "원시값 보기" (§8.10). 첫 화면에서는 보이지 않는다.
 * 엔진 원문을 그대로 둔다 — raw 값과 함께 계산 단위(fallback)·flags 원문(8-C1d: 위에서는 한글로 보인다)
 */
function RawData({ raw, fallback, flags }: { raw: Indicator['raw']; fallback: string; flags: readonly string[] }) {
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
              <tr>
                <th scope="row">fallback</th>
                <td className="mono">{fallback}</td>
              </tr>
              <tr>
                <th scope="row">flags</th>
                <td className="mono">{flags.length === 0 ? '없음' : flags.join(', ')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
