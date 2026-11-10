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
  profileNudge: '창업 단계·청년·우대 조건을 고르면 더 좁혀져요.',
  profileOpen: '내 상황 고르기',
  profileEdit: '내 상황 바꾸기',
  open: '공고 보기',
  apply: '신청 페이지',
  more: (n: number) => `${n}건 더 보기`,
  less: '접기',
  note: '조건에 맞는 공고일 뿐 선정 가능성과는 무관해요. 신청 자격·마감은 공고 원문에서 꼭 확인하세요.',
} as const

/** v0.4.1: 한 번에 받는 공고 수(서버 상한 10)와 처음 보이는 카드 수(2·3열 격자가 꽉 차는 6) */
export const SUPPORT_LIMIT = 10
export const SUPPORT_SHOWN = 6

/** 서버가 받는 인천 구·군 이름(backend SupportMatchRequest.gu) — 분석 응답의 context.gu_name 이 이 밖이면 구 없이 묻는다 */
/** 2026-07-01 행정체제 개편 뒤 11개 구·군 (v0.3.1 바로잡음 — 개편 전 이름이라 제물포·영종·서해·검단구 사용자는 구 없이 물었다) */
export const INCHEON_GU = ['강화군', '검단구', '계양구', '남동구', '미추홀구', '부평구', '서해구', '연수구', '영종구', '옹진군', '제물포구'] as const

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
