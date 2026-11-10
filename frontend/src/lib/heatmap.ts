/**
 * 업종별 인천 행정동 점수 지도(13-46, D-045) — scripts/build_heatmap.py 가 만든 public/heatmap.json 을 읽는다.
 * 점수는 서버가 같은 엔진·데이터로 미리 계산한 값 그대로다(화면에서 다시 계산하지 않는다). 파일의 엔진·데이터 버전이
 * 지금 서버(/health)와 다르면 쓰지 않는다 — 다른 버전 점수를 지금 결과처럼 보이지 않게.
 * 처음 쓸 때 한 번만 받는다(초기 번들에 넣지 않음).
 */
import { z } from 'zod'

const HeatmapSchema = z.object({
  engine: z.string(),
  data: z.string(),
  radius_m: z.number(),
  dongs: z.array(z.object({ gu_code: z.string(), gu: z.string(), dong: z.string(), lat: z.number(), lng: z.number() })),
  scores: z.record(z.string(), z.array(z.number().nullable())),
})

export type Heatmap = z.infer<typeof HeatmapSchema>
/** 행정동 경계 feature 열쇠 (`시군구코드|행정동명`, dongBoundary 와 같은 쌍) */
export const dongKey = (guCode: string, dongName: string) => `${guCode}|${dongName}`

/** 한 업종의 동별 점수 + 이름(떠 있는 안내용) */
export type HeatLayer = { biz: string; radiusM: number; scores: ReadonlyMap<string, number | null>; names: ReadonlyMap<string, string> }

let pending: Promise<Heatmap> | null = null

export function loadHeatmap(url = '/heatmap.json'): Promise<Heatmap> {
  pending ??= fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`업종 지도 파일 응답 ${res.status}`)
      return res.json()
    })
    .then((json) => HeatmapSchema.parse(json))
    .catch((e: unknown) => {
      pending = null
      throw e
    })
  return pending
}

/** 테스트용: 받은 파일을 잊는다 */
export function resetHeatmapForTest() {
  pending = null
}

/** 서버(/health)와 같은 엔진·데이터로 만든 파일인지 */
export function heatmapMatches(h: Pick<Heatmap, 'engine' | 'data'>, server: { engine: string | null; data: string | null }): boolean {
  return server.engine !== null && server.data !== null && h.engine === server.engine && h.data === server.data
}

/** 한 업종 층. 그 업종 점수가 파일에 없으면 null */
export function heatLayer(h: Heatmap, biz: string): HeatLayer | null {
  const list = h.scores[biz]
  if (!list) return null
  const scores = new Map<string, number | null>()
  const names = new Map<string, string>()
  h.dongs.forEach((d, i) => {
    const key = dongKey(d.gu_code, d.dong)
    scores.set(key, list[i] ?? null)
    names.set(key, `${d.gu} ${d.dong}`)
  })
  return { biz, radiusM: h.radius_m, scores, names }
}

/**
 * 색 구간 (발산형: 50 = 인천 동네 평균 지점이 가운데 회색, 위는 파랑·아래는 주황). 등급 글자(좋음·보통·약함)와 다른 축이라
 * 등급색을 쓰지 않는다 — 이 지도는 "다른 동네와 견준 상대 위치"만 보인다.
 */
export const HEAT_BINS = [
  { min: 65, label: '65 이상', tone: 'high2' },
  { min: 55, label: '55~65', tone: 'high1' },
  { min: 45, label: '45~55', tone: 'mid' },
  { min: 35, label: '35~45', tone: 'low1' },
  { min: -Infinity, label: '35 미만', tone: 'low2' },
] as const

export type HeatTone = (typeof HEAT_BINS)[number]['tone'] | 'none'

export function heatTone(score: number | null | undefined): HeatTone {
  if (score === null || score === undefined) return 'none'
  return HEAT_BINS.find((b) => score >= b.min)?.tone ?? 'none'
}

/** 점수가 가장 높은 동 n개 (점수 없음 제외, 같으면 이름순) — 전시 모드 안내에 쓴다 */
export function topDongs(layer: HeatLayer, n: number): { key: string; name: string; score: number }[] {
  return [...layer.scores.entries()]
    .filter((e): e is [string, number] => e[1] !== null)
    .map(([key, score]) => ({ key, name: layer.names.get(key) ?? key, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'))
    .slice(0, n)
}
