import { Fragment } from 'react'
import { splitNumbers } from '../lib/numberEmphasis.ts'

/** 문장 안의 숫자(+단위)만 굵게 (v0.4.1 — AI 요약·질문 답, lib/numberEmphasis). 문장은 바꾸지 않는다 */
export function NumberEmphasis({ text }: { text: string }) {
  return (
    <>
      {splitNumbers(text).map((p, i) => (p.num ? <b key={i} className="num-em">{p.text}</b> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  )
}
