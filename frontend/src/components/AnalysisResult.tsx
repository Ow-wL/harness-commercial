import type { ReactNode } from 'react'
import type { AnalyzeResponse } from '../api/schemas.ts'
import { locationName } from '../lib/format.ts'
import { BeginnerAccess } from './BeginnerAccess.tsx'
import { CoverageMeta } from './CoverageMeta.tsx'
import { DataSources } from './DataSources.tsx'
import { IndicatorDetails } from './IndicatorDetails.tsx'
import { OverallScore } from './OverallScore.tsx'
import { PerspectiveScores } from './PerspectiveScores.tsx'
import { WarningPanel } from './WarningPanel.tsx'
import './AnalysisResult.css'

/**
 * 분석 결과 (DESIGN.md §6 위계, §9 progressive disclosure).
 * 요약(종합·5대 관점·메타) → 주의할 점 → 초보자 접근성 → 반경 안 같은 업종 점포 → 세부 분석(접힘) → 데이터 출처·면책.
 * 입력은 AnalyzeResponseSchema로 검증된 값만 받는다. 엔진 값은 그대로 보여 준다.
 */
export function AnalysisResult({
  analysis,
  nearby,
  titlePrefix,
}: {
  analysis: AnalyzeResponse
  nearby?: ReactNode
  /** 두 위치 비교의 전체 결과 화면에서 "A"·"B" (제목 "B · 남동구 구월3동 · PC방 분석") */
  titlePrefix?: string
}) {
  const { context, result } = analysis

  return (
    <article className="result">
      <h1 id="result-title" className="result__title" tabIndex={-1}>
        {titlePrefix && `${titlePrefix} · `}
        {locationName(context)} · {result.meta.업종} 분석
      </h1>
      <div className="result__summary">
        <OverallScore summary={result.종합} indicators={result.지표} />
        <PerspectiveScores summary={result.종합} indicators={result.지표} />
        <CoverageMeta summary={result.종합} indicators={result.지표} />
      </div>
      <WarningPanel analysis={analysis} />
      <BeginnerAccess access={result.초보자_접근성} />
      {nearby /* 반경 안 같은 업종 점포 (4차, §8.14) — App이 별도 요청 상태와 함께 넘긴다 */}
      <IndicatorDetails indicators={result.지표} summary={result.종합} meta={result.meta} />
      <DataSources meta={result.meta} disclaimer={result.면책} />
    </article>
  )
}
