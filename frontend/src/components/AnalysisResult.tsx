import { useState, type ReactNode } from 'react'
import type { AnalyzeResponse } from '../api/schemas.ts'
import { singleBand } from '../lib/attentionBand.ts'
import { formatDistance, formatRadius, locationName, nearestStation } from '../lib/format.ts'
import { headline } from '../lib/headline.ts'
import { AttentionBand } from './AttentionBand.tsx'
import { BeginnerAccess } from './BeginnerAccess.tsx'
import { CoverageMeta } from './CoverageMeta.tsx'
import { DataSources, SERVICE_DISCLAIMER } from './DataSources.tsx'
import { IndicatorDetails } from './IndicatorDetails.tsx'
import { LocationSummary } from './LocationSummary.tsx'
import { OverallScore } from './OverallScore.tsx'
import { PerspectiveScores } from './PerspectiveScores.tsx'
import { TabRevealContext, useResultTabs, useTabIdBase, type TabDef } from '../lib/resultTabs.ts'
import { TabList, TabPanel } from './ResultTabs.tsx'
import { WarningPanel } from './WarningPanel.tsx'
import './AnalysisResult.css'

type ResultTab = 'summary' | 'stores' | 'evidence'

/**
 * 분석 결과 패널 (A3, DESIGN.md §19.1·§19.5, docs/UX_REDESIGN.md 2.1).
 * 머리(항상 보임): 분석 반경 · 위치 제목 · 최근접역·참고 주소 · 종합 점수 · 헤드라인 · 주의 요약 띠
 * 탭: 요약(다섯 관점 막대 + 근거 줄 + 충족 1줄 — 관점을 누르면 상세 근거의 그 관점) · 주변 점포 · 상세 근거
 * (관점별 근거 · 주의할 점 · 초보자 접근성 · 위치 · 데이터 출처와 엔진 면책 원문).
 * 입력은 AnalyzeResponseSchema로 검증된 값만 받는다. 엔진 값은 그대로 보여 준다.
 */
export function AnalysisResult({
  analysis,
  nearby,
  nearbyCount,
  address,
  titlePrefix,
  eyebrowAction,
}: {
  analysis: AnalyzeResponse
  /** 주변 점포 탭 내용 (App이 별도 요청 상태와 함께 넘긴다) */
  nearby?: ReactNode
  /** 주변 점포 탭의 개수 표시 (목록을 받았을 때만) */
  nearbyCount?: number | null
  /** 머리의 참고 주소 줄 (7-B2, 이 응답 context 좌표의 ReferenceAddress) */
  address?: ReactNode
  /** 두 위치 비교의 전체 결과 화면에서 "A"·"B" (제목 "B · 남동구 구월3동 · PC방 분석") */
  titlePrefix?: string
  /** 머리 맨 위 줄 오른쪽 조작 (비교 중 전체 결과의 "비교로 돌아가기") */
  eyebrowAction?: ReactNode
}) {
  const { context, result } = analysis
  const { tab, setTab, reveal } = useResultTabs<ResultTab>('summary')
  const idBase = useTabIdBase()
  const station = nearestStation(result.지표)
  // 관점 행을 누르면 상세 근거 탭의 그 관점을 펼치고 그리로 간다
  const [openRequest, setOpenRequest] = useState<{ key: string; n: number } | null>(null)
  const openDetail = (key: string) => {
    setTab('evidence')
    setOpenRequest((r) => ({ key, n: (r?.n ?? 0) + 1 }))
  }
  const tabs: TabDef<ResultTab>[] = [
    { key: 'summary', label: '요약' },
    { key: 'stores', label: '주변 점포', count: nearbyCount ?? null },
    { key: 'evidence', label: '상세 근거' },
  ]

  return (
    <TabRevealContext.Provider value={reveal}>
      <article className="result">
        <div className="result__head">
          <p className="result__eyebrow">
            <span>분석 결과 · 반경 {formatRadius(result.meta.분석반경_m)}</span>
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
            {locationName(context)}{' '}
            <span className="visually-hidden">· {result.meta.업종} 분석</span>
          </h1>
          <div className="result__sub">
            {station && (
              <span>
                {station.name}까지 직선거리 {formatDistance(station.distanceM)}
              </span>
            )}
            {address}
          </div>
          <OverallScore summary={result.종합} />
          <p className="result__headline">
            <HeadlineText text={headline(result)} />
          </p>
          <AttentionBand lines={singleBand(analysis)} moreTarget="warnings" />
        </div>
        <TabList label="결과 보기" tabs={tabs} selected={tab} onSelect={setTab} idBase={idBase} />
        <div className="result__body">
          <TabPanel tab="summary" selected={tab} idBase={idBase}>
            <PerspectiveScores
              summary={result.종합}
              indicators={result.지표}
              guName={context.gu_name}
              business={result.meta.업종}
              onOpen={openDetail}
            />
            <CoverageMeta
              summary={result.종합}
              indicators={result.지표}
              group={result.meta.업종그룹}
              access={result.초보자_접근성}
            />
            <p className="result__hint">
              "가장 높음·낮음"은 이 위치 안 다섯 관점끼리의 비교입니다. 관점을 누르면 근거를 자세히 볼 수 있습니다.
            </p>
            <p className="result__disclaimer">{SERVICE_DISCLAIMER}</p>
          </TabPanel>
          <TabPanel tab="stores" selected={tab} idBase={idBase}>
            {nearby ?? <p className="result-section__empty">점포 목록이 없습니다.</p>}
          </TabPanel>
          <TabPanel tab="evidence" selected={tab} idBase={idBase}>
            <IndicatorDetails
              indicators={result.지표}
              summary={result.종합}
              meta={result.meta}
              openRequest={openRequest}
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
        </div>
      </article>
    </TabRevealContext.Provider>
  )
}

const LABELS = /(시장성|고객성|경쟁성|입지성|안정성)/

/** 헤드라인 글자에서 관점 이름만 굵게, "가장 높고" 앞의 이름은 주색 (시안 .headline b / .hi). 문장은 바꾸지 않는다 */
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
