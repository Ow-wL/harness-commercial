/**
 * 후보 보관함 (계획 1-2, 12-25): 분석한 후보지를 **이 브라우저에만** 최대 SAVED_SITES_MAX 곳 저장한다 (localStorage `savedSites.v1`).
 * 항목 = 조건(좌표·업종·반경) + **저장 당시 결과 스냅샷**(종합·관점 점수·같은 업종 점포 수·확인 필요) + 그때의 데이터 묶음·엔진 + 메모.
 * 화면은 스냅샷을 "저장 당시 결과"로, "같은 조건으로 다시 분석"은 지금 서버의 새 결과로 구분해 보인다 — 스냅샷을 지금 결과처럼
 * 보이지 않는다. 익명이며 좌표 원문 외 개인정보는 없고 서버로 보내지 않는다. 현장 확인 기록(lib/fieldNotes)은 같은 조건 키로 잇는다.
 */
import type { AnalyzeRequest } from '../api/client.ts'
import type { AnalyzeResponse } from '../api/schemas.ts'
import { dataVersionOf } from './dataVersion.ts'
import { gapLines } from './gaps.ts'
import { locationName } from './format.ts'
import { cacheKey } from './resultCache.ts'

export const SAVED_SITES_KEY = 'savedSites.v1'
export const SAVED_SITES_MAX = 3

export type SavedSite = {
  id: string
  /** 조건 키 = lib/resultCache.cacheKey(요청) — 현장 확인 기록과 같은 키 */
  key: string
  savedAt: string
  conditions: { lat: number; lng: number; biz: string; bizName: string; radius: number | null }
  snapshot: {
    locationName: string
    overall: number | null
    perspectives: { key: string; label: string; score: number | null }[]
    stores: number
    gaps: string[]
  }
  versions: { data: string | null; engine: string }
  memo: string
}

export type SaveOutcome = { ok: true; sites: SavedSite[]; updated: boolean } | { ok: false; reason: 'full' | 'storage' }

function isSite(v: unknown): v is SavedSite {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  const c = s.conditions as Record<string, unknown> | undefined
  const snap = s.snapshot as Record<string, unknown> | undefined
  return (
    typeof s.id === 'string' &&
    typeof s.key === 'string' &&
    typeof s.savedAt === 'string' &&
    !!c && typeof c.lat === 'number' && typeof c.lng === 'number' && typeof c.biz === 'string' && typeof c.bizName === 'string' &&
    !!snap && typeof snap.locationName === 'string' && Array.isArray(snap.perspectives) && Array.isArray(snap.gaps) &&
    !!s.versions && typeof (s.versions as Record<string, unknown>).engine === 'string' &&
    typeof s.memo === 'string'
  )
}

export function readSavedSites(): SavedSite[] {
  try {
    const raw = window.localStorage.getItem(SAVED_SITES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSite).slice(0, SAVED_SITES_MAX) : []
  } catch {
    return []
  }
}

function write(sites: SavedSite[]): boolean {
  try {
    window.localStorage.setItem(SAVED_SITES_KEY, JSON.stringify(sites))
    return true
  } catch {
    return false
  }
}

/** 지금 결과로 보관 항목을 만든다 (순수 함수 — 저장하지 않는다). 스냅샷은 엔진 값 그대로 */
export function siteFrom(request: AnalyzeRequest, response: AnalyzeResponse, now: Date = new Date()): SavedSite {
  const { context, result } = response
  return {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    key: cacheKey(request),
    savedAt: now.toISOString(),
    conditions: { lat: request.lat, lng: request.lng, biz: request.biz_code, bizName: result.meta.업종, radius: request.radius_m ?? null },
    snapshot: {
      locationName: locationName(context),
      overall: result.종합.점수,
      perspectives: result.지표.map((i) => ({ key: i.key, label: i.label, score: i.score })),
      stores: result.지표[2].raw.동종점포수,
      gaps: gapLines(response),
    },
    versions: { data: dataVersionOf(response), engine: result.meta.엔진버전 },
    memo: '',
  }
}

/**
 * 저장. 같은 조건 키가 이미 있으면 그 항목의 스냅샷·버전·저장 시각을 지금 결과로 바꾼다(id·메모 유지, updated=true).
 * 새 항목인데 가득 찼으면 저장하지 않는다(full) — 지우는 것은 사용자가 고른다
 */
export function saveSite(sites: readonly SavedSite[], site: SavedSite): SaveOutcome {
  const at = sites.findIndex((s) => s.key === site.key)
  let next: SavedSite[]
  if (at >= 0) {
    const old = sites[at]!
    next = sites.map((s, i) => (i === at ? { ...site, id: old.id, memo: old.memo } : s))
  } else {
    if (sites.length >= SAVED_SITES_MAX) return { ok: false, reason: 'full' }
    next = [site, ...sites]
  }
  return write(next) ? { ok: true, sites: next, updated: at >= 0 } : { ok: false, reason: 'storage' }
}

export function updateSiteMemo(sites: readonly SavedSite[], id: string, memo: string): SavedSite[] {
  const next = sites.map((s) => (s.id === id ? { ...s, memo } : s))
  write(next)
  return next
}

export function removeSite(sites: readonly SavedSite[], id: string): SavedSite[] {
  const next = sites.filter((s) => s.id !== id)
  write(next)
  return next
}

export const savedKeyOf = (request: AnalyzeRequest): string => cacheKey(request)
