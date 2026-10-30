import type { MouseEvent, ReactNode } from 'react'
import { useRevealTarget } from '../lib/resultTabs.ts'
import { BAND_MAX, type BandLine, type BandTarget } from '../lib/attentionBand.ts'
import { COMPARE_IDS } from '../lib/compareState.ts'
import './AttentionBand.css'

/** 띠 줄이 옮겨 가는 기존 섹션 제목 id */
const TARGET_ID: Record<BandTarget, string> = {
  warnings: 'warnings-title',
  details: 'details-title',
  access: 'access-title',
  'compare-score': COMPARE_IDS.scoreTitle,
  'compare-not-computed': COMPARE_IDS.notComputedTitle,
  'compare-warnings': COMPARE_IDS.warningsTitle,
}

/** 아이콘 모양만으로 뜻을 전하지 않게 스크린리더용 앞말을 붙인다 */
const MARK_LABEL: Record<BandLine['mark'], string> = { '!': '경고', i: '안내', '†': '계산 구성' }

const KIND_LABEL: Record<BandLine['kind'], string> = {
  'school-zone': '학교구역', composition: '계산 구성 다름', bottleneck: '주의 관점', 'not-computed': '미산출',
  school: '학교 주변', confidence: '자료 등급 낮음', other: '추가 확인', area: '같은 지역',
}

/** 섹션 제목으로 이동하고 포커스를 옮긴다. 대상이 숨은 결과 탭 안이면 그 탭을 먼저 연다(A3 탭, ResultTabs) */
function useGoTo() {
  const reveal = useRevealTarget()
  return (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!document.getElementById(id)) return
    e.preventDefault()
    reveal(id)
  }
}

/**
 * 주의 요약 띠 (8-C1a, docs/UX_REDESIGN.md 2.2). 0줄이면 그리지 않는다("특별한 경고가 없습니다"는 주의할 점 섹션에만).
 * 기본은 건수·종류만. 펼치면 원문 요약과 해당 섹션 이동 링크를 보여 준다.
 * 최대 5줄, 넘치면 "주의 N건 더 보기 ›"(주의할 점 섹션으로).
 */
export function AttentionBand({
  lines,
  moreTarget,
  label,
  extraCount = 0,
  children,
}: {
  lines: readonly BandLine[]
  moreTarget: BandTarget
  /** 접힌 제목(13-19 B4: "데이터 한계"). 없으면 톤에 따라 "확인할 점"/"참고할 점" */
  label?: string
  /** 띠 줄 외에 안에 함께 접어 둔 항목 수(확인 필요 줄) — 제목의 건수에 더한다 */
  extraCount?: number
  /** 펼쳤을 때 목록 위에 함께 보이는 내용(확인 필요 줄) */
  children?: ReactNode
}) {
  const goTo = useGoTo()
  if (lines.length === 0 && extraCount === 0) return null
  const shown = lines.slice(0, BAND_MAX)
  const more = lines.length - shown.length
  return (
    <section className="band band--disclosure" aria-label={label ?? '주의 요약'}>
      <details>
        <summary className="band__summary">
          <span className="band__summary-label">{label ?? (lines.some((l) => l.tone === 'warning') ? '확인할 점' : '참고할 점')} {lines.length + extraCount}</span>
          <span className="band__summary-topics">{[...new Set(lines.map((l) => KIND_LABEL[l.kind]))].slice(0, 2).join(' · ')}</span>
          <span className="band__summary-arrow" aria-hidden="true">⌄</span>
        </summary>
        {children}
        <ul className="band__list">
          {shown.map((line) => (
            <li key={`${line.kind}:${line.text}`}>
              <a
                className={`band__item band__item--${line.tone}${line.kind === 'school-zone' ? ' band__item--priority' : ''}`}
                href={`#${TARGET_ID[line.target]}`}
                title={line.text}
                aria-label={`${MARK_LABEL[line.mark]}: ${line.text}`}
                onClick={goTo(TARGET_ID[line.target])}
              >
                <span className="band__mark" aria-hidden="true">
                  {line.mark}
                </span>
                <span className="band__text">{line.text}</span>
                <span className="band__go" aria-hidden="true">
                  ›
                </span>
              </a>
            </li>
          ))}
        </ul>
        {more > 0 && (
          <a className="band__more" href={`#${TARGET_ID[moreTarget]}`} onClick={goTo(TARGET_ID[moreTarget])}>
            주의 {more}건 더 보기 ›
          </a>
        )}
      </details>
    </section>
  )
}

/** 모바일 지도 sheet peek 용 — 띠 첫 줄만 글자로 (이동 링크 없음, 결과 보기 버튼이 패널로 옮긴다) */
export function BandPeek({ lines }: { lines: readonly BandLine[] }) {
  const first = lines[0]
  if (!first) return null
  return (
    <p className={`band-peek band-peek--${first.tone}`}>
      <span className="band__mark" aria-hidden="true">
        {first.mark}
      </span>
      <span className="visually-hidden">{MARK_LABEL[first.mark]}: </span>
      <span className="band__text">{first.text}</span>
    </p>
  )
}
