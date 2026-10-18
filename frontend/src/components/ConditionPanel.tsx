import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ApiFailure } from '../api/client.ts'
import type { BusinessCatalog } from '../api/schemas.ts'
import type { NaverMapsApi } from '../map/naverMaps.ts'
import { useSearchFocusRecovery } from '../lib/useSearchFocusRecovery.ts'
import { AddressSearch } from './AddressSearch.tsx'
import { CoordinateForm } from './CoordinateForm.tsx'
import { Icon } from './Icon.tsx'
import { LocationMethodSwitch, type LocationMethod } from './LocationMethodSwitch.tsx'
import type { LatLng } from './MapView.tsx'
import './ConditionPanel.css'

export type BusinessesState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: BusinessCatalog }
  | { status: 'error'; failure: ApiFailure }

/**
 * 분석 전 패널 (A3 before, DESIGN.md §19.1 · §5.A·§7.1·§7.3·§7.4): "새 분석" 머리 → ① 위치 → ② 업종 → ③ 분석 반경(서버가
 * 반경을 광고할 때만) → 분석하기(패널 아래 고정). 단계 번호는 CSS counter라 라벨 글자에 섞이지 않는다.
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
  hasAddress = false,
  searchApi,
  method,
  methodFocus = 0,
  onMethodChange,
  radiusStep,
  children,
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
  /** 참고 주소 줄이 실제로 그려지는지 (있으면 좌표를 접는다, P3) */
  hasAddress?: boolean
  /** 위치 입력 방법 (P2·P3) — App이 들고 mobile 지도 sheet와 같이 쓴다 */
  method: LocationMethod
  /** mobile 지도 sheet에서 방법을 고르면 올린다 — 그 폼의 첫 입력칸으로 포커스 */
  methodFocus?: number
  onMethodChange: (method: LocationMethod) => void
  /** ③ 분석 반경 (8-D3 RadiusControl — 서버가 반경을 2개 이상 광고할 때만 App이 넘긴다) */
  radiusStep?: ReactNode
  /** 분석하기 위 안내·진행·오류 (App) */
  children?: ReactNode
}) {
  const hintId = useId()
  const missing = !location ? '위치를 먼저 선택하세요' : !bizCode ? '업종을 선택하세요' : null

  return (
    <section className="conditions" aria-label="분석 조건">
      <div className="conditions__head">
        <p className="result__eyebrow">
          <span>새 분석</span>
        </p>
        <h1 id="conditions-title" className="conditions__title">
          어디에, 어떤 가게를 열까요?
        </h1>
        <p className="conditions__lead">
          인천 158개 행정동 공공데이터로 그 자리를 다섯 관점에서 살펴봅니다. 매출이나 성공 확률을 예측하지는 않습니다.
        </p>
      </div>
      <LocationField
        location={location}
        disabled={locked}
        error={locationError}
        address={address}
        hasAddress={hasAddress}
        searchApi={searchApi ?? null}
        method={method}
        methodFocus={methodFocus}
        onMethodChange={onMethodChange}
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
      {radiusStep && <div className="field step">{radiusStep}</div>}
      {children}
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

/**
 * 위치 필드 (§7.4, P2·P3): 선택 요약(참고 주소가 앞, 좌표는 접힘) → 입력 방법 segmented 1줄
 * [지도에서 고르기 │ 주소로 찾기 │ 좌표 입력] → 고른 방법의 안내·폼 하나. 주소·좌표는 지도 클릭의 키보드 대안(§15)으로
 * 지도 클릭과 같은 기능(`onLocationInput`)이다. "주소로 찾기"는 Geocoder 준비 때만(7-B4).
 * 방법은 App이 들고 있다 — mobile 지도 sheet의 같은 segmented가 패널로 와서 그 폼을 바로 연다(`methodFocus`, B5).
 */
function LocationField({
  location,
  disabled,
  error,
  address,
  hasAddress,
  searchApi,
  method,
  methodFocus,
  onMethodChange,
  onPickOnMap,
  onLocationInput,
}: {
  location: LatLng | null
  disabled: boolean
  error?: ReactNode
  /** 선택 요약의 참고 주소 줄 (7-B2). 좌표가 없으면 그리지 않는다 */
  address?: ReactNode
  /** 참고 주소 줄이 실제로 있을 때만 좌표를 접는다 — 주소가 없으면 좌표가 유일한 요약이다 */
  hasAddress: boolean
  searchApi: NaverMapsApi | null
  method: LocationMethod
  /** 바뀔 때마다 고른 방법의 첫 입력칸으로 포커스 (mobile 지도 sheet에서 연 경우) */
  methodFocus: number
  onMethodChange: (method: LocationMethod) => void
  onPickOnMap: () => void
  onLocationInput: (point: LatLng) => void
}) {
  const labelId = useId()
  const methodId = useId()
  const coordsId = useId()
  const [coordsOpen, setCoordsOpen] = useState(false)
  const summaryRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const mapButtonRef = useRef<HTMLButtonElement>(null)
  // Geocoder가 꺼지면 "주소로 찾기"가 없어진다 — 그동안은 지도 안내를 보인다
  const shown: LocationMethod = method === 'address' && !searchApi ? 'map' : method

  // 주소 검색 결과를 고르면 위치 요약으로 포커스 (§10 Q2). 고른 좌표가 그려진 뒤에 옮긴다
  const [focusSummary, setFocusSummary] = useState(0)
  useLayoutEffect(() => {
    if (focusSummary) summaryRef.current?.focus()
  }, [focusSummary])
  const selectFromSearch = (point: LatLng) => {
    onLocationInput(point)
    setFocusSummary((n) => n + 1)
  }

  useLayoutEffect(() => {
    if (methodFocus) bodyRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [methodFocus])

  // SDK 실패로 주소 폼이 포커스를 가진 채 사라지면 지금 눌린 "지도에서 고르기"로 포커스를 옮긴다
  const onSearchFocusLost = useSearchFocusRecovery(searchApi, () => mapButtonRef.current)

  const choose = (next: LocationMethod) => {
    onMethodChange(next)
    if (next === 'map') onPickOnMap()                       // mobile: 지도 화면으로
  }

  return (
    <div className="field step" role="group" aria-labelledby={labelId} data-done={location !== null}>
      <span id={labelId} className="field__label step__title">
        위치
      </span>
      {location && (
        <div ref={summaryRef} className="location__selected" tabIndex={-1}>
          <span className="location__value">
            <Icon name="map-pin" size={14} />
            선택됨
            {!hasAddress && (
              <>
                {' · '}
                <span className="mono">
                  {location.lat}, {location.lng}
                </span>
              </>
            )}
          </span>
          {address}
          {hasAddress && (
            <p className="location__coords">
              <button
                type="button"
                className="location__coords-toggle"
                aria-expanded={coordsOpen}
                aria-controls={coordsId}
                onClick={() => setCoordsOpen((v) => !v)}
              >
                <span className="chevron" data-open={coordsOpen}>
                  <Icon name="chevron-right" size={14} />
                </span>
                좌표
              </button>
              {/* 접혀 있어도 id 대상은 남긴다(aria-controls) */}
              <span id={coordsId} className="mono" hidden={!coordsOpen}>
                {location.lat}, {location.lng}
              </span>
            </p>
          )}
        </div>
      )}
      {error}
      <LocationMethodSwitch
        value={shown}
        addressReady={searchApi !== null}
        disabled={disabled}
        onChange={choose}
        mapButtonRef={mapButtonRef}
      />
      <div ref={bodyRef} id={methodId} className="location__method-body">
        {shown === 'map' && (
          <p className="field__hint">
            {location ? '지도를 다시 누르면 그 자리로 바뀝니다.' : '지도를 눌러 위치를 고르세요.'}
          </p>
        )}
        {shown === 'address' && searchApi && (
          <AddressSearch
            api={searchApi}
            disabled={disabled}
            onSelect={selectFromSearch}
            onFocusLost={onSearchFocusLost}
            embedded
          />
        )}
        {shown === 'coords' && (
          <CoordinateForm id={`${methodId}-coords`} initial={location} disabled={disabled} onSubmit={onLocationInput} />
        )}
      </div>
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
    <div className="field step" data-done={bizCode !== null}>
      <label className="field__label step__title" htmlFor={selectId}>
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
