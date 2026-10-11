import { useId, useState, type FormEvent } from 'react'
import { Icon } from './Icon.tsx'
import type { LatLng } from './MapView.tsx'
import './CoordinateForm.css'

/**
 * 위도·경도 입력. JSON 숫자로만 보낸다(backend 요청 검증: 유한한 숫자·범위).
 * 지도 클릭의 키보드 대안(DESIGN.md §15). 조건 패널(위치)과 두 위치 비교(B 위치)가 같이 쓴다 —
 * 제출하면 좌표만 넘기고, 그 좌표로 무엇을 할지(단일 분석 위치 / B 위치)는 부르는 쪽이 정한다.
 */
export function CoordinateForm({
  id,
  initial,
  disabled,
  onSubmit,
  labelPrefix = '',
  submitLabel = '이 좌표로 선택',
}: {
  id: string
  initial: LatLng | null
  disabled: boolean
  onSubmit: (point: LatLng) => void
  /** 라벨 앞에 붙는 말 (예: "B " → "B 위도") */
  labelPrefix?: string
  submitLabel?: string
}) {
  const [lat, setLat] = useState(initial ? String(initial.lat) : '')
  const [lng, setLng] = useState(initial ? String(initial.lng) : '')
  const [invalid, setInvalid] = useState<{ lat?: string; lng?: string }>({})
  const latId = useId()
  const lngId = useId()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const la = Number(lat)
    const ln = Number(lng)
    const next = {
      lat: lat.trim() === '' || !Number.isFinite(la) || la < -90 || la > 90 ? '위도는 -90~90 사이 숫자입니다' : undefined,
      lng: lng.trim() === '' || !Number.isFinite(ln) || ln < -180 || ln > 180 ? '경도는 -180~180 사이 숫자입니다' : undefined,
    }
    setInvalid(next)
    if (!next.lat && !next.lng) onSubmit({ lat: la, lng: ln })
  }

  return (
    <form id={id} className="coords" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={latId}>
          {labelPrefix}위도
        </label>
        <input
          id={latId}
          className="input"
          inputMode="decimal"
          placeholder="예: 37.4894"
          value={lat}
          disabled={disabled}
          aria-invalid={invalid.lat ? true : undefined}
          aria-describedby={invalid.lat ? `${latId}-error` : undefined}
          onChange={(e) => setLat(e.target.value)}
        />
        {invalid.lat && (
          <p id={`${latId}-error`} className="field__error">
            <Icon name="alert-triangle" size={14} />
            {invalid.lat}
          </p>
        )}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={lngId}>
          {labelPrefix}경도
        </label>
        <input
          id={lngId}
          className="input"
          inputMode="decimal"
          placeholder="예: 126.7246"
          value={lng}
          disabled={disabled}
          aria-invalid={invalid.lng ? true : undefined}
          aria-describedby={invalid.lng ? `${lngId}-error` : undefined}
          onChange={(e) => setLng(e.target.value)}
        />
        {invalid.lng && (
          <p id={`${lngId}-error`} className="field__error">
            <Icon name="alert-triangle" size={14} />
            {invalid.lng}
          </p>
        )}
      </div>
      <button type="submit" className="button button--secondary" disabled={disabled}>
        {submitLabel}
      </button>
    </form>
  )
}
