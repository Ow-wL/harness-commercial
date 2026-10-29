import { doneCount, FIELD_NOTES_KEY, FIELD_NOTES_MAX_KEYS, readFieldNotes, writeFieldNotes } from './fieldNotes.ts'

beforeEach(() => {
  window.localStorage.removeItem(FIELD_NOTES_KEY)
})

describe('현장 확인 기록 — 조건 키별 로컬 저장 (12-27)', () => {
  it('쓰고 읽으면 같고, 체크·메모가 모두 비면 키를 지운다', () => {
    const key = '37.4894,126.7246,R10406,500'
    expect(readFieldNotes(key)).toEqual({})
    expect(writeFieldNotes(key, { competitors: { done: true, memo: '' }, rent: { done: false, memo: '월세 150' } })).toBe(true)
    expect(readFieldNotes(key)).toEqual({ competitors: { done: true, memo: '' }, rent: { done: false, memo: '월세 150' } })
    writeFieldNotes(key, { competitors: { done: false, memo: '  ' } })
    expect(readFieldNotes(key)).toEqual({})
    expect(window.localStorage.getItem(FIELD_NOTES_KEY)).toBe('{}')
  })

  it('조건 키가 상한을 넘으면 가장 오래 전에 고친 키부터 지운다', () => {
    for (let i = 0; i < FIELD_NOTES_MAX_KEYS + 2; i++) writeFieldNotes(`k${i}`, { access: { done: true, memo: '' } }, 1000 + i)
    expect(readFieldNotes('k0')).toEqual({})
    expect(readFieldNotes('k1')).toEqual({})
    expect(readFieldNotes('k2')).toEqual({ access: { done: true, memo: '' } })
    expect(readFieldNotes(`k${FIELD_NOTES_MAX_KEYS + 1}`)).toEqual({ access: { done: true, memo: '' } })
  })

  it('깨진 저장값·형식이 다른 항목은 무시한다', () => {
    window.localStorage.setItem(FIELD_NOTES_KEY, '{not json')
    expect(readFieldNotes('k')).toEqual({})
    window.localStorage.setItem(FIELD_NOTES_KEY, JSON.stringify({ k: { updatedAt: 1, notes: { a: { done: 'yes', memo: 3 }, b: null } } }))
    expect(readFieldNotes('k')).toEqual({ a: { done: true, memo: '' } })
  })

  it('저장소가 막혀 있으면 false 를 돌려주고 예외를 내지 않는다', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(writeFieldNotes('k', { a: { done: true, memo: '' } })).toBe(false)
    setItem.mockRestore()
  })

  it('doneCount 는 카드 id 기준으로 확인함 수를 센다', () => {
    expect(doneCount({ a: { done: true, memo: '' }, b: { done: false, memo: 'x' }, z: { done: true, memo: '' } }, ['a', 'b', 'c'])).toBe(1)
  })
})
