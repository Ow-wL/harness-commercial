/**
 * 첫 방문 안내 상태 (묶음 D, docs/ONBOARDING_DESIGN.md).
 *
 * - 안내는 **첫 방문 한 번의 흐름**(①위치 → ②업종 → ③분석 → 첫 결과에서 ④). 팀 점검 D7(2026-10-30): 결과 화면에서 새 말풍선이 또
 *   뜨지 않게 — ④는 진행 중인 안내의 이어짐일 때만 보이고, "건너뛰기"는 ④까지 안내 전체를 끝낸다. 이미 안내를 마친 사용자는 첫 결과에서
 *   ④를 따로 보지 않는다(다시 보기는 `?` 버튼). 공유 링크로 바로 결과에 온 첫 방문은 ④만 보고 ①~③은 끝낸 것으로 한다.
 * - 저장: localStorage `onboarding` = 'done'(안내), `onboarding.result` = 'done'(결과 안내). 테마와 같은 방식(실패해도 세션 동안 유지).
 * - 진행: "다음"/"확인" 또는 **그 행동을 실제로 하면** 자동 진행(위치 선택 → ②, 업종 선택 → ③, 분석 성공 → 닫힘). "건너뛰기"는 안내 전체 종료.
 *   Escape는 지금 말풍선만 숨기고 안내는 끝내지 않는다 — 다음 행동을 하면 다음 단계가 다시 보인다.
 * - 다시 보기: 지금 화면에 맞는 단계부터(분석 전 ①, 결과 ④). 저장값은 완료 때 다시 쓴다.
 *
 * 순수 전이(reduce)와 저장(read/write)을 나눠 두고, 훅은 둘을 잇는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type TourStep = 'location' | 'business' | 'analyze' | 'result'
export const TOUR_STEPS: readonly Exclude<TourStep, 'result'>[] = ['location', 'business', 'analyze']

export const ONBOARDING_KEY = 'onboarding'
export const ONBOARDING_RESULT_KEY = 'onboarding.result'

export type OnboardingFlags = { tourDone: boolean; resultDone: boolean }

export function readFlags(): OnboardingFlags {
  try {
    return {
      tourDone: window.localStorage.getItem(ONBOARDING_KEY) === 'done',
      resultDone: window.localStorage.getItem(ONBOARDING_RESULT_KEY) === 'done',
    }
  } catch {
    return { tourDone: true, resultDone: true }                        // 저장을 읽을 수 없으면 안내하지 않는다(반복 노출 방지)
  }
}

export function writeFlag(key: typeof ONBOARDING_KEY | typeof ONBOARDING_RESULT_KEY): void {
  try {
    window.localStorage.setItem(key, 'done')
  } catch {
    // 저장이 막혀 있어도 이번 세션의 상태(state)는 그대로 쓴다
  }
}

export type OnboardingState = {
  /** 지금 보이는 말풍선. null이면 없음 */
  step: TourStep | null
  /** Escape로 숨긴 단계 — 다음 행동으로 이어서 보인다(건너뛰기와 구분) */
  hidden: TourStep | null
  flags: OnboardingFlags
}

export type OnboardingEvent =
  | { type: 'next' }                       // 다음·확인
  | { type: 'skip' }                       // 건너뛰기: 지금 안내 전체 종료(결과 안내면 결과 안내 종료)
  | { type: 'dismiss' }                    // Escape: 지금 말풍선만 숨김
  | { type: 'location-picked' }
  | { type: 'business-picked' }
  | { type: 'analyzed' }                   // 분석 성공(결과가 처음 보임)
  | { type: 'conditions-shown' }           // 분석 전 화면으로 돌아옴(조건 바꾸기 등) — 진행 중이던 안내만 다시 보인다
  | { type: 'replay'; screen: 'conditions' | 'result' }

export function initialState(flags: OnboardingFlags = readFlags()): OnboardingState {
  return { step: flags.tourDone ? null : 'location', hidden: null, flags }
}

const NEXT: Record<Exclude<TourStep, 'result'>, Exclude<TourStep, 'result'> | null> = { location: 'business', business: 'analyze', analyze: null }

function finishTour(s: OnboardingState): OnboardingState {
  return { ...s, step: null, hidden: null, flags: { ...s.flags, tourDone: true } }
}

function finishResult(s: OnboardingState): OnboardingState {
  return { ...s, step: null, hidden: null, flags: { ...s.flags, resultDone: true } }
}

/** 현재 또는 숨겨진 단계(행동으로 이어서 보일 때 기준) */
const current = (s: OnboardingState): TourStep | null => s.step ?? s.hidden

export function reduce(s: OnboardingState, e: OnboardingEvent): OnboardingState {
  const cur = current(s)
  switch (e.type) {
    case 'next': {
      if (s.step === null) return s
      if (s.step === 'result') return finishResult(s)
      const n = NEXT[s.step]
      return n ? { ...s, step: n, hidden: null } : finishTour(s)
    }
    case 'skip':
      if (s.step === null) return s
      return finishResult(finishTour(s))                               // 안내 전체 종료(④ 포함, D7)
    case 'dismiss':
      return s.step === null ? s : { ...s, step: null, hidden: s.step }
    case 'location-picked':
      return cur === 'location' ? { ...s, step: 'business', hidden: null } : s
    case 'business-picked':
      return cur === 'business' ? { ...s, step: 'analyze', hidden: null } : s
    case 'analyzed': {
      // 진행 중인 안내(①~③, 숨긴 것 포함)가 있으면 안내를 마치고 ④로 이어진다. 안내가 없으면(이미 마침·건너뜀) 새 말풍선을 띄우지 않는다(D7)
      if (cur === null) return s
      if (cur === 'result') return s.flags.resultDone ? s : { ...s, step: 'result', hidden: null }   // 잠시 닫힌 ④를 다음 결과에서 이어서
      const afterTour = finishTour(s)
      if (afterTour.flags.resultDone) return { ...afterTour, step: null, hidden: null }
      return { ...afterTour, step: 'result', hidden: null }
    }
    case 'conditions-shown':
      // 결과 안내가 열린 채 조건 화면으로 가면 닫는다(결과가 없는 화면에서 결과 안내를 보이지 않음). 완료로 치지 않는다
      return s.step === 'result' ? { ...s, step: null, hidden: 'result' } : s
    case 'replay':
      return { ...s, step: e.screen === 'result' ? 'result' : 'location', hidden: null }
  }
}

/** 저장해야 할 플래그 변화(flags가 false → true 된 키) */
export function flagsToWrite(prev: OnboardingFlags, next: OnboardingFlags): (typeof ONBOARDING_KEY | typeof ONBOARDING_RESULT_KEY)[] {
  const out: (typeof ONBOARDING_KEY | typeof ONBOARDING_RESULT_KEY)[] = []
  if (!prev.tourDone && next.tourDone) out.push(ONBOARDING_KEY)
  if (!prev.resultDone && next.resultDone) out.push(ONBOARDING_RESULT_KEY)
  return out
}

/** 말풍선 단계 표시용: ①~③은 n/3, 결과 안내는 단독 */
export function stepIndex(step: TourStep): { index: number; total: number } | null {
  const i = TOUR_STEPS.indexOf(step as Exclude<TourStep, 'result'>)
  return i < 0 ? null : { index: i + 1, total: TOUR_STEPS.length }
}

export function useOnboarding(): { state: OnboardingState; send: (e: OnboardingEvent) => void } {
  const [state, setState] = useState<OnboardingState>(initialState)
  const flagsRef = useRef(state.flags)
  // 완료 플래그가 켜지면 저장한다(렌더 뒤, 1회)
  useEffect(() => {
    for (const key of flagsToWrite(flagsRef.current, state.flags)) writeFlag(key)
    flagsRef.current = state.flags
  }, [state.flags])
  const send = useCallback((e: OnboardingEvent) => setState((s) => reduce(s, e)), [])
  return useMemo(() => ({ state, send }), [state, send])
}
