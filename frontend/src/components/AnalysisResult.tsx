import { useState, type ReactNode } from 'react'
import type { AnalyzeResponse } from '../api/schemas.ts'
import { singleBand } from '../lib/attentionBand.ts'
import { dataVersionLabel, dataVersionOf, ResultDataVersionContext } from '../lib/dataVersion.ts'
import { formatDistance, formatRadius, locationName, nearestStation } from '../lib/format.ts'
import { AttentionBand } from './AttentionBand.tsx'
import { BeginnerAccess } from './BeginnerAccess.tsx'
import { CoverageMeta } from './CoverageMeta.tsx'
import { DataSources, SERVICE_DISCLAIMER } from './DataSources.tsx'
import { FieldChecks } from './FieldChecks.tsx'
import { fieldChecks } from '../content/fieldChecks.ts'
import type { FieldNote, FieldNotes } from '../lib/fieldNotes.ts'
import { GapsLine } from './GapsLine.tsx'
import { gapLines } from '../lib/gaps.ts'
import { IndicatorDetails } from './IndicatorDetails.tsx'
import { LocationSummary } from './LocationSummary.tsx'
import { PerspectiveScores, type PerspectiveOrder } from './PerspectiveScores.tsx'
import { RadarChart } from './RadarChart.tsx'
import { ScoreCard } from './ScoreCard.tsx'
import { TabRevealContext, useResultTabs, useTabIdBase, type TabDef } from '../lib/resultTabs.ts'
import { TabList, TabPanel } from './ResultTabs.tsx'
import { WarningPanel } from './WarningPanel.tsx'
import './AnalysisResult.css'
import './ResultQuiet.css'

type ResultTab = 'evidence' | 'stores' | 'field' | 'radius'

/**
 * 분석 결과 — 대시보드 (R1 13-10~13-14·13-19, DESIGN.md §20, 팀 점검 보고서 시안 규칙 1~5).
 * 읽는 순서: 위치·업종 → (규제 배너) → 종합 점수 + 등급 + 한 줄 결론 + (주의 관점 한 줄) → 다섯 관점(거미줄 + 점수순 막대, 근거는 행을 펼쳐서)
 * → 시간대·인구 카드(13-15) → 이 자리 업종 순위(13-16) → 결과 활용 줄·안내(B3: 첫 화면에서 아래로) → 탭(상세 근거 · 주변 점포 · 현장 확인 ·
 * 반경별 비교) → 접힌 "데이터 한계 N개"(B4: 확인 필요 줄 + 주의 요약을 한 곳에) → 면책 한 줄.
 * 입력은 AnalyzeResponseSchema로 검증된 값만 받는다. 엔진 값은 그대로 보여 준다(정렬·등급·결론은 표시만).
 */
export function AnalysisResult({
  analysis,
  nearby,
  nearbyCount,
  address,
  titlePrefix,
  eyebrowAction,
  radiusTable,
  fieldNotes,
  tools,
  notes,
  timeCard,
  rankCard,
}: {
  analysis: AnalyzeResponse
  /** 주변 점포 탭 내용 (App이 별도 요청 상태와 함께 넘긴다) */
  nearby?: ReactNode
  /** 주변 점포 탭의 개수 표시 (목록을 받았을 때만) */
  nearbyCount?: number | null
  /** 접힌 위치 정보의 참고 주소 (이 응답 context 좌표의 ReferenceAddress) */
  address?: ReactNode
  /** 두 위치 비교의 전체 결과 화면에서 "A"·"B" (제목 "B · 남동구 구월3동 · PC방 분석") */
  titlePrefix?: string
  /** 머리 맨 위 줄 오른쪽 조작 (비교 중 전체 결과의 "비교로 돌아가기") */
  eyebrowAction?: ReactNode
  /** 반경별 비교 표 (12-26, App이 결과 캐시로 만든다 — 서버가 반경을 광고하는 단일 결과에서만) → "반경별 비교" 탭 */
  radiusTable?: ReactNode
  /** 현장 확인 카드의 체크·메모 (12-27, 조건 키별 로컬 저장 — App). 없으면 카드만 */
  fieldNotes?: { notes: FieldNotes; onChange: (id: string, note: FieldNote) => void }
  /** 결과 활용 줄(링크 복사·인쇄·보관, 12-15·12-25) — 다섯 관점 아래(B3) */
  tools?: ReactNode
  /** 안내(공유 링크·보관함 다시 분석·첫 방문 결과 안내) — 다섯 관점 아래(B3) */
  notes?: ReactNode
  /** 시간대·인구 카드 (13-15) */
  timeCard?: ReactNode
  /** 이 자리 업종 순위 카드 (13-16) */
  rankCard?: ReactNode
}) {
  const { context, result } = analysis
  const dataVersion = dataVersionOf(analysis)   // 9-C4: 응답 헤더 X-Data-Version (모르면 null)
  const [explanations, setExplanations] = useState(false)
  const [order, setOrder] = useState<PerspectiveOrder>('score')
  const { tab, setTab, reveal } = useResultTabs<ResultTab>('evidence')
  const idBase = useTabIdBase()
  const station = nearestStation(result.지표)
  // 관점 행의 "상세 근거 ›"를 누르면 상세 근거 탭의 그 관점을 펼치고 그리로 간다
  const [openRequest, setOpenRequest] = useState<{ key: string; n: number } | null>(null)
  const openDetail = (key: string) => {
    setTab('evidence')
    setOpenRequest((r) => ({ key, n: (r?.n ?? 0) + 1 }))
  }
  const checks = fieldChecks(analysis)
  const gaps = gapLines(analysis)
  const band = singleBand(analysis)
  const tabs: TabDef<ResultTab>[] = [
    { key: 'evidence', label: '상세 근거' },
    { key: 'stores', label: '주변 점포', count: nearbyCount ?? null },
    { key: 'field', label: '현장 확인', count: checks.length },
    ...(radiusTable ? [{ key: 'radius' as const, label: '반경별 비교' }] : []),
  ]

  return (
    <ResultDataVersionContext.Provider value={dataVersion}>
    <TabRevealContext.Provider value={reveal}>
      <article className={`result result--quiet result--dash${explanations ? ' result--explained' : ''}`}>
        <div className="result__head">
          <p className="result__eyebrow">
            <span>
              분석 결과 · 반경 {formatRadius(result.meta.분석반경_m)}
              {dataVersion && ` · ${dataVersionLabel(dataVersion)}`}
            </span>
            {eyebrowAction}
          </p>
          <h1 id="result-title" className="result__title" tabIndex={-1}>
            {/* 접근 이름 "B · 남동구 구월3동 · PC방 분석" — 구분 공백은 span 밖 글자로(span 안 앞뒤 공백은 이름에서 사라진다) */}
            {titlePrefix && (
              <>
                <span className={`pin-letter pin-letter--${titlePrefix.toLowerCase()}`}>{titlePrefix}</span>{' '}
                <span className="visually-hidden">·</span>{' '}
              </>
            )}
            {/* 접근 이름 "부평구 부평1동 · PC방 분석" — 구분 공백은 span 밖 글자로 */}
            {locationName(context)}{' '}
            <span className="result__title-biz">· {result.meta.업종}</span>{' '}
            <span className="visually-hidden">분석</span>
          </h1>
          <details className="result__location">
            <summary>위치 정보</summary>
            <div className="result__sub">
              {station && (
                <span>
                  {station.name}까지 직선거리 {formatDistance(station.distanceM)}
                </span>
              )}
              {address}
            </div>
          </details>
          <ScoreCard analysis={analysis} />
        </div>

        <section className="result__perspectives" aria-labelledby="perspectives-heading">
          <div className="result__section-head">
            <h2 id="perspectives-heading" className="result__section-title">다섯 관점</h2>
            <div className="result__section-actions">
              <button
                type="button"
                className={`result__order${order === 'score' ? ' result__order--on' : ''}`}
                aria-pressed={order === 'score'}
                onClick={() => setOrder((o) => (o === 'score' ? 'fixed' : 'score'))}
              >
                {order === 'score' ? '점수순' : '기본 순서'}
              </button>
              <button
                type="button"
                className="result__explain"
                aria-expanded={explanations}
                onClick={() => setExplanations((v) => !v)}
              >
                {explanations ? '간단히 보기' : '설명 함께 보기'}
              </button>
            </div>
          </div>
          {/* 숫자 목록이 먼저(좁은 화면은 막대 → 거미줄 순, Codex R1-4). 넓은 결과 영역에서는 CSS 가 거미줄을 왼쪽 칸에 둔다 */}
          <div className="result__persp-grid">
            <PerspectiveScores
              summary={result.종합}
              indicators={result.지표}
              guName={context.gu_name}
              business={result.meta.업종}
              radiusM={result.meta.분석반경_m}
              order={order}
              onOpen={openDetail}
            />
            <RadarChart series={[{ id: 'a', name: locationName(context), items: result.지표 }]} />
          </div>
          <p className="result__persp-note">막대·거미줄의 점선 50은 인천 동네 평균 지점입니다 · 행을 누르면 근거가 펼쳐집니다.</p>
        </section>

        {timeCard}
        {rankCard}
        {notes}
        {tools}

        <TabList label="자세히 보기" tabs={tabs} selected={tab} onSelect={setTab} idBase={idBase} />
        <div className="result__body">
          <TabPanel tab="evidence" selected={tab} idBase={idBase}>
            <IndicatorDetails
              indicators={result.지표}
              summary={result.종합}
              meta={result.meta}
              openRequest={openRequest}
            />
            <CoverageMeta
              summary={result.종합}
              indicators={result.지표}
              group={result.meta.업종그룹}
              access={result.초보자_접근성}
            />
            <WarningPanel analysis={analysis} />
            <BeginnerAccess access={result.초보자_접근성} />
            <section className="result-section" aria-labelledby="location-title">
              <h2 id="location-title" className="result-section__title">
                위치
              </h2>
              <LocationSummary context={context} station={station} />
            </section>
            <DataSources meta={result.meta} disclaimer={result.면책} />
          </TabPanel>
          <TabPanel tab="stores" selected={tab} idBase={idBase}>
            {nearby ?? <p className="result-section__empty">점포 목록이 없습니다.</p>}
          </TabPanel>
          <TabPanel tab="field" selected={tab} idBase={idBase}>
            <FieldChecks checks={checks} notes={fieldNotes?.notes} onChange={fieldNotes?.onChange} />
          </TabPanel>
          {radiusTable && (
            <TabPanel tab="radius" selected={tab} idBase={idBase}>
              {radiusTable}
            </TabPanel>
          )}
        </div>

        {/* 데이터 한계 (B4): "확인 필요" 줄과 주의 요약을 접힌 한 곳에. 규제 배너·주의 관점 한 줄은 위에서 펼쳐 보였고 여기엔 원문 요약·이동 링크 */}
        <AttentionBand lines={band} moreTarget="warnings" label="데이터 한계" extraCount={gaps.length}>
          <GapsLine items={gaps} />
        </AttentionBand>
        <p className="result__disclaimer result__disclaimer--foot">{SERVICE_DISCLAIMER}</p>
      </article>
    </TabRevealContext.Provider>
    </ResultDataVersionContext.Provider>
  )
}

const LABELS = /(시장성|고객성|경쟁성|입지성|안정성)/

/** 문장에서 관점 이름만 굵게, "가장 높고" 앞의 이름은 주색 (시안 .headline b / .hi). 문장은 바꾸지 않는다. 모바일 시트가 쓴다 */
export function HeadlineText({ text }: { text: string }) {
  const highAt = text.indexOf('가장 높')
  const parts = text.split(LABELS)
  const starts = parts.map((_, i) => parts.slice(0, i).join('').length)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : (
          <b key={i} className={highAt >= 0 && starts[i]! < highAt ? 'result__headline-hi' : undefined}>
            {part}
          </b>
        ),
      )}
    </>
  )
}
