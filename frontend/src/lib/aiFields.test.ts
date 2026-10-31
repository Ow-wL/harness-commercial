import { describe, expect, it } from 'vitest'
import { fieldLabel, fieldLabels } from './aiFields.ts'

describe('aiFields — AI 요약 근거 키 → 사용자용 이름 (v0.2.1)', () => {
  it('운영 요약에 실제로 나온 키(부평역 PC방 500m)는 내부 경로 없이 이름으로', () => {
    expect(
      fieldLabels([
        '지표.customer.score',
        '지표.customer.raw.타겟연령_거주인구',
        '지표.customer.raw.종사자수',
        '종합.최고_지표',
        '종합.병목_지표',
        '지표.competition.raw.동종점포수_실효(대체업종_포함)',
        '지표.competition.raw.상권_집적도_백분위',
        '지표.location.flags',
        '지표.stability.raw.인천_업종평균_3년생존율',
        '지표.location.raw.학교구역_제외_학교수',
        'insights.by_hour',
        '면책',
      ]),
    ).toEqual([
      '고객성 점수',
      '타겟 연령 거주인구',
      '주변 직장인 수',
      '가장 높은 관점',
      '주의 관점',
      '비슷한 업종 포함 점포 수',
      '상권 집적도',
      '입지성 참고 표시',
      '인천 기준 생존율',
      '주변 학교(규제 확인)',
      '시간대별 유입',
      '이용 안내',
    ])
  })

  it('같은 이름은 한 번만, 계산 기준 키는 관점 이름으로', () => {
    expect(fieldLabels(['지표.competition.raw.동종점포수', '지표.competition.raw.동종점포수_정확일치'])).toEqual(['같은 업종 점포 수'])
    expect(fieldLabel('지표.competition.raw.집적_계수')).toBe('경쟁성 계산 기준')
  })

  it('모르는 키: 한글 조각은 밑줄만 띄우고, 영어뿐이거나 모르는 관점은 보이지 않는다', () => {
    expect(fieldLabel('지표.market.raw.새_자료_항목')).toBe('새 자료 항목')
    expect(fieldLabel('지표.market.raw.new_field')).toBe('시장성 자료')
    expect(fieldLabel('지표.unknown.score')).toBeNull()
    expect(fieldLabel('foo.bar_baz')).toBeNull()
    expect(fieldLabels(['foo', '종합.점수'])).toEqual(['종합 점수'])
    for (const p of ['지표.market.raw.일평균_유입인구', '종합.데이터_충족률', '같은자리_업종점수_상위', '사용자_프로필.stage']) {
      expect(fieldLabel(p)).not.toMatch(/[._]|[a-z]/)
    }
  })
})
