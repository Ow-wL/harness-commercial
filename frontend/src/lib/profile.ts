/**
 * 선택형 사용자 프로필 (R2 13-26): 창업 단계·청년(39세 이하)·우대 조건. **이 브라우저에만** localStorage `profile.v1`,
 * 서버에는 AI 질문과 지원사업 공고 조회(13-33) 때만 함께 보낸다. 입력이 없으면 전체(null). AI 가 대화에서 제안한 값은 사용자가 "저장"을 눌러야 저장된다.
 */
import { useEffect, useState } from 'react'
import { PROFILE_PREFERRED, PROFILE_STAGES } from '../api/schemas.ts'

export const PROFILE_KEY = 'profile.v1'
/** 같은 화면 안 다른 곳(지원사업 카드·질문 창)에 프로필이 바뀌었음을 알린다 — storage 이벤트는 다른 탭에만 온다 */
export const PROFILE_EVENT = 'profile.v1:change'
export type Profile = { stage: (typeof PROFILE_STAGES)[number] | null; youth: boolean | null; preferred: (typeof PROFILE_PREFERRED)[number][] }
export const EMPTY_PROFILE: Profile = { stage: null, youth: null, preferred: [] }

const isStage = (v: unknown): v is Profile['stage'] => v === null || (PROFILE_STAGES as readonly unknown[]).includes(v)
const isPref = (v: unknown): v is Profile['preferred'][number] => (PROFILE_PREFERRED as readonly unknown[]).includes(v)

/** 저장값 → Profile (깨진 값·목록 밖 값은 버린다) */
export function normalizeProfile(v: unknown): Profile {
  if (!v || typeof v !== 'object') return EMPTY_PROFILE
  const r = v as Record<string, unknown>
  return {
    stage: isStage(r.stage) ? r.stage : null,
    youth: typeof r.youth === 'boolean' ? r.youth : null,
    preferred: Array.isArray(r.preferred) ? [...new Set(r.preferred.filter(isPref))] : [],
  }
}

export function readProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    return raw ? normalizeProfile(JSON.parse(raw)) : EMPTY_PROFILE
  } catch {
    return EMPTY_PROFILE
  }
}

export function writeProfile(p: Profile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    // 저장이 막혀 있어도 이번 화면에서는 쓴다
  }
  window.dispatchEvent(new CustomEvent<Profile>(PROFILE_EVENT, { detail: p }))
}

export const isEmptyProfile = (p: Profile) => p.stage === null && p.youth === null && p.preferred.length === 0

/** 질문 요청 본문용 — 비어 있으면 null(서버에 아무것도 보내지 않는다) */
export const profileBody = (p: Profile) => (isEmptyProfile(p) ? null : { stage: p.stage, youth: p.youth, preferred: p.preferred.length ? p.preferred : null })

/** AI 제안을 지금 프로필에 합친다(제안이 null 인 칸은 그대로) */
export function mergeSuggestion(p: Profile, s: { stage: string | null; youth: boolean | null; preferred: string[] | null }): Profile {
  return normalizeProfile({
    stage: s.stage ?? p.stage,
    youth: s.youth ?? p.youth,
    preferred: s.preferred ? [...p.preferred, ...s.preferred] : p.preferred,
  })
}

/** 지금 프로필 + 바뀌면 다시 그린다(같은 탭의 writeProfile 알림, 다른 탭의 storage 이벤트). 저장이 막혀도 알림 값은 받는다 */
export function useProfile(): Profile {
  const [profile, setProfile] = useState<Profile>(readProfile)
  useEffect(() => {
    const onChange = (e: Event) => setProfile(normalizeProfile((e as CustomEvent<Profile>).detail))
    const onStorage = (e: StorageEvent) => {
      if (e.key === PROFILE_KEY) setProfile(readProfile())
    }
    window.addEventListener(PROFILE_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(PROFILE_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return profile
}
