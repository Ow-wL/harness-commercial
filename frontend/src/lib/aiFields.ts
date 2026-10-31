/**
 * AI 요약 근거 키 → 사용자용 이름 (v0.2.1). 서버(backend/app/ai.py context_json)가 모델에 넘긴 자료의 키 경로
 * ("지표.customer.raw.타겟연령_거주인구", "종합.병목_지표", "insights.by_hour")를 화면에서 읽을 수 있는 이름으로만 바꾼다.
 * 값·점수는 다루지 않는다. 모르는 키는 한글 조각이 있으면 밑줄만 띄어 쓰고, 영어뿐이면 보이지 않는다(내부 이름 노출 금지).
 */

const PERSPECTIVE: Record<string, string> = {
  market: '시장성',
  customer: '고객성',
  competition: '경쟁성',
  location: '입지성',
  stability: '안정성',
}

/** 지표 raw 키 → 이름. 계산 기준·계수처럼 사람이 읽을 값이 아닌 키는 null → "<관점> 계산 기준" */
const RAW: Record<string, string | null> = {
  일평균_유입인구: '하루 유입인구',
  군구_업종소비_전년비: '구 업종 소비 전년 대비',
  타겟연령_거주인구: '타겟 연령 거주인구',
  타겟연령_비중: '타겟 연령 비중',
  종사자수: '주변 직장인 수',
  '1인세대_비중': '1인 세대 비중',
  동종점포수: '같은 업종 점포 수',
  동종점포수_정확일치: '같은 업종 점포 수',
  '동종점포수_실효(대체업종_포함)': '비슷한 업종 포함 점포 수',
  점포당_잠재수요: '가게 한 곳당 주변 수요',
  상권_집적도_백분위: '상권 집적도',
  최근1년_동종_순증감: '최근 1년 같은 업종 증감',
  최근_폐업률: '최근 폐업률',
  전체점포수: '전체 점포 수',
  동종업종_비중: '같은 업종 비중',
  반경m: '분석 반경',
  반경_추정수요: '반경 안 추정 수요',
  해당지역_수요_백분위: '지역 수요 수준',
  최근접역: '가까운 역',
  최근접역_거리m: '역까지 거리',
  역세권_강도: '역세권 강도',
  역세권_강도_주: '역세권 강도',
  역_의존도: '역 의존도',
  버스정류장_밀도: '버스정류장 밀도',
  유인시설_근접도: '주변 유인시설',
  유인시설_기준: '주변 유인시설',
  유인시설_종류별: '주변 유인시설',
  반경500m_해당시설수: '주변 유인시설',
  학교구역_제외_학교수: '주변 학교(규제 확인)',
  상권성격_적합도: '상권 성격 적합도',
  업종_상권선호: '업종 상권 선호',
  지역_직장성: '직장인 많은 지역 여부',
  시간대_적합도: '시간대 적합도',
  '3년_생존율': '3년 생존율',
  인천_업종평균_3년생존율: '인천 기준 생존율',
  평균_업력_년: '평균 업력',
  '임대료_천원_㎡': '임대료',
  임대료_상권: '임대료',
  임대료_해석: '임대료',
  '1인가구_민감도': null,
  종사자_민감도: null,
  인구_기준: null,
  타겟_정의: null,
  잠재수요_구성: null,
  대체업종_계수: null,
  집적_계수: null,
  업종_집적유형: null,
}

const OVERALL: Record<string, string> = {
  점수: '종합 점수',
  최고_지표: '가장 높은 관점',
  병목_지표: '주의 관점',
  데이터_충족률: '자료 충족률',
  적용_가중치: '가중치',
  기본_가중치: '가중치',
  가중치_출처: '가중치',
  기본가중치_종합점수: '종합 점수',
}

const INSIGHTS: Record<string, string> = {
  by_hour: '시간대별 유입',
  inflow_gu: '구 유입 자료',
  hours_profile_note: '업종 영업 시간대',
}

const TOP: Record<string, string> = {
  경고: '주의 안내',
  면책: '이용 안내',
  위치: '위치',
  업종: '업종',
  분석반경_m: '분석 반경',
  엔진: '엔진 버전',
  같은자리_업종점수_상위: '점수가 높은 업종',
  사용자_프로필: '내 상황',
  지원사업_후보: '조건에 맞는 지원사업',          // 13-34: 지원사업_후보.S1 …
  insights: '시간대 자료',
}

const HANGUL = /[가-힣]/
const words = (s: string) => s.replace(/_/g, ' ').trim()

/** 키 경로 하나 → 이름. 보여 줄 이름이 없으면 null */
export function fieldLabel(path: string): string | null {
  const [root = '', ...rest] = path.trim().split('.')
  if (root === '지표') {
    const [key = '', part, rawKey] = rest
    const name = PERSPECTIVE[key]
    if (!name) return null
    if (part === 'score') return `${name} 점수`
    if (part === 'raw' && rawKey !== undefined) {
      if (rawKey in RAW) return RAW[rawKey] ?? `${name} 계산 기준`
      return HANGUL.test(rawKey) ? words(rawKey) : `${name} 자료`
    }
    if (part === 'flags') return `${name} 참고 표시`
    if (part === 'missing') return `${name} 빠진 자료`
    return name
  }
  if (root === '종합') {
    const key = rest[0]
    return key === undefined ? '종합 점수' : (OVERALL[key] ?? (HANGUL.test(key) ? words(key) : '종합 점수'))
  }
  if (root === 'insights') return INSIGHTS[rest[0] ?? ''] ?? TOP.insights!
  if (root in TOP) return TOP[root]!
  const last = [...rest].reverse().find((s) => HANGUL.test(s)) ?? (HANGUL.test(root) ? root : undefined)
  return last ? words(last) : null
}

/** 근거 키 목록 → 겹치지 않는 이름 목록(순서 유지) */
export function fieldLabels(paths: readonly string[]): string[] {
  const out: string[] = []
  for (const p of paths) {
    const label = fieldLabel(p)
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}
