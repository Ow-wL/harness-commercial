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

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNullableNumber = (v: unknown): v is number | null => v === null || isFiniteNumber(v)
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string'

/**
 * 저장 항목 전체 스키마 검증 (12-28-R4): 화면이 읽는 모든 필드(좌표·반경·점수·관점 원소·점포 수·확인 필요·버전·메모)를 확인한다.
 * 손상·부분·옛 형식 항목은 통째로 버린다 — 보관함 모달이 formatScore·toLocaleString 에서 예외를 내지 않게.
 */
export function isSite(v: unknown): v is SavedSite {
  if (!isRecord(v)) return false
  const { conditions: c, snapshot: snap, versions } = v
  if (typeof v.id !== 'string' || typeof v.key !== 'string' || typeof v.savedAt !== 'string' || typeof v.memo !== 'string') return false
  if (!isRecord(c) || !isFiniteNumber(c.lat) || !isFiniteNumber(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) return false
  if (typeof c.biz !== 'string' || typeof c.bizName !== 'string' || !(c.radius === null || (isFiniteNumber(c.radius) && c.radius > 0))) return false
  if (!isRecord(snap) || typeof snap.locationName !== 'string' || !isNullableNumber(snap.overall) || !isFiniteNumber(snap.stores)) return false
  if (!Array.isArray(snap.perspectives)) return false
  if (!snap.perspectives.every((p) => isRecord(p) && typeof p.key === 'string' && typeof p.label === 'string' && isNullableNumber(p.score))) return false
  if (!Array.isArray(snap.gaps) || !snap.gaps.every((g) => typeof g === 'string')) return false
  if (!isRecord(versions) || !isNullableString(versions.data) || typeof versions.engine !== 'string') return false
  return true
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
