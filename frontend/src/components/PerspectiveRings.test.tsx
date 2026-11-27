import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Indicator } from '../lib/format.ts'
import { PerspectiveRings } from './PerspectiveRings.tsx'

const ITEMS = [
  { key: 'market', label: '시장성', score: 44.4 },
  { key: 'customer', label: '고객성', score: 84.7 },
  { key: 'competition', label: '경쟁성', score: 24.8 },
  { key: 'location', label: '입지성', score: null },
  { key: 'stability', label: '안정성', score: 39.5 },
] as unknown as Indicator[]

describe('PerspectiveRings — 다섯 관점 한눈 보기 (13-54)', () => {
  it('관점마다 고리 하나, 엔진 순서 그대로, 숫자는 반올림해 보인다', () => {
    const { container } = render(<PerspectiveRings indicators={ITEMS} />)
    const items = [...container.querySelectorAll('.persp-rings__item')]
    expect(items.map((li) => li.querySelector('.persp-rings__name')!.textContent)).toEqual(['시장성', '고객성', '경쟁성', '입지성', '안정성'])
    expect(items.map((li) => li.querySelector('.persp-rings__score')!.textContent)).toEqual(['44', '85', '25', '–', '40'])
  })

  it('색(등급)은 반올림한 숫자가 아니라 원점수로 정한다 — 24.8 은 "25"로 보여도 주의, 39.5 는 "40"으로 보여도 약함', () => {
    const { container } = render(<PerspectiveRings indicators={ITEMS} />)
    const cls = [...container.querySelectorAll('.persp-rings__item')].map((li) => li.className)
    expect(cls[0]).toContain('persp-rings__item--mid')
    expect(cls[1]).toContain('persp-rings__item--good')
    expect(cls[2]).toContain('persp-rings__item--alert')
    expect(cls[4]).toContain('persp-rings__item--weak')
  })

  it('미산출 관점은 호를 그리지 않는다(0 으로 그리지 않음)', () => {
    const { container } = render(<PerspectiveRings indicators={ITEMS} />)
    const missing = container.querySelector('.persp-rings__item--missing')!
    expect(missing.querySelector('.persp-rings__arc')).toBeNull()
    expect(container.querySelectorAll('.persp-rings__arc')).toHaveLength(4)
  })

  it('꾸밈 요약이라 화면 읽기에서 숨긴다 — 정확한 값과 등급 글자는 아래 다섯 관점 목록이 준다', () => {
    const { container } = render(<PerspectiveRings indicators={ITEMS} />)
    expect(container.querySelector('.persp-rings')!.getAttribute('aria-hidden')).toBe('true')
  })
})
