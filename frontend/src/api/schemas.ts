/**
 * Backend API 응답 schema (TASKS 4-2, docs/DECISIONS.md D-012·D-014).
 *
 * 이 파일의 Zod schema가 API 데이터 계약의 source of truth다. TypeScript 타입은 아래에서
 * `z.infer`로만 파생하고 같은 내용을 interface로 다시 쓰지 않는다.
 * 실제 응답은 같은 schema로 검증한다: `AnalyzeResponseSchema.safeParse(await res.json())`.
 *
 * 근거
 * - 엔진 결과(`result`): docs/ENGINE.md + 29개 golden(tests/golden/v0.3/json) + 엔진 v0.3 코드
 *   (scoring_engine/v0_3/scoring.py·access.py, scoring_engine/service.py). golden은 부평역 1지점 ·
 *   기본 가중치뿐이라, 좌표 요청·importance/user_weights·동종점포 0개처럼 엔진 코드가 만들 수 있지만
 *   golden에 없는 형태는 코드 위치를 주석에 적고 허용한다.
 * - context·업종 목록: backend/app/main.py. 오류: backend/app/errors.py.
 *
 * 원칙: 값을 변환하지 않는다(coercion·transform·default 없음). 결측은 엔진이 실제로 내는 `null`만
 * 허용한다. 계약 객체는 strict라 모르는 필드가 오면 실패한다(엔진·API 계약 변경을 조용히 넘기지 않는다).
 */
import { z } from 'zod'

// ─── 공통 ────────────────────────────────────────────────────────────

/** 엔진 config.PERSPECTIVES — 5대 관점, 이 순서가 화면 순서다 (DESIGN.md P3). */
export const PERSPECTIVE_KEYS = ['market', 'customer', 'competition', 'location', 'stability'] as const
export const PerspectiveKeySchema = z.enum(PERSPECTIVE_KEYS)

/** 엔진 config.BIZ_GROUP 키. */
export const BusinessGroupCodeSchema = z.enum(['A_고객밀착형', 'B_유동인구형', 'C_목적방문형', 'D_체류소비형'])

const nullableNumber = z.number().nullable()

/** 0~100 백분위 점수 (pct_rank). None = 계산 불가. */
const scoreSchema = z.number().min(0).max(100)

/** 5대 관점 전부를 키로 갖는 가중치 (resolve_weights: 기본_가중치·중요도). */
const fullWeightsSchema = z.strictObject({
  market: z.number(),
  customer: z.number(),
  competition: z.number(),
  location: z.number(),
  stability: z.number(),
})

/** 종합.적용_가중치 — 점수가 나온 관점만 키로 갖는다 (scoring._weighted가 결측 관점을 뺀다). */
const appliedWeightsSchema = fullWeightsSchema.partial()

// ─── meta ────────────────────────────────────────────────────────────

const metaSchema = z.strictObject({
  query: z.string(),
  업종: z.string(),
  업종코드: z.string(),
  업종그룹: BusinessGroupCodeSchema,
  행정동: z.string(),
  분석반경_m: z.number(),
  정규화_기준: z.string(),
  엔진버전: z.literal('mvp-0.3'),
})

// ─── 종합 ────────────────────────────────────────────────────────────

const importanceLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])

const summarySchema = z.strictObject({
  점수: scoreSchema.nullable(),                     // 점수 낸 관점이 하나도 없으면 null
  적용_가중치: appliedWeightsSchema,
  최고_지표: PerspectiveKeySchema.nullable(),
  병목_지표: PerspectiveKeySchema.nullable(),
  데이터_충족률: z.number().min(0).max(1),
  가중치_출처: z.enum(['기본(업종그룹)', '사용자(직접 입력)', '사용자(중요도 1~5)']),
  기본_가중치: fullWeightsSchema,
  // 아래 셋은 사용자 가중치를 썼을 때만 키가 생긴다 (scoring.analyze "종합")
  중요도: z
    .strictObject({
      market: importanceLevelSchema,
      customer: importanceLevelSchema,
      competition: importanceLevelSchema,
      location: importanceLevelSchema,
      stability: importanceLevelSchema,
    })
    .optional(),
  하한_적용: z.array(PerspectiveKeySchema).min(1).optional(),
  기본가중치_종합점수: scoreSchema.optional(),
})

// ─── 지표 (5대 관점) ─────────────────────────────────────────────────

const STATUS_COMPUTED = '계산'
const STATUS_EXCLUDED = '제외(데이터 없음)'

/** scoring._bd — 세부지표 1개. 점수가 없으면 기여도도 없고 상태는 '제외'. */
function breakdownItemSchema<K extends readonly [string, ...string[]]>(keys: K) {
  return z
    .strictObject({
      key: z.enum(keys),
      label: z.string(),
      score: scoreSchema.nullable(),
      설계_가중치: z.number(),
      적용_가중치: z.number(),
      기여도: nullableNumber,
      원시값: nullableNumber,
      상태: z.enum([STATUS_COMPUTED, STATUS_EXCLUDED]),
    })
    .refine(
      (b) =>
        b.score === null
          ? b.기여도 === null && b.상태 === STATUS_EXCLUDED
          : b.기여도 !== null && b.상태 === STATUS_COMPUTED,
      { message: 'score·기여도·상태가 서로 맞지 않습니다 (scoring._bd)' },
    )
}

/** scoring.Indicator 공통 필드. key·label은 관점마다 고정. */
function indicatorSchema<
  Key extends string,
  Label extends string,
  Raw extends z.ZodType,
  SubKeys extends readonly [string, ...string[]],
>(key: Key, label: Label, raw: Raw, subKeys: SubKeys) {
  return z.strictObject({
    key: z.literal(key),
    label: z.literal(label),
    score: scoreSchema.nullable(),                 // coverage < MIN_COVERAGE 등 계산 불가면 null
    raw,
    confidence: z.enum(['high', 'medium', 'low']),
    coverage: z.number().min(0).max(1),
    // scoring.FALLBACK_LADDER 4단계 + service 후처리(시장성 "gugu")
    fallback: z.enum(['dong_sobun', 'dong_jung', 'gugu_sobun', 'incheon_avg', 'gugu']),
    flags: z.array(z.string()),                    // 일부 flag는 문자열 조합("해상도_저하__{level}")이라 enum으로 고정하지 않는다
    note: z.string(),
    breakdown: z.array(breakdownItemSchema(subKeys)),
  })
}

const marketRawSchema = z.strictObject({
  일평균_유입인구: nullableNumber,
  시간대_적합도: nullableNumber,
  상권성격_적합도: nullableNumber,
  지역_직장성: nullableNumber,
  업종_상권선호: z.number(),
  군구_업종소비_전년비: nullableNumber,              // v0.3 데이터에는 없음(항상 null), 엔진은 숫자를 받을 수 있다
})

const customerRawSchema = z.strictObject({
  타겟_정의: z.string(),
  타겟연령_거주인구: nullableNumber,
  타겟연령_비중: nullableNumber,
  종사자수: nullableNumber,
  '1인세대_비중': nullableNumber,
})

/** 반경 안 동종점포가 있을 때 (일반 경로). */
const competitionRawSchema = z.strictObject({
  반경m: z.number(),
  동종점포수: z.number().int().positive(),
  전체점포수: z.number(),
  동종업종_비중: z.number(),
  반경_추정수요: z.number(),
  점포당_잠재수요: z.number(),
  최근1년_동종_순증감: nullableNumber,
})

/** 반경 안 동종점포가 0개일 때 — 점수 없이 수요 백분위만 준다 (scoring.score_competition "미개척"). */
const competitionVacantRawSchema = z.strictObject({
  반경m: z.number(),
  동종점포수: z.literal(0),
  전체점포수: z.number(),
  점포당_잠재수요: z.null(),
  해당지역_수요_백분위: scoreSchema.nullable(),
})

/** 엔진 config.ANCHOR 유인시설 종류. 주변에 있는 종류만 키로 온다. */
const anchorProximitySchema = z
  .strictObject({
    초등학교: z.number(),
    중학교: z.number(),
    고등학교: z.number(),
    학원: z.number(),
    오피스: z.number(),
    병원: z.number(),
  })
  .partial()

const locationRawSchema = z.strictObject({
  최근접역: z.string().nullable(),
  최근접역_거리m: nullableNumber,
  역세권_강도: nullableNumber,
  역세권_강도_주: z.string(),
  유인시설_기준: z.string(),
  유인시설_근접도: nullableNumber,
  유인시설_종류별: anchorProximitySchema.nullable(),
  반경500m_해당시설수: nullableNumber,
  버스정류장_밀도: nullableNumber,
})

const stabilityRawSchema = z.strictObject({
  '3년_생존율': nullableNumber,
  최근_폐업률: nullableNumber,
  평균_업력_년: nullableNumber,
  '임대료_천원_㎡': nullableNumber,               // 좌표 요청은 rent_area가 null이라 null (backend README)
  임대료_상권: z.string().nullable(),
  인천_업종평균_3년생존율: z.number(),
})

export const MarketIndicatorSchema = indicatorSchema('market', '시장성', marketRawSchema, ['m1', 'm3', 'm2', 'm4'])
export const CustomerIndicatorSchema = indicatorSchema('customer', '고객성', customerRawSchema, ['c1', 'c2', 'c3', 'c4'])
export const CompetitionIndicatorSchema = indicatorSchema(
  'competition',
  '경쟁성',
  z.union([competitionRawSchema, competitionVacantRawSchema]),
  ['p2', 'p1', 'p4'],
)
export const LocationIndicatorSchema = indicatorSchema('location', '입지성', locationRawSchema, ['l2', 'l3', 'l1', 'l4'])
export const StabilityIndicatorSchema = indicatorSchema('stability', '안정성', stabilityRawSchema, ['s1', 's2', 's3', 's4'])

// ─── 초보자 접근성 (access.access_tag) ───────────────────────────────

const schoolCheckSchema = z.strictObject({
  기준: z.string(),
  학교수: z.number().int().nonnegative(),
  목록: z.array(
    z.strictObject({
      종류: z.enum(['초등학교', '중학교', '고등학교']),
      이름: z.string().nullable(),
      거리_m: z.number(),
    }),
  ),
  판단: z.string(),
})

const beginnerAccessSchema = z.strictObject({
  제도_진입장벽: z.enum(['낮음', '중간', '높음']),
  이유: z.array(z.string()),
  인허가: z.string(),
  근거: z.string(),
  필요_면허: z.string().nullable(),
  면허_보유: z.boolean().nullable(),               // 면허가 필요 없는 업종은 null
  입지_규제: z.string().nullable(),
  개업전_교육: z.string().nullable(),
  창업비용_참고: z.strictObject({
    값_만원: nullableNumber,
    기준: z.string(),
    비교: z.string(),
  }),
  점수_반영: z.literal(false),
  // 입지 규제 업종만 키가 생긴다. 학교 데이터가 없으면 null (access.school_check)
  주변_학교: schoolCheckSchema.nullable().optional(),
})

// ─── 엔진 결과 ───────────────────────────────────────────────────────

/** AnalysisService.analyze() 반환 dict (= POST /analyze 의 result). */
export const EngineResultSchema = z.strictObject({
  meta: metaSchema,
  종합: summarySchema,
  // 엔진은 항상 5개를 이 순서로 낸다 (scoring.analyze inds)
  지표: z.tuple([
    MarketIndicatorSchema,
    CustomerIndicatorSchema,
    CompetitionIndicatorSchema,
    LocationIndicatorSchema,
    StabilityIndicatorSchema,
  ]),
  // access_tag는 표에 없는 업종이면 None이지만 API 업종 29개는 모두 표에 있다
  초보자_접근성: beginnerAccessSchema,
  경고: z.array(z.string()),
  면책: z.string(),
})

// ─── POST /analyze ───────────────────────────────────────────────────

/** backend AnalyzeContext — ContextBuilder가 만든 위치 정보 중 공개 필드 7개. */
export const AnalyzeContextSchema = z.strictObject({
  lat: z.number(),
  lng: z.number(),
  gu_code: z.string(),
  gu_name: z.string(),
  dong_name: z.string(),
  label: z.string(),
  rent_area: z.string().nullable(),              // MVP 일반 좌표는 R-ONE 임대료 상권을 연결하지 않아 항상 null (D-015)
})

export const AnalyzeResponseSchema = z.strictObject({
  context: AnalyzeContextSchema,
  result: EngineResultSchema,
})

// ─── 오류 (D-014) ────────────────────────────────────────────────────

/** 422 사용자 입력·분석 불가 code. */
export const USER_ERROR_CODES = [
  'invalid_request',
  'invalid_business',
  'invalid_analysis_options',
  'invalid_coordinate',
  'location_outside',
  'no_data_nearby',
] as const

export const ErrorCodeSchema = z.enum([...USER_ERROR_CODES, 'internal_error'])

export const ErrorResponseSchema = z.strictObject({
  error: z.discriminatedUnion('code', [
    z.strictObject({
      code: z.enum(USER_ERROR_CODES),
      message: z.string(),
    }),
    // 500만 request_id (uuid4().hex)
    z.strictObject({
      code: z.literal('internal_error'),
      message: z.string(),
      request_id: z.string().regex(/^[0-9a-f]{32}$/),
    }),
  ]),
})

// ─── GET /businesses ─────────────────────────────────────────────────

export const BusinessSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
  group: BusinessGroupCodeSchema,
})

export const BusinessGroupSchema = z
  .strictObject({
    code: BusinessGroupCodeSchema,
    name: z.string(),
    businesses: z.array(BusinessSchema),
  })
  .refine((g) => g.businesses.every((b) => b.group === g.code), {
    message: '업종의 group이 소속 그룹 code와 다릅니다',
  })

export const BusinessCatalogSchema = z
  .strictObject({
    groups: z.array(BusinessGroupSchema),
    total: z.number().int(),
  })
  .refine((c) => c.total === c.groups.reduce((n, g) => n + g.businesses.length, 0), {
    message: 'total이 업종 수와 다릅니다',
  })

// ─── 파생 타입 (손으로 쓰지 않는다) ──────────────────────────────────

export type PerspectiveKey = z.infer<typeof PerspectiveKeySchema>
export type BusinessGroupCode = z.infer<typeof BusinessGroupCodeSchema>
export type EngineResult = z.infer<typeof EngineResultSchema>
export type MarketIndicator = z.infer<typeof MarketIndicatorSchema>
export type CustomerIndicator = z.infer<typeof CustomerIndicatorSchema>
export type CompetitionIndicator = z.infer<typeof CompetitionIndicatorSchema>
export type LocationIndicator = z.infer<typeof LocationIndicatorSchema>
export type StabilityIndicator = z.infer<typeof StabilityIndicatorSchema>
export type AnalyzeContext = z.infer<typeof AnalyzeContextSchema>
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>
export type ErrorCode = z.infer<typeof ErrorCodeSchema>
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
export type Business = z.infer<typeof BusinessSchema>
export type BusinessGroup = z.infer<typeof BusinessGroupSchema>
export type BusinessCatalog = z.infer<typeof BusinessCatalogSchema>
