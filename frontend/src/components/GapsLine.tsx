import './GapsLine.css'

/** "잠재수요에 방문객 유동 없음(번화가는 …)" → 칩 글자와 괄호 설명. 끝 괄호가 없으면 설명 없음 */
function splitDetail(t: string): { main: string; detail: string | null } {
  const m = /^(.+?)\((.+)\)$/.exec(t)
  return m ? { main: m[1]!, detail: m[2]! } : { main: t, detail: null }
}

/**
 * "확인 필요" 한 줄 (12-20, 계획 0-6 안 B → v0.4.1 칩). 내용은 lib/gaps.gapLines 가 만든다(문장은 그대로).
 * 항목마다 칩, 끝 괄호 설명은 칩 안 둘째 줄 작은 글자 — 글자 순서는 이전과 같다(인쇄·스크린리더).
 * 비교 화면은 A·B 각각(prefix) — 같으면 하나만.
 */
export function GapsLine({ items, prefix }: { items: readonly string[]; prefix?: string }) {
  if (items.length === 0) return null
  return (
    <p className="gaps">
      <b className="gaps__label">{prefix ? `${prefix} 확인 필요` : '확인 필요'}</b>
      {items.map((t) => {
        const { main, detail } = splitDetail(t)
        return (
          <span key={t} className="gaps__item">
            {main}
            {detail && <span className="gaps__detail">({detail})</span>}
          </span>
        )
      })}
    </p>
  )
}
