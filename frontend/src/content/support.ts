/**
 * 지원사업 카드 문구 (R3 13-33, D-039). "추천"이 아니라 "조건에 맞는 공고" — 선정 가능성·순위를 말하지 않는다.
 * 공고명·기관·대상·신청기간은 원문 그대로 보이고 출처(기업마당·K-Startup)를 밝힌다(기업마당 저작권 정책, docs/SUPPORT_PROGRAMS.md 3절).
 */
export const SUPPORT_TEXT = {
  title: '조건에 맞는 지원사업',
  loading: '지원사업 공고를 찾는 중…',
  empty: '지금 이 조건에 맞는 공고가 없어요. 내 상황을 바꾸거나 나중에 다시 확인해 주세요.',
  notReady: '공고를 아직 받아 오지 못했어요. 잠시 뒤 다시 확인해 주세요.',
  failed: '지원사업 공고를 불러오지 못했어요.',
  profileNudge: '내 상황(창업 단계·청년·우대 조건)을 고르면 더 좁혀져요.',
  apply: '신청 페이지',
  note: '조건에 맞는 공고일 뿐 선정 가능성과는 무관해요. 신청 자격·마감은 공고 원문에서 꼭 확인하세요.',
} as const

/** 서버가 받는 인천 구·군 이름(backend SupportMatchRequest.gu) — 분석 응답의 context.gu_name 이 이 밖이면 구 없이 묻는다 */
export const INCHEON_GU = ['중구', '동구', '미추홀구', '연수구', '남동구', '부평구', '계양구', '서구', '강화군', '옹진군'] as const

export const SUPPORT_SOURCE_NAME: Record<string, string> = { bizinfo: '기업마당', kstartup: 'K-Startup' }

/** 마감 표시: 날짜가 있으면 D-N(0이면 D-day), 없으면 신청기간 원문("예산 소진시까지" 등) */
export function deadlineLabel(item: { days_left: number | null; period_text: string }): string {
  if (item.days_left === null) return item.period_text || '마감 정보 없음'
  return item.days_left === 0 ? 'D-day' : `D-${item.days_left}`
}

/** "2026-11-01T06:00:00+09:00" → "2026-11-01 06:00" (KST 그대로 — 서버가 KST 로 준다) */
export function asOfLabel(asOf: string | null): string | null {
  if (!asOf) return null
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(asOf)
  return m ? `${m[1]} ${m[2]}` : null
}
