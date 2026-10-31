import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_PROFILE, mergeSuggestion, normalizeProfile, PROFILE_KEY, profileBody, readProfile, writeProfile } from './profile.ts'

describe('profile — 선택형 프로필 (R2 13-26, 이 브라우저에만)', () => {
  afterEach(() => window.localStorage.removeItem(PROFILE_KEY))

  it('저장·읽기, 깨진 값·목록 밖 값은 버린다', () => {
    expect(readProfile()).toEqual(EMPTY_PROFILE)
    writeProfile({ stage: '예비', youth: true, preferred: ['여성'] })
    expect(readProfile()).toEqual({ stage: '예비', youth: true, preferred: ['여성'] })
    window.localStorage.setItem(PROFILE_KEY, '{broken')
    expect(readProfile()).toEqual(EMPTY_PROFILE)
    expect(normalizeProfile({ stage: '사장님', youth: 'yes', preferred: ['여성', '외계인', '여성'] })).toEqual({ stage: null, youth: null, preferred: ['여성'] })
  })

  it('비어 있으면 요청에 null(아무것도 보내지 않는다), 아니면 그대로', () => {
    expect(profileBody(EMPTY_PROFILE)).toBeNull()
    expect(profileBody({ stage: null, youth: true, preferred: [] })).toEqual({ stage: null, youth: true, preferred: null })
  })

  it('AI 제안은 null 인 칸을 덮지 않고 합친다', () => {
    const merged = mergeSuggestion({ stage: '운영 중', youth: null, preferred: ['여성'] }, { stage: null, youth: true, preferred: ['재창업'] })
    expect(merged).toEqual({ stage: '운영 중', youth: true, preferred: ['여성', '재창업'] })
  })
})
