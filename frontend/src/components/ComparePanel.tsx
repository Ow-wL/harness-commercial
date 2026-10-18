import { useId, useRef, type ReactNode } from 'react'
import type { AnalyzeResponse } from '../api/schemas.ts'
import { COMPARE_IDS, type ActiveCompare } from '../lib/compareState.ts'
import type { ErrorAction } from '../lib/errorView.ts'
import { useSearchFocusRecovery } from '../lib/useSearchFocusRecovery.ts'
import type { NaverMapsApi } from '../map/naverMaps.ts'
import { AddressSearch } from './AddressSearch.tsx'
import { compareBand } from '../lib/attentionBand.ts'
import { formatScore, locationName } from '../lib/format.ts'
import { BandPeek } from './AttentionBand.tsx'
import { CoordinateForm } from './CoordinateForm.tsx'
import { ErrorBlock } from './ErrorBlock.tsx'
import { Icon } from './Icon.tsx'
import type { LatLng } from './MapView.tsx'
import './ComparePanel.css'

const scoreText = (score: number | null) => (score === null ? '미산출' : formatScore(score))

/** B를 고르는 동안의 상태 (성공하면 App이 비교 요약 CompareResult로 바꾼다) */
type PickingCompare = Exclude<ActiveCompare, { status: 'success' }>

/**
 * 두 위치 비교 — B 고르기 화면 (5차-B2): A 요약 · B 위치 입력 · 진행 상태 · 오류 · 조작 버튼.
 * B 분석이 성공하면 App이 비교 요약(CompareResult, 5차-B3)으로 바꾼다. 이 화면에서는 점포 목록·마커를 두지 않는다(5차-B5).
 * B 업종은 A 업종으로 고정이라 업종 선택이 없다.
 */
export function ComparePanel({
  a,
  compare,
  onLocationSubmit,
  onAnalyze,
  onErrorAction,
  onChangeConditions,
  bAddress,
  searchApi,
  searchResetKey,
}: {
  a: AnalyzeResponse
  compare: PickingCompare
  /** B 좌표 직접 입력 제출 (지도 클릭은 App이 따로 받는다) */
  onLocationSubmit: (point: LatLng) => void
  onAnalyze: () => void
  onErrorAction: (action: ErrorAction) => void
  onChangeConditions: () => void
  /** 지금 B 좌표의 참고 주소 줄 (7-B3, App이 B 좌표로 만든 ReferenceAddress). B 좌표가 없으면 그리지 않는다 */
  bAddress?: ReactNode
  /** Geocoder가 준비된 SDK (7-B5). 있을 때만 B 카드에 "B 주소로 찾기"를 그린다 — 고른 좌표는 `onLocationSubmit`으로 */
  searchApi?: NaverMapsApi | null
  /** B 선택 초기화 세대(App의 pickB마다 바뀜). 바뀌면 B 주소 검색을 새로 그려 진행 중 검색·입력·결과를 버린다 */
  searchResetKey?: number
}) {
  const aTitleId = useId()
  const bCardRef = useRef<HTMLElement>(null)
  const formId = useId()
  const biz = a.result.meta.업종
  const loading = compare.status === 'loading'
  const { location } = compare
  // SDK 실패로 "B 주소로 찾기"가 포커스를 가진 채 사라지면 B 좌표 입력(쓸 수 있으면), 아니면 B 카드 제목으로
  const onSearchFocusLost = useSearchFocusRecovery(
    searchApi,
    () => bCardRef.current?.querySelector<HTMLElement>('input:not(:disabled)') ?? document.getElementById(COMPARE_IDS.bTitle),
  )

  // 진행 알림은 항상 있는 live region에 넣는다 (내용이 바뀔 때 읽히게)
  const live = loading ? 'B 위치 분석 중…' : ''

  return (
    <section className="compare" aria-labelledby={COMPARE_IDS.title}>
      <div className="result__head">
        <div className="result__eyebrow">
          <div className="compare__eyebrow-title">
            <h1 id={COMPARE_IDS.title} className="compare__title" tabIndex={-1}>
              두 위치 비교 · {biz}
            </h1>
            <span> · B 위치 고르기</span>
          </div>
          <button type="button" className="link-button" onClick={onChangeConditions}>
            조건 바꾸기
          </button>
        </div>
        <p className="compare__lead">A 분석 결과는 그대로 두고, 같은 업종({biz})으로 B 위치를 분석합니다.</p>
        <section className="compare__fixed-a" aria-label="A 기준 위치">
          <span className="pin-letter pin-letter--a" aria-hidden="true">
            A
          </span>
          <h2 id={aTitleId} className="compare__fixed-a-title">
            {locationName(a.context)}
          </h2>
          <span className="compare__fixed-a-score">종합 {scoreText(a.result.종합.점수)}</span>
        </section>
      </div>

      <section ref={bCardRef} className="compare__card" aria-labelledby={COMPARE_IDS.bTitle}>
        <h2 id={COMPARE_IDS.bTitle} className="compare__card-title" tabIndex={-1}>
          B 비교 위치
        </h2>

        {location ? (
          <>
            <p className="compare__place">
              <Icon name="map-pin" size={14} />
              선택됨 · <span className="mono">{location.lat}, {location.lng}</span>
            </p>
            {/* 선택·분석 중·오류 모두 같은 B 좌표 → 같은 캐시 키 (분석 성공 뒤 요약의 B 카드도 같은 키) */}
            {bAddress}
          </>
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

        {searchApi && (
          // B 위치 주소 검색: 고르면 좌표 입력 제출과 같은 경로(onLocationSubmit → B만 바뀜, 포커스 "B 분석하기"). 분석은 하지 않는다.
          // key는 B 선택 초기화 세대 — pickB("지도에서 다시 선택" 등)면 새로 그려 진행 중 검색(요청 번호 무효화)·결과를 버린다.
          // 지도 클릭·좌표 입력으로 B 좌표만 바뀔 때는 그대로 둔다(검색어·결과 유지)
          <AddressSearch
            key={searchResetKey}
            api={searchApi}
            disabled={loading}
            labelPrefix="B "
            onSelect={onLocationSubmit}
            onFocusLost={onSearchFocusLost}
          />
        )}
        <CoordinateForm
          // 지도에서 고른 좌표로 입력란을 새로 채운다(좌표가 바뀌면 새로 그린다 → 제출 뒤 포커스는 App이 "B 분석하기"로 옮긴다)
          key={location ? `${location.lat},${location.lng}` : 'empty'}
          id={formId}
          initial={location}
          disabled={loading}
          onSubmit={onLocationSubmit}
          labelPrefix="B "
          submitLabel="B 위치로 선택"
        />
        {/* 오류 상태에서는 숨긴다: 다시 시도·다시 고르기는 오류 블록의 행동 버튼이 맡고, 새 좌표를 고르면 다시 나온다 */}
        {compare.status !== 'error' && (
          <button
            id={COMPARE_IDS.bAnalyze}
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

        <p className="compare__status" aria-live="polite">
          {live}
        </p>
      </section>

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
      {/* 비교 요약의 주의 띠 첫 줄 (8-C1a) */}
      {compare.status === 'success' && <BandPeek lines={compareBand(a, compare.response)} />}
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
