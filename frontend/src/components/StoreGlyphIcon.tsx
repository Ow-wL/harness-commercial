import { STORE_GLYPH_SVG, type StoreGlyph } from '../lib/storeIcons.ts'

/**
 * 업종 글리프(Lucide, lib/storeIcons) React 요소 — 범례·목록 등 우리 DOM에서 쓴다(지도 마커는 HtmlIcon 문자열 storeMarkerHtml).
 * 내용은 모듈 상수(path·circle·rect·line만)라 그대로 넣는다. 색·stroke 굵기는 CSS(currentColor·stroke-width).
 */
export function StoreGlyphIcon({ glyph, size = 14 }: { glyph: StoreGlyph; size?: number }) {
  return (
    <svg
      className="store-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: STORE_GLYPH_SVG[glyph] }}
    />
  )
}
