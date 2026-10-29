/**
 * 현장 확인 기록 (12-27·12-25): 카드별 "확인함" 체크와 메모를 분석 조건 키(좌표·업종·반경)마다 **이 브라우저에만** 저장한다
 * (localStorage `fieldNotes.v1`). 익명이며 좌표 원문 외 개인정보는 없다. 서버로 보내지 않는다.
 * 보관함(lib/savedSites)이 같은 키로 읽어 저장 후보마다 확인 진행을 보인다.
 * 저장소를 쓸 수 없으면(사생활 보호 모드 등) 이번 화면에서만 유지된다 — 호출 쪽이 메모리 사본을 들고 있다.
 */
export const FIELD_NOTES_KEY = 'fieldNotes.v1'
/** 조건 키를 이보다 많이 들지 않는다 — 오래된(마지막 수정이 이른) 것부터 지운다 */
export const FIELD_NOTES_MAX_KEYS = 30

export type FieldNote = { done: boolean; memo: string }
export type FieldNotes = Record<string, FieldNote>
type Stored = Record<string, { updatedAt: number; notes: FieldNotes }>

function readAll(): Stored {
  try {
    const raw = window.localStorage.getItem(FIELD_NOTES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {}
  } catch {
    return {}
  }
}

function writeAll(all: Stored): boolean {
  try {
    window.localStorage.setItem(FIELD_NOTES_KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

/** 조건 키의 기록 (없으면 빈 객체). 값은 복사본이다 */
export function readFieldNotes(conditionKey: string): FieldNotes {
  const entry = readAll()[conditionKey]
  if (!entry || typeof entry.notes !== 'object') return {}
  const out: FieldNotes = {}
  for (const [id, n] of Object.entries(entry.notes)) {
    if (n && typeof n === 'object') out[id] = { done: Boolean(n.done), memo: typeof n.memo === 'string' ? n.memo : '' }
  }
  return out
}

/** 조건 키의 기록 전체를 저장한다(빈 기록이면 키 삭제). 저장소에 썼으면 true */
export function writeFieldNotes(conditionKey: string, notes: FieldNotes, now: number = Date.now()): boolean {
  const all = readAll()
  const kept = Object.fromEntries(Object.entries(notes).filter(([, n]) => n.done || n.memo.trim() !== ''))
  if (Object.keys(kept).length === 0) delete all[conditionKey]
  else all[conditionKey] = { updatedAt: now, notes: kept }
  const keys = Object.keys(all).sort((a, b) => all[a]!.updatedAt - all[b]!.updatedAt)
  while (keys.length > FIELD_NOTES_MAX_KEYS) delete all[keys.shift()!]
  return writeAll(all)
}

/** 확인함 수 / 카드 수 요약용 */
export function doneCount(notes: FieldNotes, ids: readonly string[]): number {
  return ids.filter((id) => notes[id]?.done).length
}
