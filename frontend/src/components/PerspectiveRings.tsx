import type { Indicator } from '../lib/format.ts'
import { gradeOf } from '../lib/grade.ts'
import './PerspectiveRings.css'

/** 작은 고리: 88 기준 반지름 34, 둘레 */
const R = 34
const C = 2 * Math.PI * R

/**
 * 다섯 관점 한눈 보기 (13-54, DESIGN.md §27): 관점마다 작은 고리 + 반올림한 점수 + 이름. 엔진 순서 그대로.
 * 보는 사람을 위한 요약 그림이다 — 정확한 값(소수 한 자리)·등급 글자·근거는 바로 아래 "다섯 관점" 목록이 주므로
 * 화면 읽기에서는 숨긴다(같은 내용을 두 번 읽지 않게). 색은 원점수의 등급(lib/grade)으로 정한다 — 반올림한 숫자로 등급을 다시 계산하지 않는다.
 * 미산출 관점은 빈 고리에 "–".
 */
export function PerspectiveRings({ indicators }: { indicators: readonly Indicator[] }) {
  return (
    <ul className="persp-rings" aria-hidden="true">
      {indicators.map((ind) => {
        const grade = gradeOf(ind.score)
        return (
          <li key={ind.key} className={`persp-rings__item${grade ? ` persp-rings__item--${grade}` : ' persp-rings__item--missing'}`}>
            <span className="persp-rings__dial">
              <svg viewBox="0 0 88 88">
                <circle className="persp-rings__track" cx="44" cy="44" r={R} />
                {ind.score !== null && ind.score > 0 && (
                  <circle
                    className="persp-rings__arc"
                    cx="44"
                    cy="44"
                    r={R}
                    strokeDasharray={`${(Math.min(100, ind.score) / 100) * C} ${C}`}
                    transform="rotate(-90 44 44)"
                  />
                )}
              </svg>
              <span className="persp-rings__score">{ind.score === null ? '–' : Math.round(ind.score)}</span>
            </span>
            <span className="persp-rings__name">{ind.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
