import { useId, useState, type ReactNode } from 'react'
import { PERSPECTIVE_KEYS, type AnalyzeResponse, type EngineResult } from '../api/schemas.ts'
import {
  displayScoreDiff,
  notComputedNotices,
  overallCompositionNotice,
  perspectiveUnit,
  radiusOverlap,
  RAW_ROWS,
  rawCell,
  rawCellText,
  sameAreaNotice,
  sharedPerspectives,
  type CompareSide,
} from '../lib/compare.ts'
import { COMPARE_IDS } from '../lib/compareState.ts'
import {
  BOTTLENECK_WARN_BELOW,
  formatDistance,
  formatRadius,
  formatRatio,
  formatScore,
  locationName,
  nearestStation,
} from '../lib/format.ts'
import { compareBand } from '../lib/attentionBand.ts'
import { dataLimits, displayWarnings } from '../lib/warnings.ts'
import { AnalysisResult } from './AnalysisResult.tsx'
import { AttentionBand } from './AttentionBand.tsx'
import { DataSources, SERVICE_DISCLAIMER } from './DataSources.tsx'
import { Icon } from './Icon.tsx'
import { TabRevealContext, useResultTabs, useTabIdBase, type TabDef } from '../lib/resultTabs.ts'
import { TabList, TabPanel } from './ResultTabs.tsx'
import './CompareResult.css'

type Indicator = EngineResult['지표'][number]
type CompareTab = 'summary' | 'stores' | 'evidence'

/**
 * 두 위치 비교 요약 (A3 compare, DESIGN.md §19.1, docs/COMPARE_DESIGN.md 5장).
 * 머리: 비교 조건 · A/B 위치 줄(종합 점수, 누르면 그 위치 전체 결과) · 두 지점 거리 · 주의 요약 띠.
 * 탭: 요약(관점별 A●·B○ 점 — 표시용 차이일 뿐 판정·순위 아님) · 주변 점포(A/B 기준) ·
 * 상세 근거(점수 비교 표 · 미산출·데이터 차이 · 주의할 점(위치별) · 핵심 원시값 · 데이터 출처 1회).
 * 엔진 값을 다시 계산하지 않는다. 고정 id 컴포넌트(WarningPanel·AnalysisResult)는 쓰지 않는다 — 같은 화면에 두 번 나오면
 * id가 겹친다(6장).
 */
export function CompareResult({
  a,
  b,
  nearby,
  onShowDetail,
  onEnd,
  onChangeConditions,
  addresses,
}: {
  a: AnalyzeResponse
  b: AnalyzeResponse
  /** 반경 안 같은 업종 점포 — 고른 기준 위치 하나 (5차-B5, App이 기준 전환과 함께 넘긴다) */
  nearby?: ReactNode
  onShowDetail: (side: CompareSide) => void
  onEnd: () => void
  onChangeConditions: () => void
  /** 위치 줄별 참고 주소 (7-B3). A 줄에는 A context 좌표, B 줄에는 B context 좌표로 App이 만든다 */
  addresses?: Partial<Record<CompareSide, ReactNode>>
}) {
  const biz = a.result.meta.업종
  const radiusM = a.result.meta.분석반경_m
  const { tab, setTab, reveal } = useResultTabs<CompareTab>('summary')
  const idBase = useTabIdBase()
  const overlap = radiusOverlap(a.context, b.context, radiusM)
  const tabs: TabDef<CompareTab>[] = [
    { key: 'summary', label: '요약' },
    { key: 'stores', label: '주변 점포' },
    { key: 'evidence', label: '상세 근거' },
  ]

  return (
    <TabRevealContext.Provider value={reveal}>
      <section className="compare" aria-labelledby={COMPARE_IDS.title}>
        <div className="result__head">
          <div className="result__eyebrow">
            <div className="compare__eyebrow-title">
              <h1 id={COMPARE_IDS.title} className="compare__title" tabIndex={-1}>
                두 위치 비교 · {biz}
              </h1>
              <span> · 같은 업종 · 반경 {formatRadius(radiusM)}</span>
            </div>
            <span className="result__eyebrow-actions">
              <button type="button" className="link-button" onClick={onChangeConditions}>
                조건 바꾸기
              </button>
              <button type="button" className="link-button" onClick={onEnd}>
                비교 종료
              </button>
            </span>
          </div>
          <div className="compare__sites">
            <SiteRow side="A" analysis={a} address={addresses?.A} onShowDetail={onShowDetail} />
            <SiteRow side="B" analysis={b} address={addresses?.B} onShowDetail={onShowDetail} />
          </div>
          <p className="compare__distance">
            두 지점 직선거리 {overlap.distanceM.toLocaleString('ko-KR')}m ·{' '}
            {overlap.overlaps ? '분석 반경이 겹침' : '분석 반경 겹침 없음'}
          </p>
          <AttentionBand lines={compareBand(a, b)} moreTarget="compare-warnings" />
        </div>
        <TabList label="비교 보기" tabs={tabs} selected={tab} onSelect={setTab} idBase={idBase} />
        <div className="result__body">
          <TabPanel tab="summary" selected={tab} idBase={idBase}>
            <CompareRows a={a} b={b} onOpen={() => reveal(COMPARE_IDS.scoreTitle)} />
            <p className="result__hint">
              <span className="compare__legend-a" aria-hidden="true" /> A{' '}
              <span className="compare__legend-b" aria-hidden="true" /> B · 두 점 사이 거리는 표시용 차이일 뿐, 어느
              위치가 낫다는 판정이나 순위가 아닙니다.
            </p>
            <p className="result__disclaimer">{SERVICE_DISCLAIMER}</p>
          </TabPanel>
          <TabPanel tab="stores" selected={tab} idBase={idBase}>
            {nearby ?? <p className="result-section__empty">점포 목록이 없습니다.</p>}
          </TabPanel>
          <TabPanel tab="evidence" selected={tab} idBase={idBase}>
            <ScoreComparison a={a} b={b} />
            <NotComputed a={a} b={b} />
            <Warnings a={a} b={b} />
            <RawValues a={a} b={b} />
            {/* 같은 업종·같은 엔진이라 출처는 하나다. 화면에 한 번만 둔다(#data-sources) */}
            <DataSources meta={a.result.meta} disclaimer={a.result.면책} />
          </TabPanel>
        </div>
      </section>
    </TabRevealContext.Provider>
  )
}

const SIDE_TITLE: Record<CompareSide, string> = { A: 'A 기준 위치', B: 'B 비교 위치' }

/** 비교 머리의 위치 줄: 글자 핀 · 행정동 · 최근접역·참고 주소 · 종합 점수 · › (누르면 그 위치 전체 결과) */
function SiteRow({
  side,
  analysis,
  address,
  onShowDetail,
}: {
  side: CompareSide
  analysis: AnalyzeResponse
  address?: ReactNode
  onShowDetail: (side: CompareSide) => void
}) {
  const station = nearestStation(analysis.result.지표)
  const score = analysis.result.종합.점수
  return (
    <section className="compare__site" aria-label={SIDE_TITLE[side]}>
      <button
        type="button"
        className="compare__site-button"
        aria-label={`${SIDE_TITLE[side]} ${locationName(analysis.context)} · 종합 ${score === null ? '산출 불가' : `${formatScore(score)}점`} · 전체 결과로`}
        onClick={() => onShowDetail(side)}
      >
        <span className={`pin-letter pin-letter--${side.toLowerCase()}`} aria-hidden="true">
          {side}
        </span>
        <span className="compare__site-name">{locationName(analysis.context)}</span>
        <span className="compare__site-score">
          {score === null ? '산출 불가' : formatScore(score)}
          {score !== null && <small>/100</small>}
        </span>
        <span className="compare__site-go" aria-hidden="true">
          ›
        </span>
      </button>
      <p className="compare__site-sub">
        {station && `${station.name}까지 직선거리 ${formatDistance(station.distanceM)}`}
        {address}
      </p>
    </section>
  )
}

/** 요약 탭: 관점별 A●·B○ 점 (UX_REDESIGN 2.5 비교 점 그래프). 표시용 위치일 뿐, 표는 상세 근거 탭에 있다 */
function CompareRows({ a, b, onOpen }: { a: AnalyzeResponse; b: AnalyzeResponse; onOpen: () => void }) {
  return (
    <section className="compare-rows" aria-labelledby="compare-rows-title">
      <h2 id="compare-rows-title" className="visually-hidden">
        관점별 점수 (A·B)
      </h2>
      <p className="perspectives__scale" aria-hidden="true">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </p>
      <ul className="compare-rows__list">
        {PERSPECTIVE_KEYS.map((key) => {
          const ia = scoreOf(a.result, key)
          const ib = scoreOf(b.result, key)
          const lo = ia.score !== null && ib.score !== null ? Math.min(ia.score, ib.score) : null
          const hi = ia.score !== null && ib.score !== null ? Math.max(ia.score, ib.score) : null
          const tag = bottleneckTag('B', b.result, ib) ?? bottleneckTag('A', a.result, ia)
          return (
            <li key={key}>
              <button type="button" className="compare-row" onClick={onOpen}>
                <span className="compare-row__label">{ia.label}</span>
                <span className="compare-row__axis" aria-hidden="true">
                  <span className="compare-row__mid" />
                  {lo !== null && hi !== null && (
                    <span className="compare-row__gap" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
                  )}
                  {ib.score !== null && <span className="compare-row__b" style={{ left: `${ib.score}%` }} />}
                  {ia.score !== null && <span className="compare-row__a" style={{ left: `${ia.score}%` }} />}
                </span>
                <span className="compare-row__vals">
                  <span className="visually-hidden">A </span>
                  <b>{ia.score === null ? '미산출' : formatScore(ia.score)}</b>
                  <span aria-hidden="true"> · </span>
                  <span className="visually-hidden">, B </span>
                  <b className="compare-row__vb">{ib.score === null ? '미산출' : formatScore(ib.score)}</b>
                </span>
                {tag && <span className="compare-row__tag">{tag}</span>}
                <span className="visually-hidden"> · 점수 비교 표로</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 위치 안의 사실: 병목(25 미만)만 경고 글자로 붙인다. 두 위치를 견주는 말이 아니다 */
function bottleneckTag(side: CompareSide, r: EngineResult, ind: Indicator): string | null {
  return r.종합.병목_지표 === ind.key && ind.score !== null && ind.score < BOTTLENECK_WARN_BELOW
    ? `${side} 병목 — ${BOTTLENECK_WARN_BELOW}점 미만`
    : null
}

/**
 * 비교 요약의 점포 기준 전환 (§4.3, D4): aria-pressed 버튼 2개. 고른 위치의 목록·마커만 보인다.
 * 전환하면 점포 목록이 새로 그려지므로(펼침 상태가 섞이지 않게) App이 누른 버튼으로 포커스를 돌려준다.
 */
export function StoreSideSwitch({
  side,
  a,
  b,
  onChange,
}: {
  side: CompareSide
  a: AnalyzeResponse
  b: AnalyzeResponse
  onChange: (side: CompareSide) => void
}) {
  return (
    <div className="compare__store-switch" role="group" aria-label="점포 기준 위치">
      {(['A', 'B'] as const).map((s) => (
        <button
          key={s}
          id={s === 'A' ? COMPARE_IDS.storeSideA : COMPARE_IDS.storeSideB}
          type="button"
          className="compare__store-switch-button"
          aria-pressed={side === s}
          onClick={() => onChange(s)}
        >
          {s} {(s === 'A' ? a : b).context.dong_name}
        </button>
      ))}
    </div>
  )
}

/**
 * 위치별 전체 결과 (§3.3 detail-A / detail-B). 기존 AnalysisResult 하나를 그 위치 응답으로 띄운다 —
 * 한 번에 하나만 마운트하므로 고정 id가 겹치지 않는다(6장). 점포 목록은 그 위치의 것만 받는다(B 화면에 A 점포를 보이지 않게).
 * "비교로 돌아가기"는 패널 아래 행동(App)이다.
 */
export function CompareDetail({
  side,
  analysis,
  nearby,
  nearbyCount,
  address,
}: {
  side: CompareSide
  analysis: AnalyzeResponse
  /** 그 위치의 점포 목록 (A 전체 → A 점포, B 전체 → B 점포, 5차-B5) */
  nearby?: ReactNode
  nearbyCount?: number | null
  /** 보고 있는 위치의 참고 주소 줄 (7-B3, 그 위치 context 좌표) */
  address?: ReactNode
}) {
  // 열 때 맨 위부터 보이게 하는 스크롤 초기화와 결과 제목 포커스는 App이 한 번에 한다(6-5)
  return (
    <div className="compare-detail">
      <AnalysisResult
        analysis={analysis}
        titlePrefix={side}
        nearby={nearby}
        nearbyCount={nearbyCount}
        address={address}
        eyebrowAction={<span className="compare-detail__label">두 위치 비교 중 · {SIDE_TITLE[side]} 전체 결과</span>}
      />
    </div>
  )
}


const scoreOf = (r: EngineResult, key: string): Indicator => r.지표.find((i) => i.key === key)!

/** 위치 안의 사실(병목·가장 강한 관점)만 붙인다. 두 위치를 견주는 말이 아니다 */
function ScoreTags({ result, indicator }: { result: EngineResult; indicator: Indicator }) {
  const bottleneck = result.종합.병목_지표 === indicator.key && indicator.score !== null
  const strongest = result.종합.최고_지표 === indicator.key && indicator.score !== null
  if (!bottleneck && !strongest) return null
  const warn = bottleneck && indicator.score! < BOTTLENECK_WARN_BELOW
  return (
    <span className={`compare-table__tag${warn ? ' compare-table__tag--warn' : ''}`}>
      {bottleneck ? '병목' : '가장 강한 관점'}
    </span>
  )
}

function ScoreCell({ result, indicator }: { result: EngineResult; indicator: Indicator }) {
  return (
    <td className="num">
      {indicator.score === null ? <span className="compare-table__missing">미산출</span> : formatScore(indicator.score)}
      <ScoreTags result={result} indicator={indicator} />
    </td>
  )
}

function DiffCell({ a, b, footnoteId }: { a: number | null; b: number | null; footnoteId?: string }) {
  const diff = displayScoreDiff(a, b)
  return (
    <td className="num compare-table__diff" aria-describedby={footnoteId}>
      {diff ? (
        <>
          <span aria-hidden="true">{diff.text}</span>
          <span className="visually-hidden">{diff.spoken}</span>
        </>
      ) : (
        <>
          <span aria-hidden="true">—</span>
          <span className="visually-hidden">미산출이라 계산하지 않음</span>
        </>
      )}
      {footnoteId && (
        <span className="compare-table__mark" aria-hidden="true">
          †
        </span>
      )}
    </td>
  )
}

/** 점수 비교 표 (§5.2) + 같은 구·동·반경 겹침 안내 (§5.3) + 종합 계산 구성 각주 (§5.4) */
function ScoreComparison({ a, b }: { a: AnalyzeResponse; b: AnalyzeResponse }) {
  const titleId = COMPARE_IDS.scoreTitle                   // 주의 요약 띠의 › 대상 (8-C1a)
  const footnoteId = useId()
  const radiusM = a.result.meta.분석반경_m
  const shared = sharedPerspectives(a, b)
  const sameArea = sameAreaNotice(a, b)
  const overlap = radiusOverlap(a.context, b.context, radiusM)
  const composition = overallCompositionNotice(a.result, b.result)
  const notes = [
    sameArea,
    overlap.overlaps
      ? `두 분석 반경이 겹칩니다(A–B 직선거리 ${overlap.distanceM.toLocaleString('ko-KR')}m). 겹친 구역의 점포는 두 위치의 경쟁성에 함께 들어갑니다.`
      : null,
  ].filter((n): n is string => n !== null)

  return (
    <section className="compare__section" aria-labelledby={titleId}>
      <h2 id={titleId} className="compare__section-title">
        점수 비교
      </h2>
      {notes.length > 0 && (
        <ul className="warnings__list">
          {notes.map((text) => (
            <li key={text} className="warnings__item warnings__item--info">
              <Icon name="info" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="table-scroll">
        <table className="data-table compare-table">
          <caption className="visually-hidden">
            종합·5대 관점 점수 비교: A {locationName(a.context)}, B {locationName(b.context)}
          </caption>
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col" className="compare-table__col">
                A<span className="compare-table__sub">{a.context.dong_name}</span>
              </th>
              <th scope="col" className="compare-table__col">
                B<span className="compare-table__sub">{b.context.dong_name}</span>
              </th>
              <th scope="col" className="compare-table__col">
                표시용 차이 (A−B)
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                종합<span className="compare-table__sub">5대 관점 가중평균</span>
              </th>
              <td className="num">
                {a.result.종합.점수 === null ? <span className="compare-table__missing">미산출</span> : formatScore(a.result.종합.점수)}
              </td>
              <td className="num">
                {b.result.종합.점수 === null ? <span className="compare-table__missing">미산출</span> : formatScore(b.result.종합.점수)}
              </td>
              <DiffCell a={a.result.종합.점수} b={b.result.종합.점수} footnoteId={composition ? footnoteId : undefined} />
            </tr>
            {PERSPECTIVE_KEYS.map((key) => {
              const ia = scoreOf(a.result, key)
              const ib = scoreOf(b.result, key)
              const same = shared.find((s) => s.key === key)
              return (
                <tr key={key}>
                  <th scope="row">
                    {ia.label}
                    <span className="compare-table__sub">
                      {perspectiveUnit(key, radiusM)}
                      {same && ` · 같은 ${same.unit === '구' ? '구' : '동'} 데이터`}
                    </span>
                  </th>
                  <ScoreCell result={a.result} indicator={ia} />
                  <ScoreCell result={b.result} indicator={ib} />
                  <DiffCell a={ia.score} b={ib.score} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {composition && (
        <p id={footnoteId} className="compare__footnote">
          † {composition}
        </p>
      )}
      <p className="result-section__note">
        표시용 차이는 두 점수를 뺀 값입니다. 점수는 세부지표 백분위의 가중평균이라 이 차이는 인천 내 순위 차이나 어느
        위치가 낫다는 판정이 아닙니다. 비교 대상이 적은 세부지표(시장성 11개 구, 안정성 업종별 6~11개 구)는 작은 원시값
        차이도 백분위 차이로 크게 나타날 수 있습니다. 관점·종합 점수에 미치는 영향은 적용 가중치에 따라 달라지므로, 원시값도
        함께 확인하세요. 미산출 관점은 0점으로 보지 않고 차이를 계산하지 않습니다.
      </p>
    </section>
  )
}

/** 미산출·데이터 차이 (§5.4). 실제 미산출 관점·데이터 충족률에서 만든다. 해당이 없으면 섹션을 두지 않는다 */
function NotComputed({ a, b }: { a: AnalyzeResponse; b: AnalyzeResponse }) {
  const titleId = COMPARE_IDS.notComputedTitle
  const notices = [...notComputedNotices('A', a), ...notComputedNotices('B', b)]
  const coverageA = a.result.종합.데이터_충족률
  const coverageB = b.result.종합.데이터_충족률
  if (coverageA !== coverageB) {
    notices.push(`데이터 충족률: A ${formatRatio(coverageA)} · B ${formatRatio(coverageB)}`)
  }
  if (notices.length === 0) return null
  return (
    <section className="compare__section" aria-labelledby={titleId}>
      <h2 id={titleId} className="compare__section-title">
        미산출·데이터 차이
      </h2>
      <ul className="warnings__list">
        {notices.map((text) => (
          <li key={text} className="warnings__item warnings__item--info">
            <Icon name="info" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 주의할 점 (§5.5): 위치별로 엔진 경고(병목 문장만 표시용) + 데이터 한계. 같은 문장이라도 합치지 않는다 */
function Warnings({ a, b }: { a: AnalyzeResponse; b: AnalyzeResponse }) {
  const titleId = COMPARE_IDS.warningsTitle
  return (
    <section className="compare__section" aria-labelledby={titleId}>
      <h2 id={titleId} className="compare__section-title">
        주의할 점
      </h2>
      <SideWarnings side="A" analysis={a} />
      <SideWarnings side="B" analysis={b} />
    </section>
  )
}

function SideWarnings({ side, analysis }: { side: CompareSide; analysis: AnalyzeResponse }) {
  const titleId = useId()
  const warnings = displayWarnings(analysis)
  const limits = dataLimits(analysis)
  return (
    <section className="compare__side" aria-labelledby={titleId}>
      <h3 id={titleId} className="compare__side-title">
        {side} {locationName(analysis.context)}
      </h3>
      {warnings.length === 0 ? (
        <p className="warnings__empty">특별한 경고가 없습니다.</p>
      ) : (
        <ul className="warnings__list">
          {warnings.map((text) => (
            <li key={text} className="warnings__item warnings__item--warning">
              <Icon name="alert-triangle" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
      {limits.length > 0 && (
        <>
          <h4 className="warnings__subtitle">데이터 한계</h4>
          <ul className="warnings__list">
            {limits.map((n) => (
              <li key={n.text} className={`warnings__item warnings__item--${n.tone}`}>
                <Icon name={n.tone === 'warning' ? 'alert-triangle' : 'info'} />
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** 핵심 원시값 (§5.6): 기본 접힘. 없는 키("해당 없음")와 null("데이터 없음")을 구분하고, 차이 열은 두지 않는다(D10) */
function RawValues({ a, b }: { a: AnalyzeResponse; b: AnalyzeResponse }) {
  const titleId = useId()
  const bodyId = useId()
  const [open, setOpen] = useState(false)
  const radiusM = a.result.meta.분석반경_m
  const target = a.result.지표[1].raw.타겟_정의

  const cell = (r: EngineResult, row: (typeof RAW_ROWS)[number]) => {
    const c = rawCell(r, row)
    return (
      <td className={c.status === 'value' ? undefined : 'compare-table__missing'}>{rawCellText(c)}</td>
    )
  }

  return (
    <section className="compare__section" aria-labelledby={titleId}>
      <div className="compare__section-head">
        <h2 id={titleId} className="compare__section-title">
          핵심 원시값
        </h2>
        <button
          type="button"
          className="button-ghost button-ghost--small"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="chevron" data-open={open}>
            <Icon name="chevron-right" />
          </span>
          원시값 보기
        </button>
      </div>
      {open && (
        <div id={bodyId} role="region" aria-label="핵심 원시값 표">
          <p className="result-section__note">
            엔진 응답 값 그대로입니다(단위만 붙임). "해당 없음"은 이 위치의 응답에 없는 값(예: 같은 업종 점포가 0곳이면 같은
            업종 비중을 계산하지 않음), "데이터 없음"은 값이 비어 있다는 뜻입니다. 타겟 연령: {target}.
          </p>
          <div className="table-scroll">
            <table className="data-table compare-table compare-table--raw">
              <caption className="visually-hidden">핵심 원시값: A {locationName(a.context)}, B {locationName(b.context)}</caption>
              <thead>
                <tr>
                  <th scope="col">항목</th>
                  <th scope="col">A</th>
                  <th scope="col">B</th>
                </tr>
              </thead>
              {PERSPECTIVE_KEYS.map((key) => (
                <tbody key={key}>
                  <tr className="compare-table__group">
                    <th scope="rowgroup" colSpan={3}>
                      {scoreOf(a.result, key).label} · {perspectiveUnit(key, radiusM)}
                    </th>
                  </tr>
                  {RAW_ROWS.filter((row) => row.perspective === key).map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {cell(a.result, row)}
                      {cell(b.result, row)}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
