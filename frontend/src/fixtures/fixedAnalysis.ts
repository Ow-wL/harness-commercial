import { AnalyzeResponseSchema } from '../api/schemas.ts'
import fixture from './bupyeong-pcbang.json'

/**
 * TASKS 4-3 화면 데이터: 실제 backend `POST /analyze {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}`
 * 응답을 그대로 캡처한 것(일반 ContextBuilder 경로, rent_area=null). legacy golden이 아니다.
 * live API 응답과 같은 schema 검증을 거친 값만 화면에 넘긴다. live API 연결은 TASKS 4-4.
 */
export const FIXED_ANALYSIS = AnalyzeResponseSchema.parse(fixture)
