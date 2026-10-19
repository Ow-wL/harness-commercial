// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STORE_DOT_MIN_COUNT,
  STORE_GLYPH_BY_CODE,
  STORE_GLYPH_FALLBACK,
  STORE_GLYPH_LABEL,
  STORE_GLYPH_SVG,
  STORE_ICON_MIN_RASTER_ZOOM,
  STORE_MARKER_SIZE,
  STORE_SMALL_ICON_MIN_RASTER_ZOOM,
  storeGlyphFor,
  storeGlyphSvg,
  storeMarkerHtml,
  storeMarkerMode,
  type StoreGlyph,
} from './storeIcons.ts'

// 엔진 29업종 = 루트 golden(v0.3) 파일의 meta.업종코드 (frontend로 복사하지 않고 그 자리에서 읽는다)
const GOLDEN_DIR = fileURLToPath(new URL('../../../tests/golden/v0.3/json/', import.meta.url))
const goldenCodes = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => (JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf-8')) as { meta: { 업종코드: string } }).meta.업종코드)
  .sort()

describe('업종 → 글리프 표 (storeIcons, 계획 2-3)', () => {
  it('엔진 29업종 코드가 모두 표에 있고, 표에는 그 밖의 코드가 없다', () => {
    expect(goldenCodes).toHaveLength(29)
    expect(Object.keys(STORE_GLYPH_BY_CODE).sort()).toEqual(goldenCodes)
  })

  it('글리프는 12개(폴백 store 제외)이고 모두 SVG·이름이 있다', () => {
    const used = new Set(Object.values(STORE_GLYPH_BY_CODE))
    expect(used.size).toBe(12)
    expect(used.has(STORE_GLYPH_FALLBACK)).toBe(false)
    for (const g of [...used, STORE_GLYPH_FALLBACK] as StoreGlyph[]) {
      expect(STORE_GLYPH_SVG[g]).toMatch(/^<(path|circle|rect|line) /)
      expect(STORE_GLYPH_LABEL[g]).toBeTruthy()
    }
  })

  it('모르는 코드·null은 폴백 store', () => {
    expect(storeGlyphFor('I21201')).toBe('coffee')
    expect(storeGlyphFor('R10406')).toBe('gamepad-2')
    expect(storeGlyphFor('X99999')).toBe('store')
    expect(storeGlyphFor(null)).toBe('store')
    expect(storeGlyphFor(undefined)).toBe('store')
  })

  it('SVG 내용은 Lucide 요소·속성만 있고 스크립트·이벤트 속성이 없다 (HTML 문자열로 들어간다)', () => {
    for (const svg of Object.values(STORE_GLYPH_SVG)) {
      expect(svg).not.toMatch(/<(script|img|iframe)|on\w+=|javascript:/i)
      // 허용 요소만
      expect(svg.replace(/<(path|circle|rect|line)\b[^>]*\/>/g, '')).toBe('')
    }
    expect(storeGlyphSvg('coffee')).toMatch(/^<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"/)
    expect(storeGlyphSvg('coffee')).toContain('aria-hidden="true"')
  })
})

describe('표현 전환 규칙 (줌·개수)', () => {
  it('래스터 기준 ≥15 아이콘 / 13~14 작은 아이콘 / ≤12 점', () => {
    expect(STORE_ICON_MIN_RASTER_ZOOM).toBe(15)
    expect(STORE_SMALL_ICON_MIN_RASTER_ZOOM).toBe(13)
    expect(storeMarkerMode(16, 10)).toBe('icon')
    expect(storeMarkerMode(15, 10)).toBe('icon')
    expect(storeMarkerMode(14, 10)).toBe('icon-small')
    expect(storeMarkerMode(13, 10)).toBe('icon-small')
    expect(storeMarkerMode(12, 10)).toBe('dot')
    expect(storeMarkerMode(11, 10)).toBe('dot')
  })

  it('같은 줌에서 N ≥ 80이면 점', () => {
    expect(STORE_DOT_MIN_COUNT).toBe(80)
    expect(storeMarkerMode(16, 79)).toBe('icon')
    expect(storeMarkerMode(16, 80)).toBe('dot')
    expect(storeMarkerMode(13, 230)).toBe('dot')
  })

  it('마커 크기: 아이콘 24/16(선택도 같은 크기, 링만), 점 10 → 선택 14', () => {
    expect(STORE_MARKER_SIZE.icon).toEqual({ normal: 24, active: 24 })
    expect(STORE_MARKER_SIZE['icon-small']).toEqual({ normal: 16, active: 16 })
    expect(STORE_MARKER_SIZE.dot).toEqual({ normal: 10, active: 14 })
  })
})

describe('마커 HTML (storeMarkerHtml)', () => {
  it('점은 기존 클래스 그대로(비어 있는 div), 선택이면 --active', () => {
    expect(storeMarkerHtml('dot', 'coffee', false)).toBe('<div class="map-store-marker"></div>')
    expect(storeMarkerHtml('dot', 'coffee', true)).toBe('<div class="map-store-marker map-store-marker--active"></div>')
  })

  it('아이콘은 --icon(+ --icon-small)과 글리프 SVG, 선택이면 --active가 붙는다', () => {
    const big = storeMarkerHtml('icon', 'coffee', false)
    expect(big).toMatch(/^<div class="map-store-marker map-store-marker--icon"><svg /)
    expect(big).toContain(STORE_GLYPH_SVG.coffee)
    const small = storeMarkerHtml('icon-small', 'pill', true)
    expect(small).toMatch(/^<div class="map-store-marker map-store-marker--icon map-store-marker--icon-small map-store-marker--active">/)
    expect(small).toContain(STORE_GLYPH_SVG.pill)
  })
})
