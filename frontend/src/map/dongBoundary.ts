/**
 * 분석된 행정동 경계 강조용 polygon (DESIGN.md §5.D·§8.12 "분석 완료: 행정동 polygon 강조").
 *
 * source of truth는 backend resolver가 쓰는 같은 파일 data/geo/인천_행정동경계_2026.geojson(D-009)이다.
 * frontend로 복사하지 않고 `?url`로 참조한다(dev는 vite fs.allow, build는 해시된 asset으로 내보냄).
 * 첫 분석 결과가 나올 때 한 번만 받는다(약 600KB, 초기 번들에 넣지 않음).
 *
 * frontend는 행정동을 판정하지 않는다. backend context의 (gu_code, dong_name)과 같은 feature를
 * 찾아 그리기만 한다. 경계 파일의 `시군구코드`·`행정동명`은 runtime panel 표기와 158/158 같고
 * 이 쌍은 유일하다(docs/DATA.md).
 */
import { z } from 'zod'
import boundaryUrl from '../../../data/geo/인천_행정동경계_2026.geojson?url'

const position = z.tuple([z.number(), z.number()])          // GeoJSON (경도, 위도)
const BoundarySchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({ 시군구코드: z.string(), 행정동명: z.string() }),
      geometry: z.object({
        type: z.literal('MultiPolygon'),
        coordinates: z.array(z.array(z.array(position))),
      }),
    }),
  ),
})

type Boundary = z.infer<typeof BoundarySchema>

/** 위도·경도 쌍의 ring 목록. 첫 ring이 외곽, 나머지는 구멍(GeoJSON 규칙 그대로). */
export type DongRings = { lat: number; lng: number }[][]

let pending: Promise<Boundary> | null = null

function loadBoundary(): Promise<Boundary> {
  pending ??= fetch(boundaryUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`행정동 경계 파일 응답 ${res.status}`)
      return res.json()
    })
    .then((json) => BoundarySchema.parse(json))
    .catch((e: unknown) => {
      pending = null
      throw e
    })
  return pending
}

/** backend context의 행정동 경계. 찾지 못하면 null (그리지 않는다). */
export async function findDongRings(guCode: string, dongName: string): Promise<DongRings[] | null> {
  const boundary = await loadBoundary()
  const feature = boundary.features.find(
    (f) => f.properties.시군구코드 === guCode && f.properties.행정동명 === dongName,
  )
  if (!feature) return null
  return feature.geometry.coordinates.map((polygon) =>
    polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
  )
}
