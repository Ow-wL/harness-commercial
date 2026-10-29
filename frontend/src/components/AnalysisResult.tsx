import { useState, type ReactNode } from 'react'
import type { AnalyzeResponse } from '../api/schemas.ts'
import { singleBand } from '../lib/attentionBand.ts'
import { dataVersionLabel, dataVersionOf, ResultDataVersionContext } from '../lib/dataVersion.ts'
import { formatDistance, formatRadius, locationName, nearestStation } from '../lib/format.ts'
import { headline } from '../lib/headline.ts'
import { AttentionBand } from './AttentionBand.tsx'
import { BeginnerAccess } from './BeginnerAccess.tsx'
import { CoverageMeta } from './CoverageMeta.tsx'
import { DataSources, SERVICE_DISCLAIMER } from './DataSources.tsx'
import { GapsLine } from './GapsLine.tsx'
import { gapLines } from '../lib/gaps.ts'
import { IndicatorDetails } from './IndicatorDetails.tsx'
import { LocationSummary } from './LocationSummary.tsx'
import { OverallScore } from './OverallScore.tsx'
import { PerspectiveScores } from './PerspectiveScores.tsx'
import { TabRevealContext, useResultTabs, useTabIdBase, type TabDef } from '../lib/resultTabs.ts'
import { TabList, TabPanel } from './ResultTabs.tsx'
import { WarningPanel } from './WarningPanel.tsx'
import './AnalysisResult.css'
import './ResultQuiet.css'

type ResultTab = 'summary' | 'stores' | 'evidence'

/**
 * 분석 결과 패널 (A3, DESIGN.md §19.1·§19.5, docs/UX_REDESIGN.md 2.1).
 * 기본 머리: 위치 제목 · 종합 점수 · "확인 필요" 한 줄(12-20) · 접힌 주의 요약. 역·주소는 위치 정보에서 펼친다.
 * 요약은 다섯 관점 막대 + 근거 한 줄·자료 단위 칩(12-20 안 B, 기본 노출). 설명 함께 보기를 켜면 헤드라인·높음/낮음·충족 정보가 나온다.
 * 탭: 요약(관점을 누르면 상세 근거의 그 관점) · 주변 점포 · 상세 근거
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
  radiusTable,
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
  /** 반경별 비교 표 (12-26, App이 결과 캐시로 만든다 — 서버가 반경을 광고하는 단일 결과에서만) */
  radiusTable?: ReactNode
}) {
  const { context, result } = analysis
  const dataVersion = dataVersionOf(analysis)   // 9-C4: 응답 헤더 X-Data-Version (모르면 null)
  const [explanations, setExplanations] = useState(false)
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
    <ResultDataVersionContext.Provider value={dataVersion}>
    <TabRevealContext.Provider value={reveal}>
      <article className={`result result--quiet${explanations ? ' result--explained' : ''}`}>
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
            {locationName(context)}{' '}
            <span className="visually-hidden">· {result.meta.업종} 분석</span>
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
          <OverallScore summary={result.종합} engineVersion={result.meta.엔진버전} />
          <GapsLine items={gapLines(analysis)} />
          <p className="result__headline">
            <HeadlineText text={headline(result)} />
          </p>
          <AttentionBand lines={singleBand(analysis)} moreTarget="warnings" />
        </div>
        <TabList label="결과 보기" tabs={tabs} selected={tab} onSelect={setTab} idBase={idBase} />
        <div className="result__body">
          <TabPanel tab="summary" selected={tab} idBase={idBase}>
            <div className="result__section-head">
              <span>다섯 관점</span>
              <button
                type="button"
                className="result__explain"
                aria-expanded={explanations}
                onClick={() => setExplanations((v) => !v)}
              >
                {explanations ? '간단히 보기' : '설명 함께 보기'}
              </button>
            </div>
            <PerspectiveScores
              summary={result.종합}
              indicators={result.지표}
              guName={context.gu_name}
              business={result.meta.업종}
              radiusM={result.meta.분석반경_m}
              onOpen={openDetail}
            />
            {radiusTable}
            <div className="result__secondary">
              <CoverageMeta
                summary={result.종합}
                indicators={result.지표}
                group={result.meta.업종그룹}
                access={result.초보자_접근성}
              />
              <p className="result__hint">관점을 누르면 근거를 자세히 볼 수 있습니다.</p>
              <p className="result__disclaimer">{SERVICE_DISCLAIMER}</p>
            </div>
            <p className="result__brief-note">참고 지표 · 순위나 성공 확률이 아닙니다.</p>
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
    </ResultDataVersionContext.Provider>
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
