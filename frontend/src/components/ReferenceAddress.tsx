import { useLayoutEffect, useRef } from 'react'
import { keepFocusInView } from '../lib/keepFocusInView.ts'
import type { LatLngPoint } from '../map/geocoder.ts'
import type { SdkState } from '../map/naverMaps.ts'
import { useReferenceAddress } from '../lib/useReferenceAddress.ts'
import './ReferenceAddress.css'

/**
 * 참고 주소 한 줄 (DESIGN.md §8.5b, docs/ADDRESS_DESIGN.md §5.2 B): `참고 주소 · {도로명 또는 지번} (NAVER 지도)`.
 * 성공했을 때만 그린다 — 로딩·오류·주소 없음·SDK 미준비/실패에서는 아무것도 없다(기존 행정동·최근접역·좌표 표시가 그대로 남는다).
 * 분석 행정동·Context Bar·제목은 건드리지 않는다. 단일 위치(7-B2)와 비교 B 카드·A/B 카드·전체 결과(7-B3)가 같은 컴포넌트를 쓴다.
 */
export function ReferenceAddress({ sdk, point, className }: { sdk: SdkState; point: LatLngPoint | null; className?: string }) {
  const address = useReferenceAddress(sdk, point)
  const text = address?.roadAddress ?? address?.jibunAddress ?? null
  // 줄이 늦게 생겨 아래의 포커스 요소(예: "B 분석하기")가 화면 밖으로 밀리면 밀린 만큼만 되돌린다 (keepFocusInView)
  const ref = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    if (ref.current) keepFocusInView(ref.current)
  }, [text])
  if (!text) return null
  return (
    <p ref={ref} className={`reference-address${className ? ` ${className}` : ''}`} data-testid="reference-address">
      <span className="reference-address__label">참고 주소</span> · {text}{' '}
      <span className="reference-address__source">(NAVER 지도)</span>
    </p>
  )
}
