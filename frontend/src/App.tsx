import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze, fetchBusinesses, fetchNearbyStores, type AnalyzeRequest, type ApiFailure } from './api/client.ts'
import type { AnalyzeResponse } from './api/schemas.ts'
import { AnalysisResult } from './components/AnalysisResult.tsx'
import { AnalysisEmpty, AnalysisLoading } from './components/AnalysisStatus.tsx'
import { ComparePanel, CompareSheet } from './components/ComparePanel.tsx'
import { ConditionPanel, type BusinessesState } from './components/ConditionPanel.tsx'
import { ContextBar } from './components/ContextBar.tsx'
import { ErrorBlock } from './components/ErrorBlock.tsx'
import { LocationSummary } from './components/LocationSummary.tsx'
import { MapView, type LatLng, type MapStore } from './components/MapView.tsx'
import { NearbyStores, type NearbyState } from './components/NearbyStores.tsx'
import { COMPARE_IDS, sameCoordinates, type CompareState } from './lib/compareState.ts'
import { errorView, type ErrorAction } from './lib/errorView.ts'
import { formatDistance, locationName, nearestStation, storeAddress, storeName } from './lib/format.ts'
import './App.css'

type Analysis =
  | { status: 'idle' }
  | { status: 'loading'; request: AnalyzeRequest }
  | { status: 'success'; request: AnalyzeRequest; response: AnalyzeResponse }
  | { status: 'error'; request: AnalyzeRequest; failure: ApiFailure }

/** mobile(<640px)에서 지금 보이는 화면 (DESIGN.md §14). desktop·tablet에서는 무시된다 */
type MobileScreen = 'map' | 'panel'

/** mobile(<640px) 화면인지 — 포커스를 옮길 대상(패널 / 지도 화면 sheet)을 고를 때만 쓴다 */
const isMobile = () => window.matchMedia?.('(max-width: 639px)').matches ?? false

/** 분석 불가 지점은 회색 마커·반경 없음 (§8.11, §10.3) */
const INVALID_LOCATION_CODES = new Set(['invalid_coordinate', 'location_outside', 'no_data_nearby'])

/**
 * 응답이 보낸 요청과 같은 조건인지 확인한다. backend는 요청 좌표를 context에 그대로 돌려주고
 * 업종코드를 meta에 둔다. 다르면 다른 조건의 결과를 보여 주는 것이므로 계약 오류로 다룬다.
 */
function matchesRequest(res: AnalyzeResponse, req: AnalyzeRequest): boolean {
  return res.context.lat === req.lat && res.context.lng === req.lng && res.result.meta.업종코드 === req.biz_code
}

function App() {
  const [businesses, setBusinesses] = useState<BusinessesState>({ status: 'loading' })
  const [businessesLoad, setBusinessesLoad] = useState(0)
  const [location, setLocation] = useState<LatLng | null>(null)
  const [bizCode, setBizCode] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis>({ status: 'idle' })
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>('map')
  // 반경 안 동종 점포 (4차): 분석 성공 뒤 같은 좌표·업종으로 따로 조회한다. null = 분석 결과 없음
  const [nearby, setNearby] = useState<NearbyState | null>(null)
  const [showStores, setShowStores] = useState(true)
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null)
  // 두 위치 비교 (5차, docs/COMPARE_DESIGN.md 3장): A = 위 analysis 그대로, B만 따로 둔다
  const [compare, setCompare] = useState<CompareState>({ status: 'off' })
  // 비교 화면 전환 뒤 포커스를 옮길 요소 id (렌더 뒤에 옮긴다)
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null)
  const focusLater = (id: string) => setFocusRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }))

  // GET /businesses — 업종 목록은 API에서만 받는다
  useEffect(() => {
    const ac = new AbortController()
    fetchBusinesses(ac.signal)
      .then((r) => setBusinesses(r.ok ? { status: 'ready', catalog: r.data } : { status: 'error', failure: r.failure }))
      .catch(() => {})                                     // 취소된 요청
    return () => ac.abort()
  }, [businessesLoad])

  const reloadBusinesses = () => {
    setBusinesses({ status: 'loading' })
    setBusinessesLoad((n) => n + 1)
  }

  // 진행 중인 분석: 조건이 바뀌면 취소하고, 늦게 온 응답은 버린다 (이전 결과와 새 조건이 섞이지 않게)
  const inflight = useRef<{ seq: number; controller: AbortController } | null>(null)
  const seq = useRef(0)

  // 동종 점포 요청도 같은 방식: 조건이 바뀌면 취소·제거하고, 늦게 온 이전 요청 응답은 버린다
  const nearbyInflight = useRef<{ seq: number; controller: AbortController } | null>(null)
  const nearbySeq = useRef(0)

  const cancelNearby = () => {
    nearbyInflight.current?.controller.abort()
    nearbyInflight.current = null
    setNearby(null)
    setActiveStoreId(null)
  }

  const loadNearby = useCallback((request: AnalyzeRequest) => {
    nearbyInflight.current?.controller.abort()
    const current = { seq: ++nearbySeq.current, controller: new AbortController() }
    nearbyInflight.current = current
    setNearby({ status: 'loading' })
    setActiveStoreId(null)

    fetchNearbyStores(request, current.controller.signal)
      .then((r) => {
        if (nearbyInflight.current?.seq !== current.seq) return
        nearbyInflight.current = null
        if (!r.ok) {
          setNearby({ status: 'error', failure: r.failure })
        } else if (r.data.lat !== request.lat || r.data.lng !== request.lng || r.data.biz_code !== request.biz_code) {
          console.error('[api] /nearby-stores 응답 조건이 요청과 다릅니다', { request, data: r.data })
          setNearby({ status: 'error', failure: { kind: 'schema', endpoint: '/nearby-stores', status: 200 } })
        } else {
          setNearby({ status: 'success', data: r.data })
        }
      })
      .catch(() => {})                                     // 취소된 요청
  }, [])

  // B 분석 요청: A와 다른 AbortController·요청 번호. 취소·종료·조건 변경 뒤 도착한 응답은 seq가 달라 버린다
  const compareInflight = useRef<{ seq: number; controller: AbortController } | null>(null)
  const compareSeq = useRef(0)

  const resetCompare = () => {
    compareInflight.current?.controller.abort()
    compareInflight.current = null
    setCompare({ status: 'off' })
  }

  const cancelAnalysis = () => {
    inflight.current?.controller.abort()
    inflight.current = null
    setAnalysis({ status: 'idle' })
    cancelNearby()
    resetCompare()                                         // A가 없으면 비교도 없다
  }

  const runAnalysis = useCallback(() => {
    if (!location || !bizCode) return
    inflight.current?.controller.abort()
    const request: AnalyzeRequest = { lat: location.lat, lng: location.lng, biz_code: bizCode }
    const current = { seq: ++seq.current, controller: new AbortController() }
    inflight.current = current
    setAnalysis({ status: 'loading', request })
    cancelNearby()
    resetCompare()

    analyze(request, current.controller.signal)
      .then((r) => {
        if (inflight.current?.seq !== current.seq) return
        inflight.current = null
        if (!r.ok) {
          setAnalysis({ status: 'error', request, failure: r.failure })
        } else if (!matchesRequest(r.data, request)) {
          console.error('[api] /analyze 응답 조건이 요청과 다릅니다', { request, context: r.data.context })
          setAnalysis({ status: 'error', request, failure: { kind: 'schema', endpoint: '/analyze', status: 200 } })
        } else {
          setAnalysis({ status: 'success', request, response: r.data })
          setMobileScreen('panel')
          loadNearby(request)                              // 실패해도 분석 결과는 그대로 둔다
        }
      })
      .catch(() => {})                                     // 취소된 요청
  }, [location, bizCode, loadNearby])

  const analyzing = analysis.status === 'loading'
  const comparing = compare.status !== 'off'

  // ─── 두 위치 비교 (B) ───────────────────────────────────────────
  /** B 위치 고르기로 (시작·다시 고르기). desktop은 B 카드 제목, mobile은 지도 화면 sheet로 포커스 */
  const pickB = () => {
    compareInflight.current?.controller.abort()
    compareInflight.current = null
    setCompare({ status: 'picking', location: null })
    setActiveStoreId(null)                                 // 비교 중에는 A 점포 선택·정보창을 닫는다(A 점포 데이터는 그대로)
    setMobileScreen('map')
    focusLater(isMobile() ? COMPARE_IDS.sheetAction : COMPARE_IDS.bTitle)
  }

  const startCompare = () => {
    if (analysis.status !== 'success') return
    pickB()
  }

  /** 비교 종료·취소: B만 지우고 A 결과·A 점포 목록으로 돌아간다. 포커스는 "다른 위치와 비교" 버튼 */
  const endCompare = () => {
    resetCompare()
    setMobileScreen('panel')
    focusLater(COMPARE_IDS.start)
  }

  /** 비교 중 지도 클릭·좌표 입력 = B 선택. A는 바꾸지 않는다. B 분석 중에는 무시(D9). 받아들였으면 true */
  const selectCompareLocation = (point: LatLng): boolean => {
    if (compare.status === 'off' || compare.status === 'loading') return false
    setCompare({ status: 'picking', location: point })    // 이전 B 결과·오류는 지운다
    return true
  }

  /**
   * B 좌표 직접 입력 제출(유효한 좌표만 들어온다 — 잘못된 값은 CoordinateForm이 막고 오류를 보인다).
   * 입력란은 B 좌표가 바뀌면 새로 그려져(key) 제출 버튼·입력란이 사라지므로, 렌더 뒤 "B 분석하기"로 포커스를 옮긴다.
   * 지도 클릭(selectCompareLocation 직접)은 포커스를 옮기지 않는다 — 지도를 쓰는 중에 패널로 빼앗지 않게.
   */
  const submitCompareLocation = (point: LatLng) => {
    if (selectCompareLocation(point)) focusLater(COMPARE_IDS.bAnalyze)
  }

  const requestCompare = (point: LatLng) => {
    if (analysis.status !== 'success') return
    if (sameCoordinates(point, analysis.request)) {
      setCompare({ status: 'picking', location: point, sameAsA: true })   // 요청하지 않는다 (D2)
      return
    }
    compareInflight.current?.controller.abort()
    // 업종은 A 요청의 업종으로 고정
    const request: AnalyzeRequest = { lat: point.lat, lng: point.lng, biz_code: analysis.request.biz_code }
    const current = { seq: ++compareSeq.current, controller: new AbortController() }
    compareInflight.current = current
    setCompare({ status: 'loading', location: point })

    analyze(request, current.controller.signal)
      .then((r) => {
        if (compareInflight.current?.seq !== current.seq) return    // 취소·종료·조건 변경·재요청 뒤 늦게 온 응답
        compareInflight.current = null
        setMobileScreen('panel')
        if (!r.ok) {
          setCompare({ status: 'error', location: point, failure: r.failure })
          focusLater(COMPARE_IDS.bError)
        } else if (!matchesRequest(r.data, request)) {
          console.error('[api] /analyze(B) 응답 조건이 요청과 다릅니다', { request, context: r.data.context })
          setCompare({ status: 'error', location: point, failure: { kind: 'schema', endpoint: '/analyze', status: 200 } })
          focusLater(COMPARE_IDS.bError)
        } else {
          setCompare({ status: 'success', location: point, response: r.data })
          focusLater(COMPARE_IDS.title)
        }
      })
      .catch(() => {})                                     // 취소된 요청
  }

  const runCompare = () => {
    if (compare.status === 'picking' && compare.location) requestCompare(compare.location)
  }

  const handleCompareErrorAction = (action: ErrorAction) => {
    if (compare.status !== 'error') return
    switch (action) {
      case 'retry':
        requestCompare(compare.location)                   // 같은 B 좌표·같은 업종, 새 요청 번호
        return
      case 'reselect-location':
        pickB()
        return
      case 'reselect-business':
      case 'reselect-conditions':
        handleErrorAction(action)                          // 비교 안에서는 업종을 바꿀 수 없다 → 비교를 끝내고 조건부터
    }
  }

  const selectLocation = (point: LatLng) => {
    if (analyzing) return                                  // 분석 중 새 선택은 무시 (§8.12)
    if (comparing) {
      selectCompareLocation(point)                         // 비교 중 지도 클릭은 B 선택 (A를 바꾸지 않는다)
      return
    }
    cancelAnalysis()
    setLocation(point)
  }

  const changeBusiness = (code: string) => {
    if (analyzing) return
    cancelAnalysis()
    setBizCode(code || null)
  }

  const mapRef = useRef<HTMLDivElement>(null)
  const pickOnMap = () => {
    setMobileScreen('map')
    mapRef.current?.scrollIntoView?.({ block: 'nearest' })
  }

  const handleErrorAction = (action: ErrorAction) => {
    switch (action) {
      case 'retry':
        runAnalysis()
        return
      case 'reselect-location':
        cancelAnalysis()
        setLocation(null)
        pickOnMap()
        return
      case 'reselect-business':
        cancelAnalysis()
        setBizCode(null)
        reloadBusinesses()
        return
      case 'reselect-conditions':
        cancelAnalysis()
        setLocation(null)
        setBizCode(null)
        pickOnMap()
    }
  }

  // 결과가 나오면 결과 제목으로 포커스를 옮긴다 (스크린리더·키보드 사용자가 새 내용 시작점을 안다)
  useEffect(() => {
    if (analysis.status === 'success') document.getElementById('result-title')?.focus()
  }, [analysis.status])

  // 비교 화면 전환 뒤 포커스 (렌더가 끝난 뒤라 새로 생긴 요소도 찾는다). 오류 블록은 그 안 첫 버튼(행동)으로
  useEffect(() => {
    if (!focusRequest) return
    const el = document.getElementById(focusRequest.id)
    const target = focusRequest.id === COMPARE_IDS.bError ? el?.querySelector<HTMLElement>('button') : el
    target?.focus()
  }, [focusRequest])

  const result = analysis.status === 'success' ? analysis.response : null
  // 지도 마커용 표시 문구. 같은 응답·같은 토글이면 같은 배열(지도가 마커를 다시 만들지 않게)
  const mapStores = useMemo<MapStore[] | null>(
    () =>
      nearby?.status === 'success' && showStores
        ? nearby.data.stores.map((s) => ({
            id: s.id,
            name: storeName(s),
            address: storeAddress(s),
            distance: `직선거리 ${formatDistance(s.distance_m)}`,
            lat: s.lat,
            lng: s.lng,
          }))
        : null,
    [nearby, showStores],
  )
  const selectStore = (id: string | null) => {
    setActiveStoreId(id)
    if (id) setShowStores(true)
  }
  const changeShowStores = (show: boolean) => {
    setShowStores(show)
    if (!show) setActiveStoreId(null)
  }
  const station = result ? nearestStation(result.result.지표) : null
  // mobile sheet: 지금 선택한 좌표가 결과의 좌표와 같을 때만 행정동 이름을 쓴다 (이전 결과 이름이 남지 않게)
  const resultIsForSelection =
    result !== null && location !== null && result.context.lat === location.lat && result.context.lng === location.lng
  const failure = analysis.status === 'error' ? analysis.failure : null
  const failureView = failure ? errorView(failure) : null
  const errorAt = (placement: string) =>
    failure && failureView?.placement === placement ? <ErrorBlock failure={failure} onAction={handleErrorAction} /> : null
  const markerTone =
    failure?.kind === 'api' && INVALID_LOCATION_CODES.has(failure.error.code) ? 'invalid' : 'selected'

  return (
    <div className="app" data-phase={result ? 'result' : 'select'} data-screen={mobileScreen}>
      <header className="app-header">
        <span className="app-header__title">우리동네 상권분석 매니저</span>
        {result && <ContextBar context={result.context} meta={result.result.meta} station={station} />}
        {result && !comparing && (
          <a className="app-header__link" href="#data-sources">
            데이터 출처
          </a>
        )}
      </header>
      <div className="workspace">
        <main className="workspace__panel">
          {result && compare.status !== 'off' ? (
            <ComparePanel
              a={result}
              compare={compare}
              onLocationSubmit={submitCompareLocation}
              onAnalyze={runCompare}
              onErrorAction={handleCompareErrorAction}
              onReselect={pickB}
              onEnd={endCompare}
              onChangeConditions={cancelAnalysis}
              onShowMap={() => {
                setMobileScreen('map')
                focusLater(COMPARE_IDS.sheetAction)
              }}
            />
          ) : result ? (
            <>
              <div className="conditions-summary">
                <LocationSummary context={result.context} station={station} />
                <span className="conditions-summary__actions">
                  <button type="button" className="button-ghost mobile-only" onClick={() => setMobileScreen('map')}>
                    지도 보기
                  </button>
                  <button id={COMPARE_IDS.start} type="button" className="button-ghost" onClick={startCompare}>
                    다른 위치와 비교
                  </button>
                  <button type="button" className="button-ghost" onClick={cancelAnalysis}>
                    조건 변경
                  </button>
                </span>
              </div>
              <AnalysisResult
                analysis={result}
                nearby={
                  nearby && (
                    <NearbyStores
                      key={`${result.context.lat},${result.context.lng},${result.result.meta.업종코드}`}
                      state={nearby}
                      bizName={result.result.meta.업종}
                      radiusM={result.result.meta.분석반경_m}
                      expectedCount={result.result.지표[2].raw.동종점포수}
                      show={showStores}
                      onShowChange={changeShowStores}
                      activeId={activeStoreId}
                      onSelect={selectStore}
                      onRetry={() => analysis.status === 'success' && loadNearby(analysis.request)}
                    />
                  )
                }
              />
            </>
          ) : (
            <div className="intro">
              <h1 className="intro__title">우리동네 상권분석 매니저</h1>
              <p className="intro__lead">인천 158개 행정동 공공데이터로 위치·업종을 비교합니다</p>
              {errorAt('top')}
              <ConditionPanel
                location={location}
                bizCode={bizCode}
                businesses={businesses}
                analyzing={analyzing}
                locked={analyzing}
                locationError={errorAt('location')}
                businessError={errorAt('business')}
                onPickOnMap={pickOnMap}
                onLocationInput={selectLocation}
                onBizChange={changeBusiness}
                onRetryBusinesses={reloadBusinesses}
                onAnalyze={runAnalysis}
              />
              <div className="intro__result">
                {analysis.status === 'loading' && <AnalysisLoading />}
                {errorAt('result')}
                {analysis.status === 'idle' && <AnalysisEmpty />}
              </div>
            </div>
          )}
        </main>
        <div className="workspace__map" ref={mapRef}>
          <MapView
            selected={location}
            markerTone={markerTone}
            dong={result ? { guCode: result.context.gu_code, dongName: result.context.dong_name } : null}
            interactive={!analyzing && compare.status !== 'loading'}
            onSelect={selectLocation}
            // 비교 중에는 A 점포 마커·정보창을 숨긴다(B 위치를 고르는 클릭과 섞이지 않게). A 점포 데이터는 그대로 둔다
            stores={comparing ? null : mapStores}
            activeStoreId={comparing ? null : activeStoreId}
            onStoreSelect={selectStore}
          />
          {/* mobile 지도 화면 하단 sheet (peek): 선택 확인 → 패널로. 비교 중에는 B 선택용 sheet */}
          {result && compare.status !== 'off' ? (
            <CompareSheet
              a={result}
              compare={compare}
              onAnalyze={runCompare}
              onShowPanel={() => {
                setMobileScreen('panel')
                focusLater(COMPARE_IDS.bTitle)
              }}
              onEnd={endCompare}
            />
          ) : (
            <div className="map-sheet mobile-only">
              <p className="map-sheet__text">
                {resultIsForSelection ? (
                  <>
                    <strong>{locationName(result.context)}</strong>
                    {station && (
                      <span className="map-sheet__sub">
                        {' '}
                        · {station.name} 직선거리 {formatDistance(station.distanceM)}
                      </span>
                    )}
                  </>
                ) : location ? (
                  // 분석 전에는 행정동을 모른다(backend가 판정) — 고른 좌표만 보여 준다
                  <>
                    선택됨 · <span className="mono">{location.lat}, {location.lng}</span>
                  </>
                ) : (
                  '지도를 눌러 위치를 고르세요'
                )}
              </p>
              <button
                type="button"
                className={`button ${location ? 'button--primary' : 'button--secondary'}`}
                onClick={() => setMobileScreen('panel')}
              >
                {result ? '결과 보기' : location ? '이 위치로 계속' : '좌표 직접 입력'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
