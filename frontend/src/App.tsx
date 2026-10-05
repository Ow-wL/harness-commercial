import { useCallback, useEffect, useRef, useState } from 'react'
import { analyze, fetchBusinesses, type AnalyzeRequest, type ApiFailure } from './api/client.ts'
import type { AnalyzeResponse } from './api/schemas.ts'
import { AnalysisResult } from './components/AnalysisResult.tsx'
import { AnalysisEmpty, AnalysisLoading } from './components/AnalysisStatus.tsx'
import { ConditionPanel, type BusinessesState } from './components/ConditionPanel.tsx'
import { ContextBar } from './components/ContextBar.tsx'
import { ErrorBlock } from './components/ErrorBlock.tsx'
import { MapView, type LatLng } from './components/MapView.tsx'
import { errorView, type ErrorAction } from './lib/errorView.ts'
import './App.css'

type Analysis =
  | { status: 'idle' }
  | { status: 'loading'; request: AnalyzeRequest }
  | { status: 'success'; request: AnalyzeRequest; response: AnalyzeResponse }
  | { status: 'error'; request: AnalyzeRequest; failure: ApiFailure }

/** mobile(<640px)에서 지금 보이는 화면 (DESIGN.md §14). desktop·tablet에서는 무시된다 */
type MobileScreen = 'map' | 'panel'

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

  const cancelAnalysis = () => {
    inflight.current?.controller.abort()
    inflight.current = null
    setAnalysis({ status: 'idle' })
  }

  const runAnalysis = useCallback(() => {
    if (!location || !bizCode) return
    inflight.current?.controller.abort()
    const request: AnalyzeRequest = { lat: location.lat, lng: location.lng, biz_code: bizCode }
    const current = { seq: ++seq.current, controller: new AbortController() }
    inflight.current = current
    setAnalysis({ status: 'loading', request })

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
        }
      })
      .catch(() => {})                                     // 취소된 요청
  }, [location, bizCode])

  const analyzing = analysis.status === 'loading'

  const selectLocation = (point: LatLng) => {
    if (analyzing) return                                  // 분석 중 새 선택은 무시 (§8.12)
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

  const result = analysis.status === 'success' ? analysis.response : null
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
        {result && <ContextBar context={result.context} meta={result.result.meta} />}
        {result && (
          <a className="app-header__link" href="#data-sources">
            데이터 출처
          </a>
        )}
      </header>
      <div className="workspace">
        <main className="workspace__panel">
          {result ? (
            <>
              <div className="conditions-summary">
                <span>
                  선택 좌표 <span className="mono">{result.context.lat}, {result.context.lng}</span>
                </span>
                <span className="conditions-summary__actions">
                  <button type="button" className="button-ghost mobile-only" onClick={() => setMobileScreen('map')}>
                    지도 보기
                  </button>
                  <button type="button" className="button-ghost" onClick={cancelAnalysis}>
                    조건 변경
                  </button>
                </span>
              </div>
              <AnalysisResult analysis={result} />
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
            interactive={!analyzing}
            onSelect={selectLocation}
          />
          {/* mobile 지도 화면 하단 sheet (peek): 선택 확인 → 패널로 */}
          <div className="map-sheet mobile-only">
            <p className="map-sheet__text">
              {location ? (
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
        </div>
      </div>
    </div>
  )
}

export default App
