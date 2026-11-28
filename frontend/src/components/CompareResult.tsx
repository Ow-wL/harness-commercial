import { useId, useState, type ReactNode } from 'react'
import { PERSPECTIVE_KEYS, type AnalyzeResponse, type EngineResult } from '../api/schemas.ts'
import {
  displayScoreDiff,
  higherPerspectives,
  COMPARE_EMPHASIS_DIFF,
  higherSide,
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
import { regulationAlert } from '../lib/alerts.ts'
import { compareBand } from '../lib/attentionBand.ts'
import { dataVersionLabel, dataVersionOf, ResultDataVersionContext } from '../lib/dataVersion.ts'
import { gapLines } from '../lib/gaps.ts'
import { GapsLine } from './GapsLine.tsx'
import { dataLimits, displayWarnings, isSchoolZoneWarning } from '../lib/warnings.ts'
import { AnalysisResult } from './AnalysisResult.tsx'
import { AttentionBand } from './AttentionBand.tsx'
import { DataSources, SERVICE_DISCLAIMER } from './DataSources.tsx'
import { Icon } from './Icon.tsx'
import { RegulationBadge } from './ResultAlerts.tsx'
import type { FieldNote, FieldNotes } from '../lib/fieldNotes.ts'
import { TabRevealContext, useResultTabs, useTabIdBase, type TabDef } from '../lib/resultTabs.ts'
import { TabList, TabPanel } from './ResultTabs.tsx'
import { RadarChart } from './RadarChart.tsx'
import './CompareResult.css'

type Indicator = EngineResult['지표'][number]
type CompareTab = 'summary' | 'stores' | 'evidence'
/** 요약 탭의 관점 그림 (13-58): 맞대기 막대(기본) · 겹쳐보기(겹친 고리 + 거미줄) */
type CompareView = 'bars' | 'overlap'

/**
 * 두 위치 비교 요약 (A3 compare, DESIGN.md §19.1, docs/COMPARE_DESIGN.md 5장).
 * 머리: 비교 조건 · A/B 위치 줄(종합 점수, 누르면 그 위치 전체 결과) · 두 지점 거리 · 주의 요약 띠.
 * 탭: 요약(한 줄 요약 + 관점별 맞대기 막대, "겹쳐보기"로 바꾸면 겹친 고리·거미줄 — 표시용 차이일 뿐 판정·순위 아님, 13-58) · 주변 점포(A/B 기준) ·
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
  const [explanations, setExplanations] = useState(false)
  const [view, setView] = useState<CompareView>('bars')
  const radiusM = a.result.meta.분석반경_m
  // 9-C4: A·B 는 같은 데이터 버전일 때만 한 비교로 보인다(App) — A 의 버전을 쓴다
  const dataVersion = dataVersionOf(a)
  const { tab, setTab, reveal } = useResultTabs<CompareTab>('summary')
  const idBase = useTabIdBase()
  const overlap = radiusOverlap(a.context, b.context, radiusM)
  const tabs: TabDef<CompareTab>[] = [
    { key: 'summary', label: '요약' },
    { key: 'stores', label: '주변 점포' },
    { key: 'evidence', label: '상세 근거' },
  ]

  return (
    <ResultDataVersionContext.Provider value={dataVersion}>
    <TabRevealContext.Provider value={reveal}>
      <section className={`compare result--quiet${explanations ? ' result--explained' : ''}`} aria-labelledby={COMPARE_IDS.title}>
        <div className="result__head">
          <div className="result__eyebrow">
            <div className="compare__eyebrow-title">
              <h1 id={COMPARE_IDS.title} className="compare__title" tabIndex={-1}>
                두 위치 비교 · {biz}
              </h1>
              <span>
                {' '}
                · 반경 {formatRadius(radiusM)}
                {dataVersion && ` · ${dataVersionLabel(dataVersion)}`}
              </span>
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
            <SiteRow side="A" analysis={a} onShowDetail={onShowDetail} />
            <span className="compare__sites-label" aria-hidden="true">
              종합 점수
            </span>
            <SiteRow side="B" analysis={b} onShowDetail={onShowDetail} />
          </div>
          <CompareGaps a={a} b={b} />
          <details className="result__location">
            <summary>위치 정보</summary>
            <SiteLocation side="A" analysis={a} address={addresses?.A} />
            <SiteLocation side="B" analysis={b} address={addresses?.B} />
            <p className="compare__distance">
              두 지점 직선거리 {overlap.distanceM.toLocaleString('ko-KR')}m ·{' '}
              {overlap.overlaps ? '분석 반경이 겹침' : '분석 반경 겹침 없음'}
            </p>
          </details>
          <AttentionBand lines={compareBand(a, b)} moreTarget="compare-warnings" />
        </div>
        <TabList label="비교 보기" tabs={tabs} selected={tab} onSelect={setTab} idBase={idBase} />
        <div className="result__body">
          <TabPanel tab="summary" selected={tab} idBase={idBase}>
            <HigherLine a={a.result} b={b.result} />
            <div className="result__section-head">
              <div className="compare__view-switch" role="group" aria-label="관점 보기 방식">
                {(
                  [
                    ['bars', '맞대기'],
                    ['overlap', '겹쳐보기'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="compare__view-button"
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="result__explain"
                aria-expanded={explanations}
                onClick={() => setExplanations((v) => !v)}
              >
                {explanations ? '간단히 보기' : '설명 함께 보기'}
              </button>
            </div>
            {view === 'bars' ? (
              <CompareRows a={a} b={b} onOpen={() => reveal(COMPARE_IDS.scoreTitle)} />
            ) : (
              /* 겹쳐보기: 관점마다 겹친 고리(바깥 A · 안쪽 B) + 다섯 관점을 한 그림에 겹친 거미줄(13-13) */
              <div className="compare__overlap">
                <CompareRings a={a} b={b} />
                <RadarChart
                  size={220}
                  title="A·B 다섯 관점 거미줄 그래프"
                  series={[
                    { id: 'a', name: `A ${locationName(a.context)}`, items: a.result.지표 },
                    { id: 'b', name: `B ${locationName(b.context)}`, items: b.result.지표 },
                  ]}
                />
              </div>
            )}
            <div className="result__secondary">
              <p className="result__hint">
                <span className="compare__legend-a" aria-hidden="true" /> A{' '}
                <span className="compare__legend-b" aria-hidden="true" /> B · 막대·고리 길이의 차이는 표시용일 뿐, 어느
                위치가 낫다는 판정이나 순위가 아닙니다. {COMPARE_EMPHASIS_DIFF}점 넘게 차이 나는 관점만 높은 쪽을 진하게 그립니다.
              </p>
              <p className="result__disclaimer">{SERVICE_DISCLAIMER}</p>
            </div>
            <p className="result__brief-note">참고 지표 · 두 위치의 우열을 뜻하지 않습니다.</p>
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
    </ResultDataVersionContext.Provider>
  )
}

const SIDE_TITLE: Record<CompareSide, string> = { A: 'A 기준 위치', B: 'B 비교 위치' }

/** 비교 머리는 글자 핀 · 행정동 · 종합 점수만 — A 는 왼쪽 칸, B 는 오른쪽 칸에 마주 보게(13-58). 역·주소는 별도 위치 정보에서 펼친다. */
function SiteRow({
  side,
  analysis,
  onShowDetail,
}: {
  side: CompareSide
  analysis: AnalyzeResponse
  onShowDetail: (side: CompareSide) => void
}) {
  const score = analysis.result.종합.점수
  const regulated = regulationAlert(analysis) !== null
  return (
    <section className={`compare__site compare__site--${side.toLowerCase()}`} aria-label={SIDE_TITLE[side]}>
      <button
        type="button"
        className="compare__site-button"
        aria-label={`${SIDE_TITLE[side]} ${locationName(analysis.context)} · 종합 ${score === null ? '산출 불가' : `${formatScore(score)}점`}${regulated ? ' · 규제 확인 필요' : ''} · 전체 결과로`}
        onClick={() => onShowDetail(side)}
      >
        <span className="compare__site-top">
          <span className={`pin-letter pin-letter--${side.toLowerCase()}`} aria-hidden="true">
            {side}
          </span>
          <span className="compare__site-name">{locationName(analysis.context)}</span>
          <span className="compare__site-go" aria-hidden="true">
            ›
          </span>
        </span>
        <span className={`compare__site-score${score === null ? ' compare__site-score--missing' : ''}`}>
          {score === null ? '산출 불가' : formatScore(score)}
          {score !== null && <small>/100</small>}
        </span>
        <RegulationBadge show={regulated} />
      </button>
    </section>
  )
}

function SiteLocation({ side, analysis, address }: { side: CompareSide; analysis: AnalyzeResponse; address?: ReactNode }) {
  const station = nearestStation(analysis.result.지표)
  return (
    <div className="compare__site-sub">
      <span>
        {side} · {station ? `${station.name}까지 직선거리 ${formatDistance(station.distanceM)}` : locationName(analysis.context)}
      </span>
      {address}
    </div>
  )
}

/**
 * 한 줄 요약 (13-58): 쪽마다 더 높은 관점 이름만. 차이가 기준(COMPARE_EMPHASIS_DIFF)을 넘는 관점만 든다.
 * 관점 이름은 모두 "…성"이라 조사는 "이"로 고정한다. 사실만 말하고 어느 위치가 낫다고 하지 않는다.
 */
function HigherLine({ a, b }: { a: EngineResult; b: EngineResult }) {
  const hi = higherPerspectives(a, b)
  const part = (side: CompareSide) =>
    hi[side].length > 0 && (
      <>
        <b className={`compare__lead-${side.toLowerCase()}`}>{side}</b>는 {hi[side].join('·')}이
      </>
    )
  return (
    <p className="compare__lead">
      {hi.A.length === 0 && hi.B.length === 0 ? (
        '다섯 관점 점수가 서로 비슷해요'
      ) : (
        <>
          {part('A')}
          {hi.A.length > 0 && hi.B.length > 0 && ', '}
          {part('B')} 더 높아요
        </>
      )}
    </p>
  )
}

const scoreText = (score: number | null) => (score === null ? '미산출' : formatScore(score))

/**
 * 요약 탭 기본 그림 (13-58, DESIGN.md §31): 관점 이름을 가운데 두고 A 막대는 왼쪽으로, B 막대는 오른쪽으로 뻗는다.
 * 차이가 기준을 넘는 관점만 높은 쪽을 진하게. 막대는 표시용일 뿐이고 정확한 값·차이는 상세 근거 탭의 표에 있다(행을 누르면 그 표로).
 */
function CompareRows({ a, b, onOpen }: { a: AnalyzeResponse; b: AnalyzeResponse; onOpen: () => void }) {
  return (
    <section className="compare-rows" aria-labelledby="compare-rows-title">
      <h2 id="compare-rows-title" className="visually-hidden">
        관점별 점수 (A·B)
      </h2>
      <ul className="compare-rows__list">
        {PERSPECTIVE_KEYS.map((key) => {
          const ia = scoreOf(a.result, key)
          const ib = scoreOf(b.result, key)
          const hi = higherSide(ia.score, ib.score)
          const tag = bottleneckTag('B', b.result, ib) ?? bottleneckTag('A', a.result, ia)
          return (
            <li key={key}>
              <button
                type="button"
                className="compare-row"
                aria-label={`${ia.label} · A ${scoreText(ia.score)}, B ${scoreText(ib.score)}${tag ? ` · ${tag}` : ''} · 점수 비교 표로`}
                onClick={onOpen}
              >
                <b className={`compare-row__val compare-row__val--a${hi === 'A' ? ' compare-row__hi' : ''}`}>{scoreText(ia.score)}</b>
                <span className="compare-row__track compare-row__track--a" aria-hidden="true">
                  {ia.score !== null && ia.score > 0 && (
                    <span className={`compare-row__bar${hi === 'A' ? ' compare-row__bar--hi' : ''}`} style={{ width: `${Math.min(100, ia.score)}%` }} />
                  )}
                </span>
                <span className="compare-row__label">{ia.label}</span>
                <span className="compare-row__track compare-row__track--b" aria-hidden="true">
                  {ib.score !== null && ib.score > 0 && (
                    <span className={`compare-row__bar${hi === 'B' ? ' compare-row__bar--hi' : ''}`} style={{ width: `${Math.min(100, ib.score)}%` }} />
                  )}
                </span>
                <b className={`compare-row__val compare-row__val--b${hi === 'B' ? ' compare-row__hi' : ''}`}>{scoreText(ib.score)}</b>
                {tag && <span className="compare-row__tag">{tag}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 겹친 고리: 88 기준 바깥(A) 반지름 37, 안쪽(B) 반지름 26 */
const RING_A = 37
const RING_B = 26
const arc = (score: number, r: number) => `${(Math.min(100, score) / 100) * 2 * Math.PI * r} ${2 * Math.PI * r}`

/**
 * 겹쳐보기 (13-58, DESIGN.md §31): 관점마다 카드 한 장 — 바깥 고리 A, 안쪽 고리 B, 아래에 두 값.
 * 그림(svg)은 화면 읽기에서 숨기고 이름·값 글자가 같은 내용을 준다. 미산출은 고리를 그리지 않고 "미산출".
 */
function CompareRings({ a, b }: { a: AnalyzeResponse; b: AnalyzeResponse }) {
  return (
    <section className="compare-rings" aria-labelledby="compare-rings-title">
      <h2 id="compare-rings-title" className="visually-hidden">
        관점별 점수 (A·B 겹쳐보기)
      </h2>
      <ul className="compare-rings__list">
        {PERSPECTIVE_KEYS.map((key) => {
          const ia = scoreOf(a.result, key)
          const ib = scoreOf(b.result, key)
          const hi = higherSide(ia.score, ib.score)
          const tag = bottleneckTag('B', b.result, ib) ?? bottleneckTag('A', a.result, ia)
          return (
            <li key={key} className="compare-ring">
              <svg className="compare-ring__dial" viewBox="0 0 88 88" aria-hidden="true">
                <circle className="compare-ring__track" cx="44" cy="44" r={RING_A} />
                <circle className="compare-ring__track" cx="44" cy="44" r={RING_B} />
                {ia.score !== null && ia.score > 0 && (
                  <circle className="compare-ring__arc compare-ring__arc--a" cx="44" cy="44" r={RING_A} strokeDasharray={arc(ia.score, RING_A)} transform="rotate(-90 44 44)" />
                )}
                {ib.score !== null && ib.score > 0 && (
                  <circle className="compare-ring__arc compare-ring__arc--b" cx="44" cy="44" r={RING_B} strokeDasharray={arc(ib.score, RING_B)} transform="rotate(-90 44 44)" />
                )}
              </svg>
              <span className="compare-ring__name">{ia.label}</span>
              <span className="compare-ring__vals">
                <span className={`compare-ring__val compare-ring__val--a${hi === 'A' ? ' compare-row__hi' : ''}`}>
                  <i>A</i> {scoreText(ia.score)}
                </span>
                <span className={`compare-ring__val compare-ring__val--b${hi === 'B' ? ' compare-row__hi' : ''}`}>
                  <i>B</i> {scoreText(ib.score)}
                </span>
              </span>
              {tag && <span className="compare-ring__tag">{tag}</span>}
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
    ? `${side} 주의 관점 — ${BOTTLENECK_WARN_BELOW}점 미만`
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
  fieldNotes,
}: {
  side: CompareSide
  analysis: AnalyzeResponse
  /** 그 위치의 점포 목록 (A 전체 → A 점포, B 전체 → B 점포, 5차-B5) */
  nearby?: ReactNode
  nearbyCount?: number | null
  /** 보고 있는 위치의 참고 주소 줄 (7-B3, 그 위치 context 좌표) */
  address?: ReactNode
  /** 현장 확인 카드 기록 (12-27, 그 위치의 조건 키) */
  fieldNotes?: { notes: FieldNotes; onChange: (id: string, note: FieldNote) => void }
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
        fieldNotes={fieldNotes}
      />
    </div>
  )
}


const scoreOf = (r: EngineResult, key: string): Indicator => r.지표.find((i) => i.key === key)!

/** 위치 안의 사실(주의 관점(엔진 병목)·가장 강한 관점)만 붙인다. 두 위치를 견주는 말이 아니다. '병목' 대신 "주의"(13-3, D1) */
function ScoreTags({ result, indicator }: { result: EngineResult; indicator: Indicator }) {
  const bottleneck = result.종합.병목_지표 === indicator.key && indicator.score !== null
  const strongest = result.종합.최고_지표 === indicator.key && indicator.score !== null
  if (!bottleneck && !strongest) return null
  const warn = bottleneck && indicator.score! < BOTTLENECK_WARN_BELOW
  return (
    <span className={`compare-table__tag${warn ? ' compare-table__tag--warn' : ''}`}>
      {bottleneck ? '주의' : '가장 강한 관점'}
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

/** "확인 필요" 한 줄(12-20): A·B 가 같으면 하나, 다르면 A·B 각각 */
function CompareGaps({ a, b }: { a: AnalyzeResponse; b: AnalyzeResponse }) {
  const ga = gapLines(a)
  const gb = gapLines(b)
  if (ga.length === gb.length && ga.every((t, i) => t === gb[i])) return <GapsLine items={ga} />
  return (
    <>
      <GapsLine prefix="A" items={ga} />
      <GapsLine prefix="B" items={gb} />
    </>
  )
}

/** 미산출·데이터 차이 (§5.4). 실제 미산출 관점·데이터 충족률에서 만든다. 해당이 없으면 섹션을 두지 않는다 */
function NotComputed({ a, b }: { a: AnalyzeResponse; b: AnalyzeResponse }) {
  const titleId = COMPARE_IDS.notComputedTitle
  const notices = [...notComputedNotices('A', a), ...notComputedNotices('B', b)]
  const coverageA = a.result.종합.데이터_충족률
  const coverageB = b.result.종합.데이터_충족률
  if (coverageA !== coverageB) {
    // 엔진 데이터_충족률 = 점수를 낸 관점의 가중치 비율(세부자료 완성률이 아니다, 12-17)
    notices.push(`점수를 낸 관점의 가중치 비율: A ${formatRatio(coverageA)} · B ${formatRatio(coverageB)}`)
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
            // v0.5 학교구역 경고(엔진 순서상 맨 앞)는 원문 그대로 강조만 한다 (WarningPanel 과 같은 규칙, D-028)
            <li
              key={text}
              className={`warnings__item ${isSchoolZoneWarning(text) ? 'warnings__item--priority' : 'warnings__item--warning'}`}
            >
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
