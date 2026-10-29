import type { Ref } from 'react'
import './LocationMethodSwitch.css'

export type LocationMethod = 'map' | 'address' | 'place' | 'coords'

/**
 * 위치 입력 방법 segmented 1줄 (P2·P3, docs/UX_REDESIGN_APPROVAL_DRAFT.md A.5 · DESIGN.md §7.4):
 * [지도에서 고르기 │ 주소로 찾기 │ 장소 이름 │ 좌표 입력] — 각 44px, aria-pressed. "주소로 찾기"는 Geocoder가 준비됐을 때만,
 * "장소 이름"(12-14)은 서버가 /health 로 장소 검색을 광고할 때만 그린다.
 * 무엇을 열지는 부르는 쪽이 정한다(조건 패널: 그 방법의 안내·폼 하나 / mobile 지도 sheet: 패널로 가서 그 폼을 바로 연다).
 */
export function LocationMethodSwitch({
  value,
  addressReady,
  placesReady = false,
  disabled,
  onChange,
  mapButtonRef,
}: {
  value: LocationMethod | null
  addressReady: boolean
  /** 서버가 장소 이름 검색을 광고하는지 (12-14) */
  placesReady?: boolean
  disabled: boolean
  onChange: (method: LocationMethod) => void
  /** 주소 검색이 포커스를 가진 채 사라질 때 포커스를 옮길 곳 (useSearchFocusRecovery) */
  mapButtonRef?: Ref<HTMLButtonElement>
}) {
  const methods: { key: LocationMethod; label: string }[] = [
    { key: 'map', label: '지도에서 고르기' },
    ...(addressReady ? [{ key: 'address' as const, label: '주소로 찾기' }] : []),
    ...(placesReady ? [{ key: 'place' as const, label: '장소 이름' }] : []),
    { key: 'coords', label: '좌표 입력' },
  ]
  return (
    <div className="location-method" role="group" aria-label="위치 입력 방법">
      {methods.map((m) => (
        <button
          key={m.key}
          ref={m.key === 'map' ? mapButtonRef : undefined}
          type="button"
          className="location-method__button"
          aria-pressed={value === m.key}
          disabled={disabled}
          onClick={() => onChange(m.key)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
