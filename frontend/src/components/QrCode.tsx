import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/** QR 바깥 여백(칸 수). 표준 권장 4칸 — 흰 바탕 카드 안이라 2칸이면 충분하다 */
const QUIET = 2

/**
 * QR 코드 (13-46 휴대폰으로 이어보기): 글자(공유 링크)를 SVG 한 장으로. 어두운 칸을 한 path 로 그린다.
 * 다크 테마에서도 휴대폰 카메라가 읽도록 늘 흰 바탕·검은 칸이다. 오류 정정 M(약 15%).
 */
export function QrCode({ text, size = 168, label }: { text: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const count = qr.getModuleCount()
    let path = ''
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (qr.isDark(y, x)) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`
      }
    }
    return { n: count + QUIET * 2, d: path }
  }, [text])
  return (
    <svg className="qr-code" viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  )
}
