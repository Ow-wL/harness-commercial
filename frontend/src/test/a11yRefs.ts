/**
 * DOM id·접근성 참조 검사 (docs/COMPARE_DESIGN.md 6장 6번). 테스트 전용.
 * - id는 문서 안에서 유일하다.
 * - aria-labelledby·aria-describedby·내부 링크(href="#…") 대상은 항상 있다.
 * - aria-controls 대상은 접힌 패널을 DOM에서 빼는 컴포넌트가 있으므로 펼친 뒤 검사한다(expandAll).
 */
import { fireEvent } from '@testing-library/react'

export function duplicateIds(root: ParentNode = document): string[] {
  const seen = new Map<string, number>()
  root.querySelectorAll('[id]').forEach((el) => seen.set(el.id, (seen.get(el.id) ?? 0) + 1))
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
}

/** 대상이 없는 참조 목록 ("속성=id") */
export function brokenReferences(root: ParentNode = document, attrs = ['aria-labelledby', 'aria-describedby']): string[] {
  const broken: string[] = []
  for (const attr of attrs) {
    root.querySelectorAll(`[${attr}]`).forEach((el) => {
      for (const id of el.getAttribute(attr)!.split(/\s+/).filter(Boolean)) {
        if (!document.getElementById(id)) broken.push(`${attr}=${id}`)
      }
    })
  }
  root.querySelectorAll('a[href^="#"]').forEach((a) => {
    const id = a.getAttribute('href')!.slice(1)
    if (id && !document.getElementById(id)) broken.push(`href=#${id}`)
  })
  return broken
}

/** 접힌 disclosure(aria-expanded="false" + aria-controls)를 모두 펼친다. 펼치면 새 토글이 나올 수 있어 반복한다 */
export function expandAll(root: ParentNode = document, max = 200): void {
  for (let i = 0; i < max; i++) {
    const toggle = [...root.querySelectorAll<HTMLElement>('[aria-controls][aria-expanded="false"]')].find(
      (el) => !(el as HTMLButtonElement).disabled,
    )
    if (!toggle) return
    fireEvent.click(toggle)
  }
  throw new Error('expandAll: 펼침이 끝나지 않습니다')
}

/** 펼친 상태에서 aria-controls 대상이 없는 목록 */
export function brokenControls(root: ParentNode = document): string[] {
  return brokenReferences(root, ['aria-controls']).filter((r) => r.startsWith('aria-controls'))
}
