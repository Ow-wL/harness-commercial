/**
 * 문장 안의 숫자(+단위) 찾기 (v0.4.1 — AI 요약·질문 답의 숫자 강조). 문장은 바꾸지 않고 조각으로만 나눈다.
 * 이름 속 숫자("부평1동", "인천1호선", "1인 세대")는 건드리지 않는다: 앞이 글자·숫자면 제외, 단위가 없으면 뒤가 한글일 때 제외.
 */
const NUMBER = /(?<![가-힣A-Za-z\d.,])\d[\d,]*(?:\.\d+)?(?:\s?(?:%|km|m|명|곳|점|개|분|시간|시|년|배|일|건|세|원)|(?![가-힣\d]))/g

export function splitNumbers(text: string): { text: string; num: boolean }[] {
  const out: { text: string; num: boolean }[] = []
  let at = 0
  for (const m of text.matchAll(NUMBER)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), num: false })
    out.push({ text: m[0], num: true })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), num: false })
  return out
}
