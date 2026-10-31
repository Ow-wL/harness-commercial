/**
 * 역 이름 자동완성 (R1 13-17, 팀 점검 보고서 C3 확장 대응): 엔진이 읽은 인천권 역 211개(GET /stations)를 한 번만 받아 두고
 * 입력 앞부분으로 찾는다. 외부 API 없음. 결과는 좌표 선택일 뿐(행정동 판정은 backend 그대로). 서버가 /stations 를 모르면(구버전) 빈 목록.
 */
import { fetchStations } from '../api/client.ts'
import type { Station } from '../api/schemas.ts'

let cache: Promise<readonly Station[]> | null = null

/** 1회 로드(실패하면 다음 호출에서 다시 시도) */
export function loadStations(): Promise<readonly Station[]> {
  if (!cache) {
    cache = fetchStations().then((r) => {
      if (!r.ok) {
        cache = null
        return []
      }
      return r.data.stations
    })
  }
  return cache
}

/** 테스트용: 캐시 비우기 */
export function resetStationsCache() {
  cache = null
}

const norm = (s: string) => s.replace(/\s+/g, '').replace(/역$/, '')

/** 정확히 같은 이름 → 앞부분 일치 → 포함 일치 순, 최대 limit. 빈 질의는 빈 목록 ("부평역"이 "부평구청역"보다 먼저 — Codex R1 검수) */
export function matchStations(stations: readonly Station[], query: string, limit = 6): Station[] {
  const q = norm(query.trim())
  if (q.length === 0) return []
  const exact = stations.filter((s) => norm(s.name) === q)
  const starts = stations.filter((s) => norm(s.name) !== q && norm(s.name).startsWith(q))
  const includes = stations.filter((s) => !norm(s.name).startsWith(q) && norm(s.name).includes(q))
  return [...exact, ...starts, ...includes].slice(0, limit)
}
