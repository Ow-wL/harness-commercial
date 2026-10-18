/**
 * 구 경계·인천 외곽선 (묶음 A, DESIGN.md §19.3 경계 위계). 서비스 범위(인천)와 구 구분을 지도에 보여 준다.
 *
 * source of truth는 scripts/build_geo.py가 행정동 경계(data/geo/인천_행정동경계_2026.geojson)를 union해 만든
 * data/geo/인천_시군구경계_2026.geojson(구 11 + 외곽선 1, 매니페스트 보호)이다. dongBoundary.ts와 같이 `?url`로 참조해
 * 지도가 처음 준비될 때 1회 받는다(약 160KB, 초기 번들에 넣지 않음). 자체 구 이름 라벨은 그리지 않는다 — 지명은 NAVER 지도의 것을
 * 쓴다(스파이크 9A: 자체 라벨은 래스터 지도에서 이름이 두 번 보인다).
 *
 * 줌 단계(래스터 기준, GL은 +1 환산): ≤11 외곽선만 · 12~14 외곽선 + 구 경계 · ≥15 구 경계 흐리게(분석 행정동·반경·점포가 주인공)
 */
import { z } from 'zod'
import boundaryUrl from '../../../data/geo/인천_시군구경계_2026.geojson?url'
import type { DongRings } from './dongBoundary.ts'

const position = z.tuple([z.number(), z.number()])          // GeoJSON (경도, 위도)
const BoundarySchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({ kind: z.enum(['gu', 'outline']) }),
      geometry: z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(position))) }),
    }),
  ),
})

export type GuBoundaries = { gu: DongRings[]; outline: DongRings[] }

/** 구 경계 표시 단계 (래스터 기준 zoom) */
export type BoundaryTier = 'outline' | 'gu' | 'gu-faint'

export const GU_TIER_MIN_RASTER_ZOOM = 12
export const GU_FAINT_MIN_RASTER_ZOOM = 15

export function boundaryTier(rasterZoom: number): BoundaryTier {
  if (rasterZoom < GU_TIER_MIN_RASTER_ZOOM) return 'outline'
  if (rasterZoom < GU_FAINT_MIN_RASTER_ZOOM) return 'gu'
  return 'gu-faint'
}

let pending: Promise<GuBoundaries> | null = null

const toRings = (coordinates: [number, number][][][]): DongRings[] =>
  coordinates.map((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))))

/** 구 경계(구마다 MultiPolygon 하나)와 외곽선. 한 번 받으면 재사용한다. 실패하면 다음 호출 때 다시 받는다 */
export function loadGuBoundaries(): Promise<GuBoundaries> {
  pending ??= fetch(boundaryUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`구 경계 파일 응답 ${res.status}`)
      return res.json()
    })
    .then((json) => {
      const fc = BoundarySchema.parse(json)
      const gu: DongRings[] = []
      const outline: DongRings[] = []
      for (const f of fc.features) (f.properties.kind === 'gu' ? gu : outline).push(...toRings(f.geometry.coordinates))
      if (gu.length === 0 || outline.length === 0) throw new Error('구 경계 파일에 구 또는 외곽선이 없다')
      return { gu, outline }
    })
    .catch((e: unknown) => {
      pending = null
      throw e
    })
  return pending
}

/** 테스트 전용 */
export function resetGuBoundariesForTest(): void {
  pending = null
}
