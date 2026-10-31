/**
 * 한국어 조사 붙이기: 앞 글자의 받침으로 은/는·이/가·을/를·과/와를 고른다("PC방이(가)" 같은 병기 대신).
 * 한글이 아니면(영문·숫자로 끝남) 받침 있는 쪽으로 읽히는 경우가 많아 숫자만 읽는 법으로 보고, 그 밖은 받침 없는 쪽.
 */
type Pair = '은' | '이' | '을' | '과'
const PAIRS: Record<Pair, [string, string]> = { 은: ['은', '는'], 이: ['이', '가'], 을: ['을', '를'], 과: ['과', '와'] }
/** 0~9 를 한국어로 읽을 때 받침 유무 (영 일 이 삼 사 오 육 칠 팔 구) */
const DIGIT_FINAL = [true, true, false, true, false, false, true, true, true, false]

export function hasFinalConsonant(word: string): boolean {
  const last = word.trim().at(-1)
  if (!last) return false
  const code = last.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0
  if (last >= '0' && last <= '9') return DIGIT_FINAL[Number(last)]!
  return false
}

/** withJosa('PC방', '이') → 'PC방이', withJosa('카페', '은') → '카페는' */
export function withJosa(word: string, josa: Pair): string {
  const [withFinal, withoutFinal] = PAIRS[josa]
  return `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`
}
