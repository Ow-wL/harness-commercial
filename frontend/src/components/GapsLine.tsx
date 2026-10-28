import './GapsLine.css'

/**
 * "확인 필요" 한 줄 (12-20, 계획 0-6 안 B). 종합 점수 아래, 간단 화면에서도 보인다. 내용은 lib/gaps.gapLines 가 만든다.
 * 비교 화면은 A·B 각각(prefix) — 같으면 하나만.
 */
export function GapsLine({ items, prefix }: { items: readonly string[]; prefix?: string }) {
  if (items.length === 0) return null
  return (
    <p className="gaps">
      <b className="gaps__label">{prefix ? `${prefix} 확인 필요` : '확인 필요'}</b>
      {items.map((t) => (
        <span key={t} className="gaps__item">
          {t}
        </span>
      ))}
    </p>
  )
}
