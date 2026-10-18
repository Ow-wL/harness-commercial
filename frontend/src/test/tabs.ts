/**
 * A3 결과 탭(요약 · 주변 점포 · 상세 근거) 테스트 도우미. 고르지 않은 탭은 hidden이라(사용자에게도 안 보인다)
 * 그 안 내용을 볼 때는 사용자처럼 탭을 먼저 연다. 탭이 없거나 이미 열렸으면 그대로.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'

export const SUMMARY_TAB = /^요약/
export const STORES_TAB = /^주변 점포/
export const EVIDENCE_TAB = /^상세 근거/

export function openTab(name: RegExp) {
  const tab = screen.queryAllByRole('tab').find((t) => name.test(t.textContent ?? ''))
  if (tab && tab.getAttribute('aria-selected') !== 'true') fireEvent.click(tab)
}

type RoleOpts = Parameters<typeof screen.getByRole>[1]

export function getInTab(tab: RegExp, role: string, opts?: RoleOpts) {
  openTab(tab)
  return screen.getByRole(role, opts)
}

export function queryInTab(tab: RegExp, role: string, opts?: RoleOpts) {
  openTab(tab)
  return screen.queryByRole(role, opts)
}

export const findInTab = (tab: RegExp, role: string, opts?: RoleOpts) => waitFor(() => getInTab(tab, role, opts))
