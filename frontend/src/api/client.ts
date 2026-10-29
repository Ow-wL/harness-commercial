/**
 * Backend API 호출 (TASKS 4-4). frontend는 이 경로만 부른다: GET /businesses, POST /analyze,
 * POST /nearby-stores(4차, 분석 성공 뒤 같은 좌표·업종으로 반경 안 동종 점포), GET /health(8-D3 반경 광고, 9-C4 데이터 메타).
 * 성공 응답 헤더 X-Data-Version(9-C4)은 파싱한 응답 객체에 붙여 둔다(lib/dataVersion.ts).
 * 개발 서버에서는 vite proxy가 같은 경로를 FastAPI로 넘긴다(vite.config.ts).
 *
 * 모든 응답은 schemas.ts의 Zod schema로 검증한다. 검증 실패는 조용히 넘기지 않고
 * `schema` 실패로 돌려주고 console.error에 issue를 남긴다.
 * 오류 분기는 error.code로만 한다(D-014). message는 표시용이다.
 */
import type { z } from 'zod'
import {
  AnalyzeResponseSchema,
  BusinessCatalogSchema,
  ErrorResponseSchema,
  HealthSchema,
  NearbyStoresResponseSchema,
  PlacesResponseSchema,
  type AnalyzeResponse,
  type BusinessCatalog,
  type ErrorResponse,
  type Health,
  type NearbyStoresResponse,
  type PlacesResponse,
} from './schemas.ts'
import { DATA_VERSION_HEADER, stampDataVersion } from '../lib/dataVersion.ts'

export type ApiFailure =
  | { kind: 'api'; status: number; error: ErrorResponse['error'] }      // backend 오류 계약 응답 (422·500)
  | { kind: 'network' }                                                // 응답 없음
  | { kind: 'schema'; endpoint: string; status: number }               // 응답이 계약과 다름

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure }

/**
 * POST /analyze 요청 body (backend AnalyzeRequest 중 이 화면이 쓰는 필드).
 * radius_m(8-D3): 서버가 반경을 2개 이상 광고할 때만 넣는다. 없으면 서버 기본 500m (구버전·새 v0.3 서버에는 보내지 않는다).
 */
export type AnalyzeRequest = { lat: number; lng: number; biz_code: string; radius_m?: number }

/** 요청이 기대하는 분석 반경 (radius_m 이 없으면 서버 기본 500m) */
export const DEFAULT_RADIUS_M = 500
export const requestRadius = (req: AnalyzeRequest): number => req.radius_m ?? DEFAULT_RADIUS_M

function schemaFailure(endpoint: string, status: number, issues: unknown): ApiResult<never> {
  console.error(`[api] ${endpoint} 응답이 schema와 다릅니다 (status ${status})`, issues)
  return { ok: false, failure: { kind: 'schema', endpoint, status } }
}

async function request<T>(endpoint: string, schema: z.ZodType<T>, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(endpoint, init)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e   // 호출한 쪽이 취소한 요청
    return { ok: false, failure: { kind: 'network' } }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    // JSON이 아닌 5xx = backend가 아니라 중간(dev proxy 등)이 낸 응답. backend 500은 항상 JSON 오류 계약이다
    if (res.status >= 500) return { ok: false, failure: { kind: 'network' } }
    return schemaFailure(endpoint, res.status, 'JSON이 아닌 응답')
  }

  if (res.ok) {
    const parsed = schema.safeParse(body)
    return parsed.success
      ? { ok: true, data: stampDataVersion(parsed.data, res.headers.get(DATA_VERSION_HEADER)) }
      : schemaFailure(endpoint, res.status, parsed.error.issues)
  }
  const err = ErrorResponseSchema.safeParse(body)
  if (err.success) return { ok: false, failure: { kind: 'api', status: res.status, error: err.data.error } }
  return schemaFailure(endpoint, res.status, err.error.issues)
}

/** GET /health — 반경 광고(engine, 8-D3)와 데이터 메타(data, 9-C4)를 쓴다. */
export function fetchHealth(signal?: AbortSignal): Promise<ApiResult<Health>> {
  return request('/health', HealthSchema, { signal })
}

export function fetchBusinesses(signal?: AbortSignal): Promise<ApiResult<BusinessCatalog>> {
  return request('/businesses', BusinessCatalogSchema, { signal })
}

export function analyze(body: AnalyzeRequest, signal?: AbortSignal): Promise<ApiResult<AnalyzeResponse>> {
  return request('/analyze', AnalyzeResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

/** GET /places?q= — 장소 이름 검색 프록시(12-14, D-036). 서버가 /health places.enabled 로 광고할 때만 부른다 */
export function searchPlaces(query: string, signal?: AbortSignal): Promise<ApiResult<PlacesResponse>> {
  return request(`/places?${new URLSearchParams({ q: query })}`, PlacesResponseSchema, { signal })
}

/** POST /nearby-stores — body는 분석 요청과 같은 좌표·업종 (backend NearbyStoresRequest). */
export function fetchNearbyStores(body: AnalyzeRequest, signal?: AbortSignal): Promise<ApiResult<NearbyStoresResponse>> {
  return request('/nearby-stores', NearbyStoresResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}
