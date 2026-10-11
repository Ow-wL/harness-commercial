import type { LatLngPoint } from '../map/geocoder.ts'
import type { SdkState } from '../map/naverMaps.ts'
import { useReferenceAddress } from '../lib/useReferenceAddress.ts'
import './ReferenceAddress.css'

/**
 * 참고 주소 한 줄 (DESIGN.md §8.5b, docs/ADDRESS_DESIGN.md §5.2 B): `참고 주소 · {도로명 또는 지번} (NAVER 지도)`.
 * 성공했을 때만 그린다 — 로딩·오류·주소 없음·SDK 미준비/실패에서는 아무것도 없다(기존 행정동·최근접역·좌표 표시가 그대로 남는다).
 * 분석 행정동·Context Bar·제목은 건드리지 않는다. 비교 화면 연결은 7-B3(여기서는 단일 위치만 쓴다).
 */
export function ReferenceAddress({ sdk, point, className }: { sdk: SdkState; point: LatLngPoint | null; className?: string }) {
  const address = useReferenceAddress(sdk, point)
  const text = address?.roadAddress ?? address?.jibunAddress ?? null
  if (!text) return null
  return (
    <p className={`reference-address${className ? ` ${className}` : ''}`} data-testid="reference-address">
      <span className="reference-address__label">참고 주소</span> · {text}{' '}
      <span className="reference-address__source">(NAVER 지도)</span>
    </p>
  )
}
