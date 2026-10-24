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
 *
 * 엔진 v0.5(`mvp-0.5`, D-028): raw·접근성에 v0.5 항목이 더해지고 경쟁성 세부지표에 p3(상권 집적도)가 생긴다.
 * 필드는 한 schema에 선택(optional)으로 두고, 엔진 버전과 맞는지(v0.5는 전부 있음, v0.3·v0.4는 전부 없음)를
 * EngineResultSchema의 검사(checkVersionFields)가 강제한다 — 버전이 다른 필드가 섞여 오면 계약 오류다.
 * 근거: tests/golden/v0.5(팀 전달 결과) + r300·r1000, scoring_engine/v0_5/scoring.py.
 * `mvp-0.5.1`(D-029)은 v0.5 + 분동 배분 결함 수정으로 응답 형태가 v0.5와 같다 — isAreaWeightedEngine 으로 함께 다룬다.
 */
import { z } from 'zod'

// ─── 공통 ────────────────────────────────────────────────────────────

/** 엔진 config.PERSPECTIVES — 5대 관점, 이 순서가 화면 순서다 (DESIGN.md P3). */
export const PERSPECTIVE_KEYS = ['market', 'customer', 'competition', 'location', 'stability'] as const
export const PerspectiveKeySchema = z.enum(PERSPECTIVE_KEYS)

/** 엔진 config.BIZ_GROUP 키. */
export const BusinessGroupCodeSchema = z.enum(['A_고객밀착형', 'B_유동인구형', 'C_목적방문형', 'D_체류소비형'])

const nullableNumber = z.number().nullable()

/**
 * 0~100 점수. None = 계산 불가.
 * 세부지표(breakdown) 점수는 비교 모집단 대비 백분위(pct_rank, 역방향 지표는 100 − 백분위, C4·L3 예외)이고,
 * 관점·종합 점수는 그 가중평균이라 백분위·순위가 아니다 (docs/SCORE_EXPLANATION_AUDIT.md 3장).
 */
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
  // 8-D3: v0.4(분석 반경 300·500·1,000m, D-024), v0.5(팀 v0.5 + 반경, D-028)도 받는다. 그 밖은 계약 오류
  // v0.5.1(D-029): v0.5 + 분동 배분 결함 수정, 응답 형태는 v0.5와 같다
  엔진버전: z.enum(['mvp-0.3', 'mvp-0.4', 'mvp-0.5', 'mvp-0.5.1']),
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
  타겟연령_거주인구: nullableNumber,                 // v0.5: 반경 면적 배분 값(인구_기준), v0.3·v0.4: 행정동 전체
  타겟연령_비중: nullableNumber,
  종사자수: nullableNumber,                         // v0.5: 반경 면적 배분 값
  '1인세대_비중': nullableNumber,                   // 행정동 값(모든 버전)
  // ── v0.5 ──
  종사자_민감도: z.number().optional(),              // 0.5 + 0.5 × 직장형 선호
  '1인가구_민감도': z.number().min(-1).max(1).optional(), // 음수 = 1인가구가 많을수록 불리한 가족형 업종
  인구_기준: z.string().optional(),                  // "반경 {r}m 배분" | "행정동 전체"
})

/** 반경 안 동종점포가 있을 때 (일반 경로). */
const competitionRawSchema = z.strictObject({
  반경m: z.number(),
  동종점포수: z.number().int().positive(),           // 정확 일치(소분류가 같은 점포) — 지도 점포 목록 수와 같다
  전체점포수: z.number(),
  동종업종_비중: z.number(),                         // v0.5: 실효 동종 ÷ 전체
  반경_추정수요: z.number(),                         // v0.5: 반경 거주 + 종사자(면적 배분), v0.3·v0.4: 반경 거주인구(점포 분포 배분)
  점포당_잠재수요: z.number(),                       // v0.5: 추정수요 ÷ 실효 동종 수
  최근1년_동종_순증감: nullableNumber,
  // ── v0.5 ──
  동종점포수_정확일치: z.number().int().positive().optional(),
  '동종점포수_실효(대체업종_포함)': z.number().positive().optional(),  // 같은 업종 + 대체업종 × 계수 (소수 1자리)
  대체업종_계수: z.record(z.string(), z.number()).optional(),
  업종_집적유형: z.enum(['집적형', '중간형', '근린형']).optional(),
  집적_계수: z.number().optional(),
  상권_집적도_백분위: scoreSchema.nullable().optional(),  // 반경 전체 점포 수의 백분위 — 상권 우수성·성공 가능성 순위가 아니다
  잠재수요_구성: z.record(z.string(), z.number()).optional(),
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
  반경500m_해당시설수: nullableNumber,              // 분석 반경과 무관한 엔진 고정 500m
  버스정류장_밀도: nullableNumber,
  // ── v0.5 ──
  역_의존도: z.number().min(0).max(1).optional(),
  학교구역_제외_학교수: z.number().int().nonnegative().nullable().optional(),  // 학교구역 미적용 업종은 null
})

const stabilityRawSchema = z.strictObject({
  '3년_생존율': nullableNumber,
  최근_폐업률: nullableNumber,
  평균_업력_년: nullableNumber,
  '임대료_천원_㎡': nullableNumber,               // 좌표 요청은 rent_area가 null이라 null (backend README)
  임대료_상권: z.string().nullable(),
  인천_업종평균_3년생존율: z.number(),
  임대료_해석: z.string().nullable().optional(),    // v0.5: 임대료(S4)가 계산됐을 때만 문장, 아니면 null
})

export const MarketIndicatorSchema = indicatorSchema('market', '시장성', marketRawSchema, ['m1', 'm3', 'm2', 'm4'])
export const CustomerIndicatorSchema = indicatorSchema('customer', '고객성', customerRawSchema, ['c1', 'c2', 'c3', 'c4'])
export const CompetitionIndicatorSchema = indicatorSchema(
  'competition',
  '경쟁성',
  z.union([competitionRawSchema, competitionVacantRawSchema]),
  ['p2', 'p1', 'p4', 'p3'],                          // p3 상권 집적도는 v0.5 집적형·중간형 업종만
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
  // v0.5: 입지 규제 업종이고 지점 200m 안에 초·중·고가 있을 때만 (경고[0] 학교구역 경고와 함께)
  학교구역_200m_학교수: z.number().int().positive().optional(),
})

// ─── 엔진 결과 ───────────────────────────────────────────────────────

/**
 * 엔진 v0.5 계열(면적 배분·고객성 반경 입력·v0.5 raw 항목): mvp-0.5(팀 전달), mvp-0.5.1(분동 배분 수정, D-029).
 * 화면의 v0.5 설명·문구 분기는 모두 이 함수로 판정한다.
 */
export const isAreaWeightedEngine = (version: string | null | undefined): boolean =>
  version === 'mvp-0.5' || version === 'mvp-0.5.1'

/** v0.5에만 있는 raw 키 (관점별). 경쟁성은 동종점포가 있는 일반 경로에서만 (0곳 raw는 버전과 같다). */
const V05_RAW_KEYS = {
  customer: ['종사자_민감도', '1인가구_민감도', '인구_기준'],
  competition: [
    '동종점포수_정확일치',
    '동종점포수_실효(대체업종_포함)',
    '대체업종_계수',
    '업종_집적유형',
    '집적_계수',
    '상권_집적도_백분위',
    '잠재수요_구성',
  ],
  location: ['역_의존도', '학교구역_제외_학교수'],
  stability: ['임대료_해석'],
} as const

type RawCheckTarget = { key: string; raw: object; breakdown: readonly { key: string }[] }

/** 엔진 버전과 v0.5 필드가 맞는지: v0.5면 해당 키가 모두 있고, v0.3·v0.4면 하나도 없다. */
function checkVersionFields(
  r: { meta: { 엔진버전: string }; 지표: readonly RawCheckTarget[]; 초보자_접근성: object },
  ctx: z.RefinementCtx,
) {
  const v05 = isAreaWeightedEngine(r.meta.엔진버전)
  for (const [i, ind] of r.지표.entries()) {
    const keys = (V05_RAW_KEYS as Record<string, readonly string[]>)[ind.key] ?? []
    const vacant = ind.key === 'competition' && (ind.raw as { 동종점포수?: number }).동종점포수 === 0
    for (const k of vacant ? [] : keys) {
      if (Object.hasOwn(ind.raw, k) !== v05) {
        ctx.addIssue({ code: 'custom', path: ['지표', i, 'raw', k], message: `${r.meta.엔진버전} 응답에 맞지 않는 raw 키` })
      }
    }
    if (!v05 && ind.breakdown.some((b) => b.key === 'p3')) {
      ctx.addIssue({ code: 'custom', path: ['지표', i, 'breakdown'], message: 'p3(상권 집적도)는 v0.5에만 있다' })
    }
  }
  if (!v05 && Object.hasOwn(r.초보자_접근성, '학교구역_200m_학교수')) {
    ctx.addIssue({ code: 'custom', path: ['초보자_접근성', '학교구역_200m_학교수'], message: 'v0.5에만 있다' })
  }
}

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
}).superRefine(checkVersionFields)

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

// ─── POST /nearby-stores (4차, D-019) ────────────────────────────────

/** 반경 안 같은 업종 점포 1곳 (scoring_engine/nearby.py NearbyStore). 상호·주소는 없을 수 있다(null). */
export const NearbyStoreSchema = z.strictObject({
  id: z.string(),                                // 상가업소번호
  name: z.string().nullable(),
  road_address: z.string().nullable(),
  jibun_address: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  distance_m: z.number().int().min(0),           // 분석 지점과의 직선거리(m). 도보 거리가 아니다
})

/** 반경 안 동종 점포 목록. count == stores.length == 같은 조건 /analyze 의 경쟁성.raw.동종점포수. */
export const NearbyStoresResponseSchema = z
  .strictObject({
    lat: z.number(),
    lng: z.number(),
    biz_code: z.string(),
    radius_m: z.number(),
    as_of: z.string(),                           // 상가(상권)정보 기준일
    count: z.number().int().min(0),
    stores: z.array(NearbyStoreSchema),          // 가까운 순
  })
  .refine((r) => r.count === r.stores.length, { message: 'count와 stores 수가 다릅니다' })

// ─── 오류 (D-014) ────────────────────────────────────────────────────

/** 422 사용자 입력·분석 불가 code. */
export const USER_ERROR_CODES = [
  'invalid_request',
  'invalid_business',
  'invalid_analysis_options',
  'invalid_coordinate',
  'location_outside',
  'no_data_nearby',
  'invalid_radius',                               // 8-D2: 서버 엔진이 받지 않는 분석 반경 (D-024)
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

// ─── GET /health (8-D2·8-D3, D-024) ──────────────────────────────────

/**
 * 서버 엔진 광고. 구버전 서버(8-D2 이전, 현재 운영)는 engine 필드가 없다 → 반경 선택 없음.
 * health 의 나머지 필드(status·warm 등)는 화면이 쓰지 않으므로 검사하지 않는다(이 객체만 strict 아님).
 */
export const EngineInfoSchema = z.strictObject({
  version: z.string(),
  radius_options: z.array(z.number().int().positive()),
  default_radius_m: z.number().int().positive(),
})

export const HealthSchema = z.object({ engine: EngineInfoSchema.optional() })

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
export type NearbyStore = z.infer<typeof NearbyStoreSchema>
export type NearbyStoresResponse = z.infer<typeof NearbyStoresResponseSchema>
export type EngineInfo = z.infer<typeof EngineInfoSchema>
export type Health = z.infer<typeof HealthSchema>
