import { describe, expect, it } from 'vitest'
import { hasFinalConsonant, withJosa } from './josa.ts'

describe('josa — 받침으로 조사 고르기', () => {
  it('한글 받침 유무', () => {
    expect(withJosa('PC방', '이')).toBe('PC방이')
    expect(withJosa('카페', '이')).toBe('카페가')
    expect(withJosa('부평구', '은')).toBe('부평구는')
    expect(withJosa('경쟁성', '은')).toBe('경쟁성은')
    expect(withJosa('독서실/스터디 카페', '을')).toBe('독서실/스터디 카페를')
    expect(withJosa('편의점', '과')).toBe('편의점과')
  })
  it('숫자는 읽는 법, 그 밖은 받침 없음, 빈 문자열', () => {
    expect(hasFinalConsonant('3')).toBe(true)
    expect(hasFinalConsonant('2')).toBe(false)
    expect(hasFinalConsonant('ABC')).toBe(false)
    expect(hasFinalConsonant('')).toBe(false)
  })
})
