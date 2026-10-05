import { useId, useState } from 'react'
import type { EngineResult } from '../api/schemas.ts'
import { Chip } from './Chip.tsx'
import { Icon } from './Icon.tsx'
import './BeginnerAccess.css'

const LEVELS = ['낮음', '중간', '높음'] as const

/**
 * 초보자 접근성 (DESIGN.md §8.8, §9 L1). 진입장벽 + 이유는 펼친 상태, 나머지 항목은 "자세히".
 * 3단계 세그먼트는 현재 칸만 --color-data-bar로 채운다(높음 = 빨강 금지). null 값은 "해당 없음".
 */
export function BeginnerAccess({ access }: { access: EngineResult['초보자_접근성'] | null }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()

  return (
    <section className="result-section" aria-labelledby="access-title">
      <h2 id="access-title" className="result-section__title">
        초보자 접근성
      </h2>
      {access === null ? (
        <p className="result-section__empty">이 업종은 접근성 정보가 없습니다.</p>
      ) : (
        <>
          <div className="access__level">
            <span className="access__segments" aria-hidden="true">
              {LEVELS.map((lv) => (
                <span key={lv} className={`access__segment${lv === access.제도_진입장벽 ? ' access__segment--on' : ''}`}>
                  {lv}
                </span>
              ))}
            </span>
            <span className="access__level-text">진입장벽 {access.제도_진입장벽}</span>
            {access.면허_보유 === true && (
              <Chip tone="info" icon="info">
                보유 면허 반영
              </Chip>
            )}
          </div>
          <ul className="access__reasons">
            {access.이유.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <button
            type="button"
            className="button-ghost"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="chevron" data-open={open}>
              <Icon name="chevron-right" />
            </span>
            자세히
          </button>
          {open && (
            <dl id={detailsId} className="definition-list">
              <dt>인허가</dt>
              <dd>{access.인허가}</dd>
              <dt>필요 면허</dt>
              <dd>{access.필요_면허 ?? '해당 없음'}</dd>
              <dt>입지 규제</dt>
              <dd>{access.입지_규제 ?? '해당 없음'}</dd>
              {access.주변_학교 && (
                <>
                  <dt>주변 학교</dt>
                  <dd>
                    {access.주변_학교.판단}
                    <span className="definition-list__sub">
                      {access.주변_학교.기준} · {access.주변_학교.학교수}곳
                      {access.주변_학교.목록.length > 0 &&
                        ` (${access.주변_학교.목록.map((s) => `${s.이름 ?? s.종류} ${s.거리_m}m`).join(', ')})`}
                    </span>
                  </dd>
                </>
              )}
              <dt>개업 전 교육</dt>
              <dd>{access.개업전_교육 ?? '해당 없음'}</dd>
              <dt>창업비용 참고</dt>
              <dd>
                {access.창업비용_참고.값_만원 === null
                  ? access.창업비용_참고.기준
                  : `${access.창업비용_참고.값_만원.toLocaleString('ko-KR')}만원 (${access.창업비용_참고.기준})`}
                <span className="definition-list__sub">{access.창업비용_참고.비교}</span>
              </dd>
              <dt>근거</dt>
              <dd>{access.근거}</dd>
            </dl>
          )}
          <p className="result-section__note">이 정보는 점수에 반영하지 않습니다.</p>
        </>
      )}
    </section>
  )
}
