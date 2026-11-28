import { REGULATED_BUSINESS_CODES } from '../content/regulatedBusinesses.ts'
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import type { ApiFailure } from '../api/client.ts'
import type { BusinessCatalog } from '../api/schemas.ts'
import type { NaverMapsApi } from '../map/naverMaps.ts'
import { useSearchFocusRecovery } from '../lib/useSearchFocusRecovery.ts'
import { AddressSearch } from './AddressSearch.tsx'
import { CoordinateForm } from './CoordinateForm.tsx'
import { Icon } from './Icon.tsx'
import { LocationMethodSwitch, type LocationMethod } from './LocationMethodSwitch.tsx'
import { availableMethod } from '../lib/locationSearch.ts'
import { LocationSearch } from './LocationSearch.tsx'
import { MyLocationButton } from './MyLocationButton.tsx'
import { PlaceSearch } from './PlaceSearch.tsx'
import type { LatLng } from './MapView.tsx'
import { CoachMark, ReplayHelpButton } from './CoachMark.tsx'
import './ConditionPanel.css'

/** 첫 방문 안내 말풍선(묶음 D): 어느 단계 아래에 붙일지와 내용. App이 상태를 들고 넘긴다 */
export type ConditionCoach = {
  step: 'location' | 'business' | 'analyze'
  text: string
  index: { index: number; total: number } | null
  onNext: () => void
  onSkip: () => void
  onDismiss: () => void
}

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
  placesReady = false,
  method,
  methodFocus = 0,
  onMethodChange,
  radiusStep,
  radiusSummary,
  radiusOpen,
  coach = null,
  onReplayHelp,
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
  /** 서버가 장소 이름 검색을 광고하는지 (12-14) — 있을 때만 "장소 이름" 입력 방법 */
  placesReady?: boolean
  /** 위치 입력 방법 (P2·P3) — App이 들고 mobile 지도 sheet와 같이 쓴다 */
  method: LocationMethod
  /** mobile 지도 sheet에서 방법을 고르면 올린다 — 그 폼의 첫 입력칸으로 포커스 */
  methodFocus?: number
  onMethodChange: (method: LocationMethod) => void
  /** ③ 분석 반경 (8-D3 RadiusControl — 서버가 반경을 2개 이상 광고할 때만 App이 넘긴다) */
  radiusStep?: ReactNode
  /** 접힌 반경 줄에 보일 지금 반경 ("500m") */
  radiusSummary?: string
  /** 반경 줄을 펼쳐 둘지 (기본값이 아님·변경 진행·실패) */
  radiusOpen?: boolean
  /** 첫 방문 안내 말풍선 ①~③ (묶음 D). null이면 없음 — 해당 단계 요소 바로 아래 인라인 */
  coach?: ConditionCoach | null
  /** "사용 방법 다시 보기"(머리 오른쪽) — 넘기지 않으면 버튼 없음 */
  onReplayHelp?: () => void
  /** 분석하기 위 안내·진행·오류 (App) */
  children?: ReactNode
}) {
  const hintId = useId()
  const missing = !location ? '위치를 먼저 선택하세요' : !bizCode ? '업종을 선택하세요' : null
  // 13-66(시안 G): 처음에는 두 줄(위치 고르기 · 업종 고르기)만. 줄을 누르면 그 선택 화면이 패널 안에 열리고, 고르면 돌아온다
  const [view, setView] = useState<'main' | 'location' | 'business'>('main')
  const locationRowRef = useRef<HTMLButtonElement>(null)
  const businessRowRef = useRef<HTMLButtonElement>(null)
  // 돌아올 때 그 줄로 포커스 — 돌아올 때마다 새 객체라 effect 가 한 번씩 돈다
  const [returnFocus, setReturnFocus] = useState<{ to: 'location' | 'business' } | null>(null)
  const back = (from: 'location' | 'business') => {
    setView('main')
    setReturnFocus({ to: from })
  }
  useLayoutEffect(() => {
    if (view !== 'main' || !returnFocus) return
    ;(returnFocus.to === 'location' ? locationRowRef : businessRowRef).current?.focus()
  }, [view, returnFocus])
  // 위치가 정해지면(검색·현재 위치·좌표·지도 클릭) 첫 화면으로 돌아온다 — 바뀐 값을 그리는 중에 본다(effect 아님)
  const [seenLocation, setSeenLocation] = useState(location)
  if (seenLocation !== location) {
    setSeenLocation(location)
    if (location && view === 'location') {
      setView('main')
      setReturnFocus({ to: 'location' })
    }
  }
  // mobile 지도 시트에서 검색·좌표 입력을 고르면 위치 화면을 연다(그 입력칸으로 포커스 — LocationField)
  const [seenFocus, setSeenFocus] = useState(methodFocus)
  if (seenFocus !== methodFocus) {
    setSeenFocus(methodFocus)
    if (methodFocus && method !== 'map') setView('location')
  }
  const catalog = businesses.status === 'ready' ? businesses.catalog : null
  const bizName = catalog?.groups.flatMap((g) => g.businesses).find((b) => b.code === bizCode)?.name ?? null
  const coachAt = (step: ConditionCoach['step']) =>
    coach && coach.step === step ? (
      <CoachMark text={coach.text} index={coach.index} last={step === 'analyze'} onNext={coach.onNext} onSkip={coach.onSkip} onDismiss={coach.onDismiss} />
    ) : null

  return (
    <section className="conditions" aria-label="분석 조건">
      {view === 'location' && (
        <div className="pick-view">
          <PickViewHead title="위치 고르기" onBack={() => back('location')} />
          <LocationField
            location={location}
            disabled={locked}
            error={locationError}
            address={address}
            hasAddress={hasAddress}
            searchApi={searchApi ?? null}
            placesReady={placesReady}
            method={method}
            methodFocus={methodFocus + 1}
            onMethodChange={(next) => {
              onMethodChange(next)
              if (next === 'map') back('location')                // 지도를 눌러 고른다 — 첫 화면으로
            }}
            onPickOnMap={onPickOnMap}
            onLocationInput={onLocationInput}
          />
        </div>
      )}
      {view === 'business' && (
        <div className="pick-view">
          <PickViewHead title="업종 고르기" onBack={() => back('business')} />
          <BusinessList
            bizCode={bizCode}
            businesses={businesses}
            disabled={locked}
            onChange={(code) => {
              onBizChange(code)
              back('business')
            }}
            onRetry={onRetryBusinesses}
          />
        </div>
      )}
      {view === 'main' && (
        <>
      <div className="conditions__head">
        <p className="result__eyebrow">
          <span>새 분석</span>
          {onReplayHelp && <ReplayHelpButton onClick={onReplayHelp} />}
        </p>
        {/* 두 줄로 보이지만 읽는 이름은 "어디에 열까요?" (줄바꿈은 CSS) */}
        <h1 id="conditions-title" className="conditions__title conditions__title--g">
          <span>어디에</span> <span>열까요?</span>
        </h1>
      </div>
      <div className="pick-rows">
        <PickRow
          buttonRef={locationRowRef}
          icon="map-pin"
          label="위치"
          empty="위치 고르기"
          value={
            location ? (
              hasAddress ? (
                address
              ) : (
                <span className="location__value">
                  <span className="mono">
                    {location.lat}, {location.lng}
                  </span>
                </span>
              )
            ) : null
          }
          disabled={locked}
          onClick={() => setView('location')}
        />
        {locationError}
        {coachAt('location')}
        <PickRow
          buttonRef={businessRowRef}
          icon="store"
          label="업종"
          empty="업종 고르기"
          value={bizName}
          disabled={locked || !catalog}
          onClick={() => setView('business')}
        />
        {bizCode !== null && REGULATED_BUSINESS_CODES.has(bizCode) && (
          <p className="field__hint field__hint--reg">학교 주변 규제 업종 — 학교 200m 안이면 점수와 별개로 영업 가능 여부를 먼저 확인해야 해요.</p>
        )}
        {businesses.status === 'error' && (
          <div className="field__error-row" role="alert">
            <p className="field__error">
              <Icon name="alert-triangle" size={14} />
              업종 목록을 불러오지 못했습니다
            </p>
            <button type="button" className="button button--secondary" onClick={onRetryBusinesses}>
              다시 시도
            </button>
          </div>
        )}
        {businessError}
        {coachAt('business')}
      </div>
      {/* 13-51(D-049): 반경은 기본값으로 충분한 경우가 많아 한 줄로 접어 둔다 — 지금 적용될 반경은 늘 보이고, 누르면 고를 수 있다.
          기본값이 아니거나 반경 변경이 진행·실패 중이면 펼쳐 둔다(복구 버튼이 숨지 않게) */}
      {radiusStep && (
        <details className="field step step-fold" open={radiusOpen || undefined}>
          <summary className="step-fold__summary">
            <span className="step-fold__label">분석 반경 {radiusSummary}</span>
            <span className="step-fold__action">바꾸기</span>
          </summary>
          {radiusStep}
        </details>
      )}
      {children}
        </>
      )}
      {view === 'main' && (
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
        {coachAt('analyze')}
      </div>
      )}
    </section>
  )
}

/**
 * 위치 필드 (§7.4 → 13-57 §30): 선택 요약(참고 주소가 앞, 좌표는 접힘) → 검색창(되는 대로 늘 보임) → 작은 줄
 * [지도에서 고르기 │ 좌표 입력] → 지도 안내·현재 위치 또는 좌표 폼. 주소·좌표는 지도 클릭의 키보드 대안(§15)으로
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
  placesReady,
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
  placesReady: boolean
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
  const searchRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const mapButtonRef = useRef<HTMLButtonElement>(null)
  // 13-57: 검색창은 되는 대로 늘 보인다(둘 다 → 하나로, 하나만 → 그것). 패널이 고르는 것은 좌표 입력을 펼칠지뿐이다 —
  // mobile 지도 sheet가 검색 방법을 골라 넘어오면(methodFocus) 그 검색창으로 포커스만 옮긴다
  const shown: LocationMethod = availableMethod(method, searchApi !== null, placesReady)
  const coordsShown = shown === 'coords'

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
    if (!methodFocus) return
    // 13-66: 위치 화면을 열면 검색창으로(좌표 입력을 골랐을 때만 좌표 폼으로)
    const box = shown === 'coords' ? bodyRef.current : (searchRef.current?.querySelector('input') ? searchRef.current : bodyRef.current)
    box?.querySelector<HTMLInputElement>('input')?.focus()
    // 포커스는 방법을 고른 그 순간에만 옮긴다 — shown 이 나중에 바뀌어도(SDK 준비 등) 다시 옮기지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div ref={searchRef} className="location__search">
        {searchApi && placesReady && (
          <LocationSearch api={searchApi} disabled={disabled} onSelect={selectFromSearch} onFocusLost={onSearchFocusLost} />
        )}
        {searchApi && !placesReady && (
          <AddressSearch api={searchApi} disabled={disabled} onSelect={selectFromSearch} onFocusLost={onSearchFocusLost} embedded placesReady={false} />
        )}
        {!searchApi && placesReady && <PlaceSearch disabled={disabled} onSelect={selectFromSearch} embedded />}
      </div>
      <LocationMethodSwitch
        value={shown}
        addressReady={searchApi !== null}
        placesReady={placesReady}
        disabled={disabled}
        onChange={choose}
        mapButtonRef={mapButtonRef}
        quiet
      />
      <div ref={bodyRef} id={methodId} className="location__method-body">
        {!coordsShown && (
          <>
            <p className="field__hint">
              {location ? '지도를 다시 누르면 그 자리로 바뀝니다.' : '지도를 눌러 위치를 고르세요.'}
            </p>
            {/* 13-50: 지금 있는 자리를 바로 고른다 — 좌표 입력과 같은 선택 경로 */}
            <MyLocationButton disabled={disabled} onLocate={onLocationInput} />
          </>
        )}
        {coordsShown && (
          <CoordinateForm id={`${methodId}-coords`} initial={location} disabled={disabled} onSubmit={onLocationInput} />
        )}
      </div>
    </div>
  )
}

/** 첫 화면의 큰 줄 하나 (13-66, 시안 G): 고르기 전에는 "위치 고르기", 고른 뒤에는 작은 라벨 + 고른 값. 줄 전체가 버튼(::after) */
function PickRow({
  buttonRef,
  icon,
  label,
  empty,
  value,
  disabled,
  onClick,
}: {
  buttonRef: Ref<HTMLButtonElement>
  icon: 'map-pin' | 'store'
  label: string
  empty: string
  value: ReactNode
  disabled: boolean
  onClick: () => void
}) {
  const done = value !== null && value !== undefined && value !== false
  return (
    <div className="pick-row" data-done={done}>
      <span className="pick-row__icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span className="pick-row__text">
        <button ref={buttonRef} type="button" className="pick-row__button" disabled={disabled} onClick={onClick}>
          {done ? <span className="pick-row__label">{label} 바꾸기</span> : empty}
        </button>
        {done && <span className="pick-row__value">{value}</span>}
      </span>
      <span className="pick-row__go" aria-hidden="true">
        <Icon name="chevron-right" size={20} />
      </span>
    </div>
  )
}

function PickViewHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="pick-view__head">
      <button type="button" className="pick-view__back" onClick={onBack} aria-label="처음 화면으로">
        <span aria-hidden="true">‹</span>
      </button>
      <h2 className="pick-view__title">{title}</h2>
    </div>
  )
}

/** 업종 고르기 화면 (13-66): GET /businesses 그대로(그룹·순서) 알약 버튼. 고른 것은 aria-pressed */
function BusinessList({
  bizCode,
  businesses,
  disabled,
  onChange,
  onRetry,
}: {
  bizCode: string | null
  businesses: BusinessesState
  disabled: boolean
  onChange: (code: string) => void
  onRetry: () => void
}) {
  if (businesses.status === 'loading') return <p className="field__hint">업종 불러오는 중…</p>
  if (businesses.status === 'error')
    return (
      <div className="field__error-row" role="alert">
        <p className="field__error">
          <Icon name="alert-triangle" size={14} />
          업종 목록을 불러오지 못했습니다
        </p>
        <button type="button" className="button button--secondary" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    )
  return (
    <div className="biz-list">
      {businesses.catalog.groups.map((g) => (
        <section key={g.code} className="biz-list__group" aria-label={g.name}>
          <h3 className="biz-list__name">{g.name}</h3>
          <div className="biz-list__items">
            {g.businesses.map((b) => (
              <button
                key={b.code}
                type="button"
                className="biz-list__item"
                aria-pressed={b.code === bizCode}
                disabled={disabled}
                onClick={() => onChange(b.code)}
              >
                {b.name}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
