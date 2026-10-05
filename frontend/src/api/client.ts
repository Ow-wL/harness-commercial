/**
 * Backend API 호출 (TASKS 4-4). frontend는 이 두 경로만 부른다: GET /businesses, POST /analyze.
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
  type AnalyzeResponse,
  type BusinessCatalog,
  type ErrorResponse,
} from './schemas.ts'

export type ApiFailure =
  | { kind: 'api'; status: number; error: ErrorResponse['error'] }      // backend 오류 계약 응답 (422·500)
  | { kind: 'network' }                                                // 응답 없음
  | { kind: 'schema'; endpoint: string; status: number }               // 응답이 계약과 다름

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure }

/** POST /analyze 요청 body (backend AnalyzeRequest 중 이 화면이 쓰는 필드). */
export type AnalyzeRequest = { lat: number; lng: number; biz_code: string }

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
    return parsed.success ? { ok: true, data: parsed.data } : schemaFailure(endpoint, res.status, parsed.error.issues)
  }
  const err = ErrorResponseSchema.safeParse(body)
  if (err.success) return { ok: false, failure: { kind: 'api', status: res.status, error: err.data.error } }
  return schemaFailure(endpoint, res.status, err.error.issues)
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
