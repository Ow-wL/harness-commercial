import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ApiFailure } from '../api/client.ts'
import type { BusinessCatalog } from '../api/schemas.ts'
import type { NaverMapsApi } from '../map/naverMaps.ts'
import { AddressSearch } from './AddressSearch.tsx'
import { CoordinateForm } from './CoordinateForm.tsx'
import { Icon } from './Icon.tsx'
import type { LatLng } from './MapView.tsx'
import './ConditionPanel.css'

export type BusinessesState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: BusinessCatalog }
  | { status: 'error'; failure: ApiFailure }

/**
 * 조건 입력 (DESIGN.md §5.A, §7.1·§7.3·§7.4, §8.13): 단계 표시 → 위치 → 업종 → 분석하기.
 * 업종 목록은 GET /businesses 응답 그대로(그룹·순서). 분석 중에는 조건 입력을 잠근다.
 */
export function ConditionPanel({
  location,
  bizCode,
  businesses,
  analyzing,
  locked,
  locationError,
  businessError,
  onPickOnMap,
  onLocationInput,
  onBizChange,
  onRetryBusinesses,
  onAnalyze,
  address,
  searchApi,
}: {
  location: LatLng | null
  bizCode: string | null
  businesses: BusinessesState
  analyzing: boolean
  locked: boolean
  locationError?: ReactNode
  businessError?: ReactNode
  onPickOnMap: () => void
  onLocationInput: (point: LatLng) => void
  onBizChange: (code: string) => void
  onRetryBusinesses: () => void
  onAnalyze: () => void
  /** 선택 좌표의 참고 주소 줄 (7-B2, App이 ReferenceAddress로 넘긴다. 없으면 아무것도 그리지 않는다) */
  address?: ReactNode
  /** Geocoder가 준비된 SDK (7-B4). 있을 때만 "주소로 찾기"를 그린다 — SDK 미준비·Geocoder 없음·실패면 null */
  searchApi?: NaverMapsApi | null
}) {
  const hintId = useId()
  const missing = !location ? '위치를 먼저 선택하세요' : !bizCode ? '업종을 선택하세요' : null

  return (
    <section className="conditions" aria-labelledby="conditions-title">
      <h2 id="conditions-title" className="visually-hidden">
        분석 조건
      </h2>
      <StepIndicator location={location !== null} business={bizCode !== null} />
      <LocationField
        location={location}
        disabled={locked}
        error={locationError}
        address={address}
        searchApi={searchApi ?? null}
        onPickOnMap={onPickOnMap}
        onLocationInput={onLocationInput}
      />
      <BusinessSelect
        bizCode={bizCode}
        businesses={businesses}
        disabled={locked}
        error={businessError}
        onChange={onBizChange}
        onRetry={onRetryBusinesses}
      />
      <div className="conditions__submit">
        <button
          type="button"
          className="button button--primary button--block"
          disabled={missing !== null || analyzing}
          aria-busy={analyzing || undefined}
          aria-describedby={missing ? hintId : undefined}
          onClick={onAnalyze}
        >
          {analyzing && <span className="spinner" aria-hidden="true" />}
          {analyzing ? '분석 중…' : '분석하기'}
        </button>
        {missing && (
          <p id={hintId} className="field__hint">
            {missing}
          </p>
        )}
      </div>
    </section>
  )
}

/** ① 위치 ② 업종 ③ 분석 (§8.13). 현재 단계 accent, 완료 단계 체크, 이후 단계 muted */
function StepIndicator({ location, business }: { location: boolean; business: boolean }) {
  const steps = [
    { label: '위치', done: location },
    { label: '업종', done: business },
    { label: '분석', done: false },
  ]
  const current = steps.findIndex((s) => !s.done)
  return (
    <ol className="steps" aria-label="진행 단계">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={`steps__item${s.done ? ' steps__item--done' : ''}${i === current ? ' steps__item--current' : ''}`}
          aria-current={i === current ? 'step' : undefined}
        >
          {s.done ? <Icon name="check" size={12} /> : <span aria-hidden="true">{'①②③'[i]}</span>}
          {s.label}
          {s.done && <span className="visually-hidden"> (완료)</span>}
        </li>
      ))}
    </ol>
  )
}

/**
 * 위치 필드 (§7.4). 지도에서 고른 좌표를 읽기 전용으로 보여 준다.
 * 키보드 대안(§15): "주소로 찾기"(7-B4, Geocoder 준비 때만)와 "좌표 직접 입력" — 지도 클릭과 같은 기능(`onLocationInput`).
 */
function LocationField({
  location,
  disabled,
  error,
  address,
  searchApi,
  onPickOnMap,
  onLocationInput,
}: {
  location: LatLng | null
  disabled: boolean
  error?: ReactNode
  /** "선택됨 · 좌표" 아래 참고 주소 줄 (7-B2). 좌표가 없으면 그리지 않는다 */
  address?: ReactNode
  searchApi: NaverMapsApi | null
  onPickOnMap: () => void
  onLocationInput: (point: LatLng) => void
}) {
  const labelId = useId()
  const [manualOpen, setManualOpen] = useState(false)
  const manualId = useId()
  const summaryRef = useRef<HTMLSpanElement>(null)
  const manualToggleRef = useRef<HTMLButtonElement>(null)

  // 주소 검색 결과를 고르면 위치 요약으로 포커스 (§10 Q2). 고른 좌표가 그려진 뒤에 옮긴다
  const [focusSummary, setFocusSummary] = useState(0)
  useLayoutEffect(() => {
    if (focusSummary) summaryRef.current?.focus()
  }, [focusSummary])
  const selectFromSearch = (point: LatLng) => {
    onLocationInput(point)
    setFocusSummary((n) => n + 1)
  }

  // SDK 실패로 "주소로 찾기"가 포커스를 가진 채 사라지면 남은 기본 조작("좌표 직접 입력")으로 포커스를 옮긴다
  const searchFocusLost = useRef(false)
  useLayoutEffect(() => {
    if (searchApi || !searchFocusLost.current) return
    searchFocusLost.current = false
    const active = document.activeElement
    if (!active || active === document.body) manualToggleRef.current?.focus()
  }, [searchApi])

  return (
    <div className="field" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="field__label">
        위치
      </span>
      {location ? (
        <>
          <div className="location__selected">
            <span ref={summaryRef} className="location__value" tabIndex={-1}>
              <Icon name="map-pin" size={14} />
              선택됨 · <span className="mono">{location.lat}, {location.lng}</span>
            </span>
            <button type="button" className="button-ghost" disabled={disabled} onClick={onPickOnMap}>
              다시 선택
            </button>
          </div>
          {address}
        </>
      ) : (
        <div className="location__empty">
          <button type="button" className="button button--secondary" disabled={disabled} onClick={onPickOnMap}>
            <Icon name="map-pin" />
            지도에서 위치 선택
          </button>
        </div>
      )}
      {error}
      {searchApi && (
        <AddressSearch
          api={searchApi}
          disabled={disabled}
          onSelect={selectFromSearch}
          onFocusLost={() => {
            searchFocusLost.current = true
          }}
        />
      )}
      <button
        ref={manualToggleRef}
        type="button"
        className="button-ghost button-ghost--small"
        aria-expanded={manualOpen}
        aria-controls={manualId}
        disabled={disabled}
        onClick={() => setManualOpen((v) => !v)}
      >
        <span className="chevron" data-open={manualOpen}>
          <Icon name="chevron-right" />
        </span>
        좌표 직접 입력
      </button>
      {manualOpen && (
        <CoordinateForm id={manualId} initial={location} disabled={disabled} onSubmit={onLocationInput} />
      )}
    </div>
  )
}

/**
 * 업종 선택 (§7.3). native <select> + <optgroup>: 그룹 라벨(API name)·정의 순서 유지, 키보드 동작은
 * native 그대로(↑↓·Enter·Esc·첫 글자), mobile은 OS 선택 sheet. 닫힌 상태 오른쪽에 그룹명(muted).
 */
function BusinessSelect({
  bizCode,
  businesses,
  disabled,
  error,
  onChange,
  onRetry,
}: {
  bizCode: string | null
  businesses: BusinessesState
  disabled: boolean
  error?: ReactNode
  onChange: (code: string) => void
  onRetry: () => void
}) {
  const selectId = useId()
  const catalog = businesses.status === 'ready' ? businesses.catalog : null
  const selectedGroup = catalog?.groups.find((g) => g.businesses.some((b) => b.code === bizCode))

  return (
    <div className="field">
      <label className="field__label" htmlFor={selectId}>
        업종
      </label>
      <div className="select-wrap">
        <select
          id={selectId}
          className="select"
          value={bizCode ?? ''}
          disabled={disabled || !catalog}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {businesses.status === 'loading' && <option value="">업종 불러오는 중…</option>}
          {businesses.status === 'error' && <option value="">업종 목록 없음</option>}
          {catalog && (
            <>
              <option value="" disabled>
                업종 선택
              </option>
              {catalog.groups.map((g) => (
                <optgroup key={g.code} label={g.name}>
                  {g.businesses.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </>
          )}
        </select>
        {selectedGroup && (
          <span className="select-wrap__group" aria-hidden="true">
            {selectedGroup.name}
          </span>
        )}
      </div>
      {businesses.status === 'error' && (
        <div className="field__error-row" role="alert">
          <p className="field__error">
            <Icon name="alert-triangle" size={14} />
            업종 목록을 불러오지 못했습니다
          </p>
          <button type="button" className="button button--secondary" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}
      {error}
    </div>
  )
}
