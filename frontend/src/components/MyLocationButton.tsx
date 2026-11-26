import { useState } from 'react'
import type { LatLng } from './MapView.tsx'
import './MyLocationButton.css'

type State = { status: 'idle' } | { status: 'locating' } | { status: 'error'; message: string }

const MESSAGES = {
  denied: '위치 권한이 꺼져 있습니다. 브라우저 설정에서 허용하거나 지도를 눌러 고르세요.',
  unavailable: '현재 위치를 찾지 못했습니다. 지도를 눌러 고르세요.',
  timeout: '현재 위치를 찾는 데 시간이 너무 걸립니다. 지도를 눌러 고르세요.',
} as const

/**
 * "현재 위치로 고르기" (13-50 3단계): 브라우저 위치 권한으로 지금 있는 자리를 분석 위치로 고른다 — 지도 클릭·좌표 입력과 같은 선택이다.
 * 위치는 이 브라우저에서 한 번 읽어 선택에만 쓰고 따로 저장하지 않는다. 인천 밖이면 분석 단계에서 안내된다(지도·주소 선택과 같은 규칙).
 * 위치 기능이 없는 브라우저에서는 그리지 않는다. 실패는 사유별 문구로 알리고 지도 선택으로 안내한다.
 */
export function MyLocationButton({ disabled, onLocate }: { disabled: boolean; onLocate: (point: LatLng) => void }) {
  const [state, setState] = useState<State>({ status: 'idle' })
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null

  const locate = () => {
    setState({ status: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({ status: 'idle' })
        onLocate({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        const message = err.code === 1 ? MESSAGES.denied : err.code === 3 ? MESSAGES.timeout : MESSAGES.unavailable
        setState({ status: 'error', message })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  return (
    <div className="my-location">
      <button
        type="button"
        className="button-ghost button-ghost--small my-location__button"
        disabled={disabled || state.status === 'locating'}
        onClick={locate}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="8" />
          <path d="M12 1v3M12 20v3M1 12h3M20 12h3" />
        </svg>
        {state.status === 'locating' ? '현재 위치 찾는 중…' : '현재 위치로 고르기'}
      </button>
      {state.status === 'error' && (
        <p className="my-location__error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}
