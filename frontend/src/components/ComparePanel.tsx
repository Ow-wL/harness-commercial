import { useId } from 'react'
import type { AnalyzeResponse } from '../api/schemas.ts'
import { COMPARE_IDS, type ActiveCompare } from '../lib/compareState.ts'
import type { ErrorAction } from '../lib/errorView.ts'
import { formatScore, locationName } from '../lib/format.ts'
import { CoordinateForm } from './CoordinateForm.tsx'
import { ErrorBlock } from './ErrorBlock.tsx'
import { Icon } from './Icon.tsx'
import type { LatLng } from './MapView.tsx'
import './ComparePanel.css'

const scoreText = (score: number | null) => (score === null ? '미산출' : formatScore(score))

/**
 * 두 위치 비교 — 최소 조작 화면 (5차-B2): A 요약 · B 위치 입력 · 진행 상태 · 오류 · 성공 확인 · 조작 버튼.
 * 비교 표·전체 결과 전환·지도 A/B 표시·B 동종 점포는 다음 단계(B3~B5)에서 붙인다.
 * B 업종은 A 업종으로 고정이라 업종 선택이 없다.
 */
export function ComparePanel({
  a,
  compare,
  onLocationInput,
  onAnalyze,
  onErrorAction,
  onReselect,
  onEnd,
  onChangeConditions,
  onShowMap,
}: {
  a: AnalyzeResponse
  compare: ActiveCompare
  onLocationInput: (point: LatLng) => void
  onAnalyze: () => void
  onErrorAction: (action: ErrorAction) => void
  onReselect: () => void
  onEnd: () => void
  onChangeConditions: () => void
  onShowMap: () => void
}) {
  const aTitleId = useId()
  const formId = useId()
  const biz = a.result.meta.업종
  const loading = compare.status === 'loading'
  const done = compare.status === 'success'
  const { location } = compare

  // 진행 알림은 항상 있는 live region에 넣는다 (내용이 바뀔 때 읽히게)
  const live =
    compare.status === 'loading'
      ? 'B 위치 분석 중…'
      : compare.status === 'success'
        ? `B 위치 분석을 마쳤습니다: ${locationName(compare.response.context)}`
        : ''

  return (
    <section className="compare" aria-labelledby={COMPARE_IDS.title}>
      <div className="compare__head">
        <h1 id={COMPARE_IDS.title} className="compare__title" tabIndex={-1}>
          두 위치 비교 · {biz}
        </h1>
        <p className="compare__lead">A 분석 결과는 그대로 두고, 같은 업종({biz})으로 B 위치를 분석합니다.</p>
      </div>

      <section className="compare__card" aria-labelledby={aTitleId}>
        <h2 id={aTitleId} className="compare__card-title">
          A 기준 위치
        </h2>
        <p className="compare__place">
          <strong>{locationName(a.context)}</strong> · 종합 {scoreText(a.result.종합.점수)}
        </p>
      </section>

      <section className="compare__card" aria-labelledby={COMPARE_IDS.bTitle}>
        <h2 id={COMPARE_IDS.bTitle} className="compare__card-title" tabIndex={-1}>
          B 비교 위치
        </h2>

        {done ? (
          <p className="compare__place">
            <strong>{locationName(compare.response.context)}</strong> · 종합 {scoreText(compare.response.result.종합.점수)}
          </p>
        ) : location ? (
          <p className="compare__place">
            <Icon name="map-pin" size={14} />
            선택됨 · <span className="mono">{location.lat}, {location.lng}</span>
          </p>
        ) : (
          <p className="compare__hint">지도를 누르거나 아래에 좌표를 입력해 B 위치를 고르세요.</p>
        )}

        {compare.status === 'picking' && compare.sameAsA && (
          <p className="compare__notice" role="alert">
            <Icon name="info" size={14} />
            A와 같은 위치입니다. 다른 위치를 고르세요.
          </p>
        )}

        {compare.status === 'error' && (
          <div id={COMPARE_IDS.bError}>
            <ErrorBlock failure={compare.failure} onAction={onErrorAction} />
          </div>
        )}

        {!done && (
          <>
            <CoordinateForm
              // 지도에서 고른 좌표로 입력란을 새로 채운다
              key={location ? `${location.lat},${location.lng}` : 'empty'}
              id={formId}
              initial={location}
              disabled={loading}
              onSubmit={onLocationInput}
              labelPrefix="B "
              submitLabel="B 위치로 선택"
            />
            {/* 오류 상태에서는 숨긴다: 다시 시도·다시 고르기는 오류 블록의 행동 버튼이 맡고, 새 좌표를 고르면 다시 나온다 */}
            {compare.status !== 'error' && (
              <button
                type="button"
                className="button button--primary button--block"
                disabled={!location || loading}
                aria-busy={loading || undefined}
                onClick={onAnalyze}
              >
                {loading && <span className="spinner" aria-hidden="true" />}
                {loading ? 'B 분석 중…' : 'B 분석하기'}
              </button>
            )}
          </>
        )}

        <p className="compare__status" aria-live="polite">
          {live}
        </p>

        {done && (
          <button type="button" className="button button--secondary" onClick={onReselect}>
            B 위치 다시 고르기
          </button>
        )}
      </section>

      <div className="compare__actions">
        <button type="button" className="button-ghost mobile-only" onClick={onShowMap}>
          지도 보기
        </button>
        <button type="button" className="button-ghost" onClick={onEnd}>
          {done ? '비교 종료' : '비교 취소'}
        </button>
        <button type="button" className="button-ghost" onClick={onChangeConditions}>
          조건 변경
        </button>
      </div>
    </section>
  )
}

/**
 * mobile 지도 화면 하단 sheet — 비교 중 (COMPARE_DESIGN.md 7장). B 위치를 지도에서 고르고 바로 분석한다.
 * 키보드 대안(좌표 입력)은 패널의 B 카드에 있다 — "좌표 직접 입력"이 그리로 보낸다.
 */
export function CompareSheet({
  a,
  compare,
  onAnalyze,
  onShowPanel,
  onEnd,
}: {
  a: AnalyzeResponse
  compare: ActiveCompare
  onAnalyze: () => void
  onShowPanel: () => void
  onEnd: () => void
}) {
  return (
    <div className="map-sheet mobile-only">
      <p className="map-sheet__text" aria-live="polite">
        {compare.status === 'loading' ? (
          'B 위치 분석 중…'
        ) : compare.status === 'success' ? (
          `B ${locationName(compare.response.context)} 분석을 마쳤습니다`
        ) : compare.status === 'error' ? (
          <>
            B 위치를 분석하지 못했습니다
            <span className="map-sheet__sub"> · {compare.location.lat}, {compare.location.lng}</span>
          </>
        ) : compare.location ? (
          <>
            B 선택됨 · <span className="mono">{compare.location.lat}, {compare.location.lng}</span>
          </>
        ) : (
          <>
            B 위치: 지도를 눌러 고르세요<span className="map-sheet__sub"> · A {locationName(a.context)}</span>
          </>
        )}
      </p>
      {compare.status === 'picking' && compare.sameAsA && (
        <p className="map-sheet__sub" role="alert">
          A와 같은 위치입니다. 다른 위치를 고르세요.
        </p>
      )}
      {compare.status === 'picking' && compare.location ? (
        <button id={COMPARE_IDS.sheetAction} type="button" className="button button--primary" onClick={onAnalyze}>
          B 분석하기
        </button>
      ) : compare.status === 'loading' ? (
        <button id={COMPARE_IDS.sheetAction} type="button" className="button button--primary" disabled aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          B 분석 중…
        </button>
      ) : (
        <button id={COMPARE_IDS.sheetAction} type="button" className="button button--secondary" onClick={onShowPanel}>
          {compare.status === 'picking' ? '좌표 직접 입력' : '비교 화면 보기'}
        </button>
      )}
      <button type="button" className="button-ghost" onClick={onEnd}>
        {compare.status === 'success' ? '비교 종료' : '비교 취소'}
      </button>
    </div>
  )
}
