// 우리동네 상권분석 매니저 — 발표용 PPT (3차): 운영 화면 캡처, 장식 최소화, 한글 글꼴 Pretendard 고정
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");
const JSZip = require("jszip");
const React = require("react");
const RDS = require("react-dom/server");
const sharp = require("sharp");
const Fi = require("react-icons/fi");
const { applyTheme } = require(
  "C:/Users/Joohy/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/local-agent-mode-sessions/skills-plugin/8392bc85-57d2-4a26-a39f-9694b503b5a7/04ee2feb-9538-482e-a762-ffa6ddc5f900/skills/pptx/scripts/apply_theme.js"
);

const OUT = path.join(__dirname, "harness-commercial-presentation.pptx");
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "shots-prod");
const SHOT = (n) => path.join(SHOTS, n);
const ASSET = (n) => path.join(__dirname, "assets", n);
fs.mkdirSync(path.join(__dirname, "assets"), { recursive: true });

// ---------- 테마 ----------
const FONT = "Pretendard";
const THEME = {
  name: "Harness Blue",
  headFontFace: FONT, bodyFontFace: FONT,
  colors: {
    dk1: "0A1226", lt1: "FFFFFF", dk2: "5B6880", lt2: "EEF3FF",
    accent1: "3B6EF0", accent2: "1E8E5A", accent3: "D9822B", accent4: "D64561", accent5: "7AA2FF", accent6: "12A58A",
    hlink: "3B6EF0", folHlink: "7AA2FF",
  },
};
const H = THEME.colors;
const PANEL = "15223F", PANEL2 = "1D2D52", EDGE = "2A3B66", LINE = "E3EAF7";
// 관점 식별색(앱과 같음)
const PCOL = { 시장성: "7FA6FF", 고객성: "4FD1B0", 경쟁성: "B7A2FF", 입지성: "9AD46F", 안정성: "E6CB7A" };

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
pres.title = "우리동네 상권분석 매니저 — 발표 자료";
pres.author = "harness-commercial";
const C = pres.SchemeColor;

// ---------- 그림 자산 ----------
async function png(svg, file) { const p = ASSET(file); await sharp(Buffer.from(svg)).png().toFile(p); return p; }
async function makeRadar(scores, file, { size = 600, fill = "#3B6EF0", stroke = "#7AA2FF", grid = "#3A4A72" } = {}) {
  const cx = size / 2, cy = size / 2, R = size * 0.4;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const ring = (f, dash) => `<polygon points="${[0, 1, 2, 3, 4].map((i) => pt(i, R * f).join(",")).join(" ")}" fill="none" stroke="${grid}" stroke-width="${dash ? 2 : 1.2}" ${dash ? 'stroke-dasharray="6 6"' : ""}/>`;
  const axes = [0, 1, 2, 3, 4].map((i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${grid}" stroke-width="1"/>`; }).join("");
  const poly = scores.map((s, i) => pt(i, (R * s) / 100).join(",")).join(" ");
  const dots = scores.map((s, i) => { const [x, y] = pt(i, (R * s) / 100); return `<circle cx="${x}" cy="${y}" r="7" fill="${stroke}" stroke="#0A1226" stroke-width="2.5"/>`; }).join("");
  return png(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${ring(0.25)}${ring(0.5, true)}${ring(0.75)}${ring(1)}${axes}<polygon points="${poly}" fill="${fill}" fill-opacity=".35" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>${dots}</svg>`, file);
}

// ---------- 아이콘 ----------
const iconCache = new Map();
async function icon(Comp, hex, size = 256) {
  const key = Comp.name + hex;
  if (iconCache.has(key)) return iconCache.get(key);
  const svg = RDS.renderToStaticMarkup(React.createElement(Comp, { size })).replace(/currentColor/g, "#" + hex);
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  const data = "image/png;base64," + buf.toString("base64");
  iconCache.set(key, data);
  return data;
}
// 아이콘: 밝은 바탕은 옅은 파랑 원 + 파랑 선, 어두운 바탕은 짙은 원 + 밝은 파랑 선. 뜻이 있는 색(확인/없음)만 keep.
async function iconCircle(slide, Comp, x, y, d, { dark = false, keep = null, name = "아이콘" } = {}) {
  const circle = keep ? keep : dark ? PANEL2 : H.lt2;
  const glyph = keep ? "FFFFFF" : dark ? H.accent5 : H.accent1;
  slide.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: circle }, line: { color: circle, width: 0 }, objectName: name + " 배경" });
  const g = d * 0.5;
  slide.addImage({ data: await icon(Comp, glyph), x: x + (d - g) / 2, y: y + (d - g) / 2, w: g, h: g, objectName: name });
}

// ---------- 헬퍼 ----------
const shadow = () => ({ type: "outer", color: H.dk1, blur: 8, offset: 2, angle: 90, opacity: 0.12 });
function T(slide, text, o = {}) {
  return slide.addText(text, { isTextBox: true, fontSize: 14, color: C.text1, margin: 0, valign: "top", align: "left", ...o });
}
function card(slide, x, y, w, h, { fill = C.background2, line, radius = 0.1, name = "카드" } = {}) {
  slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: line ? { color: line, width: 0.75 } : { color: fill, width: 0 }, rectRadius: radius, objectName: name });
}
function tag(slide, text, x, y, w, h, { fill = H.accent1, color = "FFFFFF", fontSize = 10 } = {}) {
  slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: 0.06, objectName: "표시" });
  T(slide, text, { x, y, w, h, fontSize, bold: true, color, align: "center", valign: "middle" });
}
function arrow(slide, x1, y1, x2, y2, { color = H.accent1, width = 1.75, dash } = {}) {
  const o = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), line: { color, width, endArrowType: "triangle" }, objectName: "화살표" };
  if (dash) o.line.dashType = dash;
  if (x2 < x1) o.flipH = true;
  if (y2 < y1) o.flipV = true;
  slide.addShape(pres.ShapeType.line, o);
}
function bullets(slide, items, x, y, w, h, { fontSize = 14, color = C.text1, gap = 6 } = {}) {
  const runs = items.map((it, i) => ({ text: it, options: { bullet: { indent: 14 }, paraSpaceAfter: gap, breakLine: i < items.length - 1 } }));
  slide.addText(runs, { isTextBox: true, x, y, w, h, fontSize, color, margin: 0, valign: "top" });
}
async function iconRow(slide, Comp, x, y, w, head, desc, { dark = false, keep = null, size = 0.5, headSize = 14, descSize = 11.5 } = {}) {
  await iconCircle(slide, Comp, x, y, size, { dark, keep, name: head });
  T(slide, head, { x: x + size + 0.2, y: y - 0.03, w: w - size - 0.2, h: 0.32, fontSize: headSize, bold: true, color: dark ? C.background1 : C.text1 });
  if (desc) T(slide, desc, { x: x + size + 0.2, y: y + 0.27, w: w - size - 0.2, h: 0.55, fontSize: descSize, color: dark ? C.background2 : C.text2 });
}
function screenshot(slide, file, x, y, w, h, { caption, name = "화면" } = {}) {
  slide.addShape(pres.ShapeType.roundRect, { x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, fill: { color: PANEL }, line: { color: EDGE, width: 1 }, rectRadius: 0.1, shadow: shadow(), objectName: name + " 틀" });
  slide.addImage({ path: file, x, y, w, h, objectName: name });
  if (caption) T(slide, caption, { x: x - 0.06, y: y + h + 0.12, w: w + 0.12, h: 0.3, fontSize: 10.5, color: C.text2 });
}
// 제목 + 한 줄 부제
function heading(slide, title, sub) {
  slide.addText(title, { placeholder: "title" });
  if (sub) T(slide, sub, { x: 0.6, y: 1.08, w: 12.1, h: 0.3, fontSize: 12.5, color: C.text2 });
}

// ---------- 레이아웃 ----------
function defineLayouts() {
  const num = { x: 12.1, y: 7.0, w: 0.6, h: 0.3, fontSize: 9, color: C.text2, align: "right" };
  pres.defineSlideMaster({
    title: "TITLE_DARK", background: { color: H.dk1 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 2.5, w: 6.8, h: 1.5, fontSize: 42, bold: true, color: C.background1, valign: "bottom", margin: 0, align: "left" }, text: "" } },
      { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 4.15, w: 6.3, h: 1.3, fontSize: 17, color: C.background2, valign: "top", margin: 0, align: "left" }, text: "" } },
    ],
  });
  pres.defineSlideMaster({
    title: "SECTION_DARK", background: { color: H.dk1 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 3.0, w: 11.9, h: 1.1, fontSize: 40, bold: true, color: C.background1, valign: "bottom", margin: 0, align: "left" }, text: "" } },
      { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 4.25, w: 11.0, h: 1.0, fontSize: 17, color: C.background2, valign: "top", margin: 0, align: "left" }, text: "" } },
    ],
    slideNumber: num,
  });
  pres.defineSlideMaster({
    title: "CONTENT", background: { color: H.lt1 },
    objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.38, w: 12.1, h: 0.7, fontSize: 26, bold: true, color: C.text1, valign: "middle", margin: 0, align: "left" }, text: "" } }],
    slideNumber: num,
  });
  pres.defineSlideMaster({
    title: "CONTENT_DARK", background: { color: H.dk1 },
    objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.38, w: 12.1, h: 0.7, fontSize: 26, bold: true, color: C.background1, valign: "middle", margin: 0, align: "left" }, text: "" } }],
    slideNumber: num,
  });
}
const addContent = (section, dark = false) => pres.addSlide({ masterName: dark ? "CONTENT_DARK" : "CONTENT", sectionTitle: section });
function sectionSlide(section, num, title, body) {
  const s = pres.addSlide({ masterName: "SECTION_DARK", sectionTitle: section });
  T(s, num, { x: 0.7, y: 2.1, w: 3, h: 0.8, fontSize: 56, bold: true, color: H.accent5 });
  s.addText(title, { placeholder: "title" });
  s.addText(body, { placeholder: "body" });
  return s;
}

// =====================================================================
async function build() {
  defineLayouts();
  const radarA = await makeRadar([44.4, 84.7, 39.7, 86.3, 55.1], "radar-a.png");

  // ---------------- 표지 ----------------
  pres.addSection({ title: "표지" });
  {
    const s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "표지" });
    T(s, "캡스톤 디자인 발표 · 2026년 11월", { x: 0.7, y: 2.0, w: 6, h: 0.35, fontSize: 12.5, color: H.accent5 });
    s.addText("우리동네 상권분석 매니저", { placeholder: "title" });
    s.addText("인천 지도에서 자리와 업종을 고르면\n그 자리를 다섯 관점으로 살펴 줍니다.", { placeholder: "body" });
    T(s, "앱 v0.3.3  ·  점수 엔진 v0.5.1  ·  데이터 2026-09", { x: 0.7, y: 5.7, w: 6.5, h: 0.35, fontSize: 12, color: C.text2 });
    screenshot(s, SHOT("result-dark-up.png"), 7.55, 1.65, 5.2, 3.25, { name: "결과 대시보드" });
    T(s, "결과 대시보드 · 부평구 부평1동 · 카페 (운영 화면)", { x: 7.55, y: 5.1, w: 5.2, h: 0.3, fontSize: 10.5, color: C.text2, align: "center" });
    s.addNotes("표지. 한 줄 소개와 운영 버전. 점수는 매출·성공 확률이 아니라 인천 안 상대 위치라는 점을 첫 장부터 짚는다.");
  }

  // ---------------- 목차 ----------------
  {
    const s = addContent("표지");
    heading(s, "오늘 이야기할 것");
    const items = [
      ["01", "왜 필요한가", "문제 · 인천의 공백 · 원칙"],
      ["02", "무엇을 만들었나", "다섯 관점 · 점수의 뜻 · 기능"],
      ["03", "화면과 흐름", "시작 · 결과 · AI · 비교 · 활용"],
      ["04", "구조 · 검증 · 다음", "구조 · 신뢰 · 검증 결과 · 다음 단계"],
    ];
    items.forEach(([n, t, d], i) => {
      const y = 1.7 + i * 1.25;
      s.addShape(pres.ShapeType.line, { x: 0.6, y, w: 12.1, h: 0, line: { color: LINE, width: 1 }, objectName: "구분선" });
      T(s, n, { x: 0.6, y: y + 0.25, w: 1.2, h: 0.6, fontSize: 28, bold: true, color: H.accent1 });
      T(s, t, { x: 1.9, y: y + 0.25, w: 5, h: 0.6, fontSize: 24, bold: true, valign: "middle" });
      T(s, d, { x: 7.0, y: y + 0.25, w: 5.7, h: 0.6, fontSize: 14, color: C.text2, valign: "middle" });
    });
    s.addShape(pres.ShapeType.line, { x: 0.6, y: 6.7, w: 12.1, h: 0, line: { color: LINE, width: 1 }, objectName: "구분선" });
  }

  // =====================================================================
  pres.addSection({ title: "01 왜 필요한가" });
  sectionSlide("01 왜 필요한가", "01", "왜 필요한가", "정보 없이 시작한 창업은 일찍 문을 닫는다. 그런데 인천에는 참고할 서비스가 없다.");

  // ---- 문제 ----
  {
    const s = addContent("01 왜 필요한가");
    heading(s, "정보 없이 시작한 창업은 일찍 문을 닫는다", "팀 기획보고서 정정본 v2(2026-09-21)에 인용된 통계");
    const stats = [["34.3%", "1~3년차 단기 폐업\n(폐업 소상공인 중)", H.accent4], ["10.2%", "창업 주저 이유\n'정보·경험 부족'", H.accent3], ["9.73%", "인천 폐업률\n(중기부·국세청)", H.accent4], ["−6.9%", "30세 미만 사업자\n2025년 1분기, 전년 대비", H.accent1]];
    stats.forEach(([n, l, col], i) => {
      const x = 0.6 + i * 3.075;
      card(s, x, 1.6, 2.85, 2.55, { name: "통계 카드" });
      T(s, n, { x: x + 0.3, y: 1.8, w: 2.4, h: 1.0, fontSize: 46, bold: true, color: col, valign: "middle" });
      T(s, l, { x: x + 0.3, y: 2.9, w: 2.4, h: 0.8, fontSize: 12.5, color: C.text2 });
    });
    card(s, 0.6, 4.5, 12.1, 1.85, { fill: C.text1, name: "결론 카드" });
    T(s, "타겟: 청년 예비 창업자", { x: 1.0, y: 4.75, w: 10, h: 0.5, fontSize: 21, bold: true, color: C.background1 });
    T(s, [
      { text: "\"얼마 벌까\"가 아니라 ", options: { color: C.background2 } },
      { text: "\"버틸 수 있나\"", options: { color: H.accent5, bold: true } },
      { text: "를 함께 본다. 안정성(생존율·폐업률·업력) 비중을 높이고, 결정은 사용자가 한다.", options: { color: C.background2 } },
    ], { x: 1.0, y: 5.3, w: 11.2, h: 0.8, fontSize: 15 });
    T(s, "수치는 당시 인용값이라 발표 전 원출처 재확인이 필요하다", { x: 0.6, y: 6.5, w: 12.1, h: 0.3, fontSize: 10, color: C.text2 });
    s.addNotes("문제 정의. 34.3%(1~3년차 단기 폐업)가 제품 철학의 근거. 타겟은 청년 예비 창업자.");
  }

  // ---- 인천의 공백 ----
  {
    const s = addContent("01 왜 필요한가");
    heading(s, "인천에는 참고할 상권분석 서비스가 없다");
    const cities = [
      ["서울", "golmok.seoul.go.kr", [["광역 상권분석", true], ["행정동 추정 매출", true], ["시간대 유동(행정동)", true]]],
      ["경기", "sbiz.gmr.or.kr", [["광역 상권분석", true], ["행정동 추정 매출", "partial"], ["시간대 유동(시군구)", true]]],
      ["인천", "없음", [["광역 상권분석", false], ["행정동 추정 매출", false], ["시간대 유동(시군구)", true]]],
    ];
    for (let i = 0; i < 3; i++) {
      const [name, url, rows] = cities[i];
      const x = 0.6 + i * 4.1, y = 1.6, w = 3.9, h = 2.9;
      card(s, x, y, w, h, { fill: C.background1, line: i === 2 ? H.accent4 : LINE, name: "지역 카드" });
      T(s, name, { x: x + 0.3, y: y + 0.2, w: 2, h: 0.5, fontSize: 24, bold: true, color: i === 2 ? H.accent4 : C.text1 });
      T(s, url, { x: x + 0.3, y: y + 0.72, w: w - 0.6, h: 0.3, fontSize: 11, color: C.text2 });
      for (let r = 0; r < rows.length; r++) {
        const [label, ok] = rows[r];
        const ry = y + 1.2 + r * 0.5;
        const Ic = ok === true ? Fi.FiCheck : ok === "partial" ? Fi.FiMinus : Fi.FiX;
        const c = ok === true ? H.accent2 : ok === "partial" ? H.accent3 : H.accent4;
        await iconCircle(s, Ic, x + 0.3, ry, 0.34, { keep: c, name: "여부" });
        T(s, label, { x: x + 0.78, y: ry, w: w - 1.1, h: 0.34, fontSize: 13, valign: "middle", bold: ok === false });
      }
    }
    T(s, "그래서 전국 공개 데이터로 직접 계산한다", { x: 0.6, y: 4.75, w: 7, h: 0.4, fontSize: 17, bold: true });
    T(s, "매출 원본이 없으므로 절대 매출 대신 인천 안 상대 위치로만 말한다", { x: 6.0, y: 4.82, w: 6.7, h: 0.35, fontSize: 12, color: C.text2, align: "right" });
    const srcs = [[Fi.FiShoppingBag, "상가정보", "소상공인진흥공단"], [Fi.FiUsers, "주민등록 인구", "행정안전부"], [Fi.FiActivity, "생활이동", "서울시 × KT"], [Fi.FiNavigation, "역사 · 학교", "공공데이터포털"], [Fi.FiClipboard, "인허가 · 임대료", "행안부 · 부동산원"]];
    const sw = (12.1 - 4 * 0.2) / 5;
    for (let i = 0; i < 5; i++) {
      const x = 0.6 + i * (sw + 0.2);
      card(s, x, 5.3, sw, 1.15, { name: "자료 카드" });
      await iconCircle(s, srcs[i][0], x + 0.2, 5.5, 0.5, { name: "자료" });
      T(s, srcs[i][1], { x: x + 0.85, y: 5.48, w: sw - 1.0, h: 0.3, fontSize: 13, bold: true });
      T(s, srcs[i][2], { x: x + 0.85, y: 5.78, w: sw - 1.0, h: 0.3, fontSize: 10.5, color: C.text2 });
    }
    T(s, "2026-07-01 인천 행정구역 개편(2군 9구)도 새 체계로 반영", { x: 0.6, y: 6.58, w: 12.1, h: 0.3, fontSize: 10, color: C.text2 });
    s.addNotes("인천의 데이터 공백. 서울 golmok·경기 GMR에 대응하는 서비스가 없고 행정동 매출 원본도 없다. 공개 데이터 5종으로 직접 계산한다.");
  }

  // ---- 원칙 ----
  {
    const s = addContent("01 왜 필요한가");
    heading(s, "제품이 지키는 다섯 가지 원칙");
    const P = [
      [Fi.FiCpu, "엔진은 숫자까지만", "해석과 제안은 화면과 AI가 맡는다"],
      [Fi.FiPercent, "매출을 추정하지 않는다", "인천 안 상대 위치 0~100으로만"],
      [Fi.FiMinusCircle, "결측은 0점이 아니라 제외", "빼고 다시 맞추고, 뺐다고 표시"],
      [Fi.FiFileText, "점수와 원시값을 함께", "근거 숫자 · 단위 · 출처 표시"],
      [Fi.FiAlertTriangle, "경고가 점수보다 먼저", "학교 주변 규제는 맨 위에"],
    ];
    const cw = (12.1 - 4 * 0.22) / 5;
    for (let i = 0; i < 5; i++) {
      const x = 0.6 + i * (cw + 0.22);
      card(s, x, 1.6, cw, 3.3, { name: "원칙 카드" });
      await iconCircle(s, P[i][0], x + 0.25, 1.9, 0.6, { name: "원칙" });
      T(s, `0${i + 1}`, { x: x + 0.25, y: 2.75, w: 1, h: 0.3, fontSize: 12, bold: true, color: H.accent1 });
      T(s, P[i][1], { x: x + 0.25, y: 3.05, w: cw - 0.5, h: 0.9, fontSize: 16, bold: true });
      T(s, P[i][2], { x: x + 0.25, y: 4.0, w: cw - 0.5, h: 0.8, fontSize: 12, color: C.text2 });
    }
    s.addShape(pres.ShapeType.line, { x: 0.6, y: 5.3, w: 12.1, h: 0, line: { color: LINE, width: 1 }, objectName: "구분선" });
    T(s, [
      { text: "쓰지 않는 말   ", options: { bold: true, color: H.accent4 } },
      { text: "순위 · 성공 확률 · 매출 예측 · 추천 · 합격/불합격 · 허가 판단", options: { bold: true } },
      { text: "   화면 문구와 AI 답변 모두 테스트로 막아 둔다", options: { color: C.text2 } },
    ], { x: 0.6, y: 5.5, w: 12.1, h: 0.5, fontSize: 14, valign: "middle" });
    s.addNotes("팀 설계서의 원칙 5가지 + 팀 점검에서 더한 '경고가 점수보다 먼저'. 금지 표현은 프런트·AI 테스트로 고정돼 있다.");
  }

  // =====================================================================
  pres.addSection({ title: "02 무엇을 만들었나" });
  sectionSlide("02 무엇을 만들었나", "02", "무엇을 만들었나", "다섯 관점 점수, 점수의 뜻과 등급, 그리고 분석 다음의 행동까지.");

  // ---- 다섯 관점 ----
  {
    const s = addContent("02 무엇을 만들었나");
    heading(s, "다섯 관점으로 한 자리를 본다");
    card(s, 0.6, 1.6, 4.7, 4.9, { fill: C.text1, name: "거미줄 카드" });
    T(s, "부평구 부평1동 · 카페 · 500m", { x: 0.85, y: 1.78, w: 4.2, h: 0.3, fontSize: 11, color: C.background2 });
    const rx = 1.05, ry = 2.1, rs = 3.8;
    s.addImage({ path: radarA, x: rx, y: ry, w: rs, h: rs, objectName: "거미줄 그래프" });
    const labels = [["시장성", 44.4], ["고객성", 84.7], ["경쟁성", 39.7], ["입지성", 86.3], ["안정성", 55.1]];
    const cx = rx + rs / 2, cy = ry + rs / 2, R = rs * 0.4 + 0.42;
    labels.forEach(([n, v], i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      T(s, [{ text: n + "\n", options: { bold: true, color: C.background1, fontSize: 11 } }, { text: String(v), options: { color: H.accent5, fontSize: 11, bold: true } }], { x: cx + R * Math.cos(a) - 0.6, y: cy + R * Math.sin(a) - 0.28, w: 1.2, h: 0.56, align: "center", valign: "middle" });
    });
    T(s, "점선 50 = 인천 동네 평균 지점", { x: 0.85, y: 6.1, w: 4.2, h: 0.3, fontSize: 10.5, color: C.background2, align: "center" });
    const V = [
      ["시장성", "돈 쓸 사람이 오는가", "구 유입 인구 · 시간대 적합도", "구 단위"],
      ["고객성", "내 손님이 여기 사는가", "타겟 연령 인구 · 종사자 · 1인 가구", "행정동 · 반경 배분"],
      ["경쟁성", "파이 대비 경쟁자는", "같은 업종 점포 수 · 점포당 잠재 수요", "반경 300·500·1,000m"],
      ["입지성", "사람이 닿기 쉬운가", "가까운 역 · 역세권 강도 · 유인시설", "좌표"],
      ["안정성", "버틸 수 있는 동네인가", "3년 생존율 · 폐업률 · 업력 · 임대료", "구 · 상권 (13개 업종)"],
    ];
    V.forEach(([n, q, d, unit], i) => {
      const y = 1.6 + i * 0.98;
      card(s, 5.6, y, 7.1, 0.86, { fill: C.background1, line: LINE, name: "관점 행" });
      s.addShape(pres.ShapeType.ellipse, { x: 5.85, y: y + 0.33, w: 0.2, h: 0.2, fill: { color: PCOL[n] }, line: { color: PCOL[n], width: 0 }, objectName: n + " 색" });
      T(s, n, { x: 6.2, y: y + 0.1, w: 1.3, h: 0.35, fontSize: 17, bold: true });
      T(s, q, { x: 6.2, y: y + 0.47, w: 2.5, h: 0.3, fontSize: 11, color: H.accent1 });
      T(s, d, { x: 8.75, y: y + 0.13, w: 2.6, h: 0.6, fontSize: 11.5, color: C.text2, valign: "middle" });
      T(s, unit, { x: 11.3, y: y + 0.13, w: 1.3, h: 0.6, fontSize: 10, color: C.text1, bold: true, valign: "middle", align: "right" });
    });
    s.addNotes("다섯 관점. 자료 단위가 관점마다 다르다. 안정성은 PC방과 음식 12개 업종만 산출된다.");
  }

  // ---- 점수의 뜻 ----
  {
    const s = addContent("02 무엇을 만들었나");
    heading(s, "점수는 매출이 아니라 인천 안에서의 상대 위치");
    card(s, 0.6, 1.6, 5.6, 2.6, { fill: C.text1, name: "점수 예시 카드" });
    T(s, [{ text: "60.3", options: { fontSize: 60, bold: true, color: C.background1 } }, { text: "  / 100", options: { fontSize: 16, color: C.background2 } }], { x: 0.95, y: 1.75, w: 4, h: 1.05, valign: "middle" });
    tag(s, "보통", 4.4, 2.15, 0.9, 0.38, { fontSize: 13 });
    T(s, "입지성은 좋은 편이지만, 경쟁성이 약한 자리예요", { x: 0.95, y: 2.9, w: 5.0, h: 0.45, fontSize: 15, bold: true, color: C.background1 });
    T(s, "(참고: 반경 500m 안 같은 업종 101곳)", { x: 0.95, y: 3.35, w: 5.0, h: 0.35, fontSize: 12, color: C.background2 });
    T(s, "한 줄 결론 = 가장 높은 관점 + 가장 낮은 관점. 원인은 단정하지 않는다", { x: 0.95, y: 3.77, w: 5.0, h: 0.3, fontSize: 10.5, color: H.accent5 });
    T(s, [{ text: "\"이 점수는?\"  ", options: { bold: true, color: H.accent1 } }, { text: "인천 동네 158곳 평균 지점과 비교해 이 자리가 얼마나 유리한지. 50이면 보통 동네와 비슷. 매출이나 성공 확률이 아니에요." }], { x: 0.6, y: 4.45, w: 5.6, h: 1.1, fontSize: 13.5 });
    T(s, "등급 — 색과 글자를 항상 함께", { x: 6.9, y: 1.6, w: 5.8, h: 0.4, fontSize: 17, bold: true });
    const segs = [[0, 25, "주의", H.accent4], [25, 40, "약함", H.accent3], [40, 70, "보통", H.accent1], [70, 100, "좋음", H.accent2]];
    const bx = 6.9, bw = 5.8, by = 2.65, bh = 0.7;
    segs.forEach(([a, b, name, col]) => {
      const x = bx + (a / 100) * bw, w = ((b - a) / 100) * bw;
      s.addShape(pres.ShapeType.rect, { x, y: by, w, h: bh, fill: { color: col }, line: { color: H.lt1, width: 1.5 }, objectName: "등급 구간" });
      T(s, name, { x, y: by, w, h: bh, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    });
    [0, 25, 40, 70, 100].forEach((v) => T(s, String(v), { x: bx + (v / 100) * bw - 0.3, y: by + bh + 0.05, w: 0.6, h: 0.3, fontSize: 11, color: C.text2, align: "center" }));
    s.addShape(pres.ShapeType.line, { x: bx + bw * 0.5, y: by - 0.15, w: 0, h: bh + 0.3, line: { color: H.dk1, width: 1.5, dashType: "dash" }, objectName: "50 기준선" });
    T(s, "50 = 인천 동네 평균 지점", { x: bx + bw * 0.5 - 1.2, y: by - 0.45, w: 2.4, h: 0.3, fontSize: 10.5, bold: true, align: "center" });
    const pts = [[Fi.FiEye, "색만으로 뜻을 전하지 않는다", "등급 글자 병기"], [Fi.FiAlertTriangle, "25점 미만 관점은 '주의'", "빨간 숫자·막대 + 한 줄 안내"], [Fi.FiSlash, "순위도, 추천도 아니다", "'합격·불합격' 표현 금지"]];
    for (let i = 0; i < 3; i++) await iconRow(s, pts[i][0], 6.9, 4.0 + i * 0.85, 5.8, pts[i][1], pts[i][2]);
    T(s, "등급 경계 70 / 40 / 25는 팀 제안값 — 엔진 담당과 확인 예정", { x: 0.6, y: 6.5, w: 12.1, h: 0.3, fontSize: 10, color: C.text2 });
    s.addNotes("점수의 뜻. 결과 화면의 '이 점수는?' 문구를 그대로 읽는다.");
  }

  // ---- 핵심 기능 ----
  const featureSlide = async (title, sub, F) => {
    const s = addContent("02 무엇을 만들었나");
    heading(s, title, sub);
    const cols = 3, rows = 2, gx = 0.3, gy = 0.3;
    const cw = (12.1 - (cols - 1) * gx) / cols, ch = (4.8 - (rows - 1) * gy) / rows;
    for (let i = 0; i < F.length; i++) {
      const [Ic, head, desc] = F[i];
      const cx = 0.6 + (i % cols) * (cw + gx), cy = 1.6 + Math.floor(i / cols) * (ch + gy);
      card(s, cx, cy, cw, ch, { fill: C.background1, line: LINE, name: "기능 카드" });
      await iconCircle(s, Ic, cx + 0.35, cy + 0.4, 0.7, { name: head });
      T(s, head, { x: cx + 1.3, y: cy + 0.4, w: cw - 1.6, h: 0.7, fontSize: 18, bold: true, valign: "middle" });
      T(s, desc, { x: cx + 0.35, y: cy + 1.35, w: cw - 0.7, h: ch - 1.55, fontSize: 12.5, color: C.text2 });
    }
    return s;
  };
  (await featureSlide("핵심 기능 (1) 입력과 결과", "위치·업종·반경을 고르면 결과 카드가 차례로 나온다", [
    [Fi.FiMapPin, "위치 고르기", "지도 클릭 · 주소 · 역 이름 · 좌표"],
    [Fi.FiGrid, "업종 29개 · 반경 3단계", "4유형 묶음 · 규제 업종 표시 · 300m / 500m / 1km"],
    [Fi.FiBarChart2, "결과 대시보드", "점수 · 등급 · 한 줄 결론 · 거미줄 · 점수순 막대"],
    [Fi.FiAward, "업종 순위", "같은 자리에서 점수가 높은 업종 29개"],
    [Fi.FiClock, "시간대와 사람", "24시간 유입 · 손님층 인구 · 역 승하차"],
    [Fi.FiAlertTriangle, "규제 경고", "학교 200m 안 규제 업종은 점수 위에 경고"],
  ])).addNotes("기능 1/2. 입력(위치·업종·반경)과 결과 카드들.");
  (await featureSlide("핵심 기능 (2) 활용과 신뢰", "분석 다음의 행동과 자료의 투명성", [
    [Fi.FiColumns, "두 위치 비교", "A · B 관점별 차이, 거미줄 겹쳐 보기"],
    [Fi.FiMessageCircle, "AI 요약 · 질문", "분석 자료만 근거로, 문장마다 근거 표시"],
    [Fi.FiGift, "지원사업 공고", "업종 · 지역 · 내 상황에 맞는 공고"],
    [Fi.FiShare2, "활용 도구", "공유 링크 · 보관함 · 인쇄 · 현장 확인 카드"],
    [Fi.FiMoon, "편의", "라이트 · 다크 테마, 첫 방문 안내, 모바일"],
    [Fi.FiDatabase, "투명성", "데이터 출처 · 기준일 · 데이터 한계 · 업데이트 내역"],
  ])).addNotes("기능 2/2. 장소 이름 검색(NAVER 검색 키)은 구현돼 있으나 운영에서는 꺼져 있다.");

  // =====================================================================
  pres.addSection({ title: "03 화면과 흐름" });
  sectionSlide("03 화면과 흐름", "03", "화면과 흐름", "고르고, 분석하고, 이해하고, 다음 행동으로. 각 화면이 무엇을 하는지.");

  // ---- 흐름도 ----
  {
    const s = addContent("03 화면과 흐름", true);
    heading(s, "사용 흐름");
    card(s, 0.6, 1.75, 2.6, 3.9, { fill: PANEL, line: EDGE, name: "입력 묶음" });
    T(s, "1  고르기", { x: 0.85, y: 1.9, w: 2.2, h: 0.4, fontSize: 16, bold: true, color: C.background1 });
    const inputs = [[Fi.FiMapPin, "위치", "지도 · 주소 · 역 · 좌표"], [Fi.FiGrid, "업종", "29개 중 하나"], [Fi.FiTarget, "반경", "300m · 500m · 1km"]];
    for (let i = 0; i < 3; i++) {
      const y = 2.5 + i * 1.0;
      card(s, 0.85, y, 2.1, 0.82, { fill: PANEL2, name: "입력 카드" });
      await iconCircle(s, inputs[i][0], 1.0, y + 0.17, 0.48, { dark: true, name: inputs[i][1] });
      T(s, inputs[i][1], { x: 1.6, y: y + 0.12, w: 1.3, h: 0.3, fontSize: 13, bold: true, color: C.background1 });
      T(s, inputs[i][2], { x: 1.6, y: y + 0.42, w: 1.35, h: 0.3, fontSize: 9.5, color: C.background2 });
    }
    arrow(s, 3.3, 3.7, 3.95, 3.7, { color: H.accent5, width: 2.5 });
    s.addShape(pres.ShapeType.ellipse, { x: 3.95, y: 2.95, w: 1.5, h: 1.5, fill: { color: H.accent1 }, line: { color: H.accent1, width: 0 }, objectName: "분석" });
    T(s, [{ text: "2  분석\n", options: { bold: true, fontSize: 15 } }, { text: "0.1초대", options: { fontSize: 10.5 } }], { x: 3.95, y: 2.95, w: 1.5, h: 1.5, color: "FFFFFF", align: "center", valign: "middle" });
    T(s, "좌표 · 업종 · 반경만 서버로", { x: 3.6, y: 4.55, w: 2.2, h: 0.3, fontSize: 9.5, color: C.background2, align: "center" });
    arrow(s, 5.55, 3.7, 6.15, 3.7, { color: H.accent5, width: 2.5 });
    card(s, 6.15, 1.75, 3.3, 3.9, { fill: PANEL, line: H.accent5, name: "결과 묶음" });
    T(s, "3  결과 대시보드", { x: 6.4, y: 1.9, w: 2.9, h: 0.4, fontSize: 16, bold: true, color: C.background1 });
    ["점수 · 등급 · 한 줄 결론", "다섯 관점 (거미줄 · 막대)", "시간대와 사람", "점수가 높은 업종", "AI 요약 · 지원사업", "상세 근거 · 점포 · 현장 확인"].forEach((t, i) => {
      const y = 2.42 + i * 0.52;
      s.addShape(pres.ShapeType.roundRect, { x: 6.4, y, w: 0.1, h: 0.4, fill: { color: H.accent5 }, line: { color: H.accent5, width: 0 }, rectRadius: 0.05, objectName: "카드 표시" });
      T(s, t, { x: 6.65, y, w: 2.7, h: 0.4, fontSize: 11.5, color: C.background1, valign: "middle" });
    });
    T(s, "4  다음 행동", { x: 10.15, y: 1.9, w: 2.6, h: 0.4, fontSize: 16, bold: true, color: C.background1 });
    const acts = [[Fi.FiColumns, "다른 위치와 비교"], [Fi.FiMessageCircle, "AI에게 질문"], [Fi.FiGift, "지원사업 보기"], [Fi.FiShare2, "공유 · 보관 · 인쇄"], [Fi.FiCheckSquare, "현장 확인"]];
    for (let i = 0; i < acts.length; i++) {
      const y = 2.42 + i * 0.66;
      arrow(s, 9.45, 3.7, 10.15, y + 0.25, { color: "4A5F8E", width: 1.25 });
      card(s, 10.15, y, 2.55, 0.5, { fill: PANEL2, line: EDGE, name: "행동 카드" });
      await iconCircle(s, acts[i][0], 10.25, y + 0.08, 0.34, { dark: true, name: acts[i][1] });
      T(s, acts[i][1], { x: 10.7, y, w: 1.95, h: 0.5, fontSize: 12, bold: true, color: C.background1, valign: "middle" });
    }
    s.addShape(pres.ShapeType.line, { x: 1.9, y: 5.65, w: 0, h: 0.45, line: { color: H.accent5, width: 1.5, dashType: "dash" }, objectName: "되돌이" });
    s.addShape(pres.ShapeType.line, { x: 1.9, y: 6.1, w: 5.9, h: 0, line: { color: H.accent5, width: 1.5, dashType: "dash" }, objectName: "되돌이" });
    arrow(s, 7.8, 6.1, 7.8, 5.7, { color: H.accent5, width: 1.5, dash: "dash" });
    T(s, "업종 순위에서 업종만 바꿔 다시 분석 · 반경 버튼으로 다시 분석", { x: 2.2, y: 6.2, w: 7, h: 0.3, fontSize: 10.5, color: H.accent5 });
    T(s, "주소 · 장소 · 역 이름 검색은 좌표를 고르는 도구일 뿐이고, 행정동 판정은 서버가 경계 폴리곤으로 한다", { x: 0.6, y: 6.6, w: 12.1, h: 0.3, fontSize: 10, color: C.text2 });
    s.addNotes("전체 흐름. 입력 → 분석 → 결과 → 다음 행동, 그리고 업종·반경을 바꿔 되돌아오는 고리.");
  }

  const cap = (t) => t + " (운영 화면 · 데이터 2026-09)";

  // ---- 화면: 시작 ----
  {
    const s = addContent("03 화면과 흐름");
    heading(s, "시작 화면", "\"어디에, 어떤 가게를 열까요?\"");
    screenshot(s, SHOT("start-dark.png"), 0.68, 1.6, 7.14, 4.46, { caption: cap("지도가 화면 전체, 오른쪽 패널에서 위치 → 업종 → 반경") });
    const rows = [[Fi.FiMapPin, "위치", "지도 클릭 · 주소 · 역 이름 자동완성 · 좌표"], [Fi.FiGrid, "업종 29개", "4유형 묶음, 규제 업종 표시"], [Fi.FiTarget, "반경", "300m · 500m · 1km"], [Fi.FiSlash, "인천 밖 · 바다 · 점포 0곳", "분석 전에 안내로 거절"], [Fi.FiHelpCircle, "첫 방문 안내", "코치마크 한 번, 다시 보기는 ? 버튼"]];
    for (let i = 0; i < rows.length; i++) await iconRow(s, rows[i][0], 8.3, 1.65 + i * 0.95, 4.4, rows[i][1], rows[i][2], { size: 0.55, headSize: 15, descSize: 12 });
    s.addNotes("시작 화면. 위치 → 업종 → 반경. 역 이름 자동완성은 엔진에 있는 역 목록이라 외부 API가 없다.");
  }

  // ---- 화면: 결과 대시보드 ----
  {
    const s = addContent("03 화면과 흐름");
    heading(s, "결과 대시보드", "\"그래서 이 자리는 어떻다\"가 먼저 보인다");
    screenshot(s, SHOT("result-dark-up.png"), 0.68, 1.6, 7.14, 4.46, { caption: cap("부평구 부평1동 · 카페 · 500m — 종합 60.3(보통), 한 줄 결론, 거미줄 + 점수순 막대") });
    T(s, "카드 순서", { x: 8.3, y: 1.55, w: 4.4, h: 0.35, fontSize: 14, bold: true });
    const order = [["규제 배너", "있을 때만, 점수 위에"], ["종합 점수 · 등급 · 한 줄 결론", ""], ["다섯 관점", "거미줄 + 점수순 막대"], ["시간대와 사람", "유입 · 인구 · 역 승하차"], ["점수가 높은 업종", "29개 중 상위 5"], ["AI 요약", "좋은 점 · 주의 · 확인"], ["조건에 맞는 지원사업", "마감 · 링크"], ["탭 · 데이터 한계 · 면책", ""]];
    order.forEach(([h, d], i) => {
      const y = 2.0 + i * 0.56;
      T(s, String(i + 1), { x: 8.3, y, w: 0.4, h: 0.45, fontSize: 14, bold: true, color: H.accent1, valign: "middle" });
      T(s, [{ text: h, options: { bold: true } }, { text: d ? "   " + d : "", options: { color: C.text2, fontSize: 11 } }], { x: 8.75, y, w: 3.95, h: 0.45, fontSize: 13, valign: "middle" });
      s.addShape(pres.ShapeType.line, { x: 8.3, y: y + 0.5, w: 4.4, h: 0, line: { color: LINE, width: 0.75 }, objectName: "구분선" });
    });
    s.addNotes("결과 대시보드. 팀 점검 보고서의 시안 규칙(순서·정렬·근거 펼침·50 기준선·규제 배너)을 따른다.");
  }

  // ---- 화면: 시트 ----
  {
    const s = addContent("03 화면과 흐름");
    heading(s, "결과 시트", "지도는 늘 배경이고, 결과는 끌어올린다");
    screenshot(s, SHOT("result-dark-up.png"), 0.68, 1.95, 5.75, 3.59, { caption: "시트 올림 — 결과를 읽는 상태. 지도는 잠기고 양옆은 옅게" });
    screenshot(s, SHOT("result-dark-down.png"), 6.9, 1.95, 5.75, 3.59, { caption: "시트 내림 — 지도를 보는 상태. 아래 줄에 위치 · 업종 · 점수 요약" });
    T(s, "시트 올림", { x: 0.62, y: 1.5, w: 2, h: 0.34, fontSize: 13, bold: true, color: H.accent1 });
    T(s, "시트 내림", { x: 6.84, y: 1.5, w: 2, h: 0.34, fontSize: 13, bold: true, color: H.accent1 });
    arrow(s, 6.45, 3.6, 6.85, 3.6, { color: H.accent1, width: 2.5 });
    const pts = [[Fi.FiMove, "손잡이", "끌기 · 누르기 · 키보드"], [Fi.FiMaximize, "범위 맞춤", "처음 내릴 때 한 번 반경에"], [Fi.FiCornerUpLeft, "이전 결과로 돌아가기", "지도를 눌러 닫혀도 한 줄로 복귀"], [Fi.FiSmartphone, "모바일", "지도 화면 ↔ 패널 화면"]];
    for (let i = 0; i < 4; i++) await iconRow(s, pts[i][0], 0.6 + i * 3.075, 6.05, 2.9, pts[i][1], pts[i][2], { size: 0.46, headSize: 13, descSize: 11 });
    s.addNotes("v0.3.3(2026-11-02): '결과 전폭 + 작은 지도 카드'를 '지도 전체 배경 + 끌어올리는 시트'로. 지도가 작고 양옆이 비어 보이며 돌아오는 길이 안 보인다는 의견 때문.");
  }

  // ---- 화면: AI ----
  {
    const s = addContent("03 화면과 흐름");
    heading(s, "AI 요약과 질문", "분석 자료 안에서만 말하고, 문장마다 근거를 붙인다");
    screenshot(s, SHOT("result-dark-ai.png"), 0.68, 1.6, 7.14, 4.46, { caption: cap("실제 AI 요약 — 좋은 점 · 주의할 점 · 결정 전에 확인할 것, 문장 끝에 근거 이름표") });
    const rules = [[Fi.FiCpu, "Claude Sonnet 5.5", "입력은 현재 분석 자료뿐"], [Fi.FiLink, "문장마다 근거 연결", "고정 형식 출력"], [Fi.FiSlash, "성공 확률 · 추천 금지", "테스트가 응답을 검사"], [Fi.FiUser, "내 상황은 선택형", "브라우저에만 저장, 질문 때만 전송"], [Fi.FiDollarSign, "월 $30 · 하루 $3 · IP 한도", "넘으면 템플릿 결론으로 대체"], [Fi.FiLock, "로그 30일, 좌표 · IP 없음", "화면에 고지"]];
    for (let i = 0; i < rules.length; i++) await iconRow(s, rules[i][0], 8.3, 1.6 + i * 0.78, 4.4, rules[i][1], rules[i][2], { size: 0.48, headSize: 13.5, descSize: 11 });
    T(s, "평가 세트 10사례 · 실제 호출 (2026-10-31)", { x: 8.3, y: 6.3, w: 4.4, h: 0.25, fontSize: 10.5, color: C.text2 });
    T(s, "수치 일치 99% (171/172) · 근거 연결 100% · 금지 표현 0건 · 자료 밖 질문 거절 10/10", { x: 8.3, y: 6.55, w: 4.4, h: 0.35, fontSize: 10.5, bold: true });
    s.addNotes("R2(v0.2.0). 평가 세트는 scripts/eval_ai.py 로 재실행 가능. 불일치 1건은 223,102.87을 223,103으로 반올림한 것.");
  }

  // ---- 화면: 시간대·순위 ----
  {
    const s = addContent("03 화면과 흐름");
    heading(s, "시간대와 사람, 업종 순위", "점수 밖의 정보도 한 자리에 보여 준다");
    screenshot(s, SHOT("result-dark-rank.png"), 0.68, 1.6, 7.14, 4.46, { caption: cap("가까운 역 시간대별 승하차(인천교통공사) + 같은 자리에서 점수가 높은 업종") });
    const rows = [[Fi.FiClock, "구 단위 24시간 유입", "피크 구간과 비중, 영업시간과 겹침은 엔진 값으로만"], [Fi.FiUsers, "인구 3개", "주요 손님층 거주 · 직장인 · 1인 세대"], [Fi.FiNavigation, "가까운 역 승하차", "인천1·2호선 · 7호선 68역, 평일 · 주말"], [Fi.FiAward, "업종 순위", "상위 5 + 내 업종 위치, 누르면 재분석"], [Fi.FiInfo, "점수에는 더하지 않는다", "카드에 밝힘, \"추천\" 아님"]];
    for (let i = 0; i < rows.length; i++) await iconRow(s, rows[i][0], 8.3, 1.65 + i * 0.95, 4.4, rows[i][1], rows[i][2], { size: 0.55, headSize: 15, descSize: 11.5 });
    s.addNotes("시간대 카드는 /insights, 업종 순위는 /rank. 둘 다 점수를 바꾸지 않는다.");
  }

  // ---- 화면: 지원사업 ----
  {
    const s = addContent("03 화면과 흐름");
    heading(s, "조건에 맞는 지원사업", "공고를 기관 · 대상 · 마감 · 신청 링크와 함께");
    screenshot(s, SHOT("result-dark-support.png"), 0.68, 1.6, 7.14, 4.46, { caption: cap("카페 · 부평구 기준 165건 중 5건 — 인천 공고가 먼저") });
    T(s, "매칭 = 지역 × 대상 × 업종 × 마감", { x: 8.3, y: 1.55, w: 4.4, h: 0.4, fontSize: 15, bold: true });
    const f = [["지역", "인천 · 해당 구 가점, 전국 포함"], ["대상", "내 상황(창업 단계 · 청년 · 우대), 미입력은 통과"], ["업종", "업종 범위"], ["마감", "7일 이내 강조, 지난 공고 제외"]];
    f.forEach(([h, d], i) => {
      const y = 2.05 + i * 0.6;
      T(s, h, { x: 8.3, y, w: 0.9, h: 0.5, fontSize: 14, bold: true, color: H.accent1, valign: "middle" });
      T(s, d, { x: 9.2, y, w: 3.5, h: 0.5, fontSize: 11.5, color: C.text2, valign: "middle" });
      s.addShape(pres.ShapeType.line, { x: 8.3, y: y + 0.55, w: 4.4, h: 0, line: { color: LINE, width: 0.75 }, objectName: "구분선" });
    });
    const rows = [[Fi.FiDownload, "출처", "기업마당 · K-Startup, 하루 1회 수집"], [Fi.FiMessageCircle, "AI 연결", "AI는 카드에 있는 공고만 언급"], [Fi.FiInfo, "\"추천\"이 아니다", "조건 일치일 뿐, 선정 가능성과 무관"]];
    for (let i = 0; i < rows.length; i++) await iconRow(s, rows[i][0], 8.3, 4.65 + i * 0.72, 4.4, rows[i][1], rows[i][2], { size: 0.46, headSize: 13, descSize: 10.5 });
    s.addNotes("R3(v0.3.0). 기업마당·K-Startup API를 하루 1회 받아 서버 스냅샷에서 매칭한다.");
  }

  // ---- 화면: 비교 ----
  {
    const s = addContent("03 화면과 흐름");
    heading(s, "두 위치 비교", "같은 업종으로 두 자리의 차이를 한 화면에");
    screenshot(s, SHOT("compare-dark.png"), 0.68, 1.6, 7.14, 4.46, { caption: cap("A 부평1동 60.3 · B 송도2동 43.7 — 관점별 A●·B○ 점 행과 겹친 거미줄") });
    const steps = [["비교 시작", "\"다른 위치와 비교\" → B를 지도 · 좌표로"], ["B 분석", "같은 업종 · 반경으로 한 번 더"], ["비교 요약", "점 행(높은 쪽 굵게) + 겹친 거미줄"], ["각 위치 상세", "\"A 전체 결과\" · \"B 전체 결과\""]];
    steps.forEach(([h, d], i) => {
      const y = 1.65 + i * 1.1;
      T(s, String(i + 1), { x: 8.3, y, w: 0.6, h: 0.6, fontSize: 24, bold: true, color: H.accent1, valign: "middle" });
      T(s, h, { x: 9.0, y: y - 0.02, w: 3.7, h: 0.35, fontSize: 15, bold: true });
      T(s, d, { x: 9.0, y: y + 0.33, w: 3.7, h: 0.5, fontSize: 11.5, color: C.text2 });
      if (i < 3) s.addShape(pres.ShapeType.line, { x: 8.3, y: y + 0.95, w: 4.4, h: 0, line: { color: LINE, width: 0.75 }, objectName: "구분선" });
    });
    T(s, "요청은 4번뿐(A·B 분석, A·B 점포). 화면 전환은 새 요청을 만들지 않는다", { x: 8.3, y: 6.15, w: 4.4, h: 0.5, fontSize: 10.5, color: C.text2 });
    s.addNotes("두 위치 비교(D-020). 백엔드·엔진 계약은 그대로, 프런트가 /analyze를 위치마다 한 번 더 부른다.");
  }

  // ---- 화면: 활용 + 모바일 ----
  {
    const s = addContent("03 화면과 흐름");
    heading(s, "공유 · 보관 · 인쇄 · 현장 확인", "결과를 들고 나가는 도구와 모바일 화면");
    const tools = [[Fi.FiLink, "조건 공유 링크", "열면 지금 서버로 다시 분석"], [Fi.FiBookmark, "후보 보관함", "최대 3곳 · 저장 당시 등급 · 결론"], [Fi.FiPrinter, "인쇄 요약", "요약 카드 1~2쪽"], [Fi.FiCheckSquare, "현장 확인 카드", "분석이 못 보는 것 체크리스트"]];
    for (let i = 0; i < 4; i++) {
      const x = 0.6 + (i % 2) * 4.45, y = 1.6 + Math.floor(i / 2) * 2.4;
      card(s, x, y, 4.25, 2.15, { fill: C.background1, line: LINE, name: "도구 카드" });
      await iconCircle(s, tools[i][0], x + 0.35, y + 0.35, 0.7, { name: tools[i][1] });
      T(s, tools[i][1], { x: x + 1.3, y: y + 0.38, w: 2.8, h: 0.65, fontSize: 17, bold: true, valign: "middle" });
      T(s, tools[i][2], { x: x + 0.35, y: y + 1.3, w: 3.6, h: 0.7, fontSize: 12.5, color: C.text2 });
    }
    T(s, "서버에는 사용자 정보를 저장하지 않는다. 보관함 · 프로필은 브라우저에, 공유 링크에는 조건만 담긴다", { x: 0.6, y: 6.45, w: 8.7, h: 0.3, fontSize: 10.5, color: C.text2 });
    screenshot(s, SHOT("mobile-dark.png"), 10.3, 1.6, 2.2, 4.76, { name: "모바일 화면" });
    T(s, "모바일 · 다크 테마 (운영 화면)", { x: 9.7, y: 6.5, w: 3.4, h: 0.3, fontSize: 10, color: C.text2, align: "center" });
    s.addNotes("1차 '활용'(v0.0.15)과 v0.1.1에서 더한 도구들.");
  }

  // =====================================================================
  pres.addSection({ title: "04 구조·검증·다음" });
  sectionSlide("04 구조·검증·다음", "04", "구조 · 검증 · 다음", "화면은 엔진을 직접 부르지 않고, 점수는 새 엔진 버전으로만 바뀌며, 검증 결과는 숨기지 않는다.");

  // ---- 구조 ----
  {
    const s = addContent("04 구조·검증·다음", true);
    heading(s, "구조");
    T(s, "화면은 엔진을 직접 부르지 않는다", { x: 0.6, y: 1.08, w: 12.1, h: 0.3, fontSize: 12.5, color: C.background2 });
    const boxes = [[Fi.FiUser, "사용자", ""], [Fi.FiMonitor, "Frontend", "React · TypeScript\nNAVER Maps · Zod 검증"], [Fi.FiServer, "Backend", "FastAPI\n입력 검증 · 사용 제한"], [Fi.FiLayers, "Context Builder", "좌표 → 행정동\n→ 엔진 입력 조립"], [Fi.FiCpu, "Scoring Engine", "v0.3 · 0.4 · 0.5 · 0.5.1\n결과 그대로 전달"]];
    const bw = [1.5, 2.3, 2.3, 2.4, 2.4], gapB = 0.3, yB = 1.75, hB = 2.0;
    let x = 0.6; const centers = [];
    for (let i = 0; i < boxes.length; i++) {
      const [Ic, h, d] = boxes[i], last = i === 4;
      card(s, x, yB, bw[i], hB, { fill: last ? H.accent1 : PANEL, line: last ? H.accent1 : EDGE, name: "구조 상자" });
      await iconCircle(s, Ic, x + 0.2, yB + 0.2, 0.5, { dark: true, keep: last ? "FFFFFF" : null, name: h });
      if (last) { /* 흰 원 위 파랑 선으로 다시 그림 */ const g = 0.25; s.addImage({ data: await icon(Ic, H.accent1), x: x + 0.2 + (0.5 - g) / 2, y: yB + 0.2 + (0.5 - g) / 2, w: g, h: g, objectName: h + " 아이콘" }); }
      T(s, h, { x: x + 0.2, y: yB + 0.8, w: bw[i] - 0.4, h: 0.4, fontSize: 15, bold: true, color: C.background1 });
      if (d) T(s, d, { x: x + 0.2, y: yB + 1.22, w: bw[i] - 0.4, h: 0.75, fontSize: 10.5, color: C.background2 });
      centers.push(x + bw[i] / 2);
      if (i < 4) arrow(s, x + bw[i] + 0.04, yB + hB / 2, x + bw[i] + gapB - 0.04, yB + hB / 2, { color: H.accent5, width: 2.5 });
      x += bw[i] + gapB;
    }
    const sub = (cx, w, head, body, line) => {
      const bx = cx - w / 2;
      card(s, bx, 4.45, w, 1.2, { fill: PANEL, line, name: head });
      T(s, head, { x: bx + 0.2, y: 4.55, w: w - 0.4, h: 0.3, fontSize: 12.5, bold: true, color: line });
      T(s, body, { x: bx + 0.2, y: 4.88, w: w - 0.4, h: 0.7, fontSize: 10, color: C.background2 });
    };
    sub(centers[3], 2.8, "데이터 버전 2026-09", "상가 · 인구 · 생활이동 · 역 · 학교\n인허가 · 경계 (data/versions)", H.accent5);
    arrow(s, centers[3], 4.42, centers[3], yB + hB + 0.05, { color: H.accent5, width: 1.5 });
    sub(centers[2], 2.8, "선택 기능 (키 있을 때만)", "Anthropic API · 기업마당 · K-Startup\n역 승하차 · NAVER 검색", "8B9DBB");
    s.addShape(pres.ShapeType.line, { x: centers[2], y: yB + hB + 0.05, w: 0, h: 4.42 - (yB + hB + 0.05), line: { color: "8B9DBB", width: 1.5, dashType: "dash" }, objectName: "선택 연결" });
    sub(centers[0] + 0.9, 3.2, "운영", "Cloud Run 인스턴스 1 + Firebase Hosting\nFastAPI 하나가 API와 화면을 같은 주소로", "8B9DBB");
    [["점수 계산은 새 엔진 버전으로만", "기존 결과 불변 · 허용 diff 테스트"], ["앱 · 엔진 · 데이터 버전 분리", "v0.3.3 · v0.5.1 · 2026-09"], ["화면용 변환은 엔진 밖에서", "등급 · 정렬 · 결론 · 시간대 문장"]].forEach(([h, d], i) => {
      const px = 0.6 + i * 4.1;
      T(s, h, { x: px, y: 5.9, w: 3.9, h: 0.3, fontSize: 13, bold: true, color: H.accent5 });
      T(s, d, { x: px, y: 6.22, w: 3.9, h: 0.4, fontSize: 11, color: C.background2 });
    });
    s.addNotes("구조. 팀 원본 엔진은 바이트 동일 사본으로 보존하고, 반경 선택 같은 변경은 최소 diff 사본 + 허용 diff 테스트로만 한다.");
  }

  // ---- 신뢰 ----
  {
    const s = addContent("04 구조·검증·다음");
    heading(s, "신뢰를 지키는 방법", "원본 불변 · 회귀 테스트 · 기록");
    const rows = [[Fi.FiLock, "팀 원본 불변", "해시 매니페스트 대조 · 읽기 전용"], [Fi.FiRepeat, "기존 점수 불변", "엔진 버전별 golden regression"], [Fi.FiGitBranch, "사본 변경은 허용 범위만", "허용 diff 테스트"], [Fi.FiCheckCircle, "화면 · API 계약", "Zod 스키마 · 단위 테스트 · E2E"], [Fi.FiFileText, "커밋 · 배포 기록", "Patch-Note 트레일러 · 배포 기록은 추가만"]];
    for (let i = 0; i < rows.length; i++) await iconRow(s, rows[i][0], 0.6, 1.65 + i * 0.78, 6.8, rows[i][1], rows[i][2], { size: 0.5, headSize: 14.5, descSize: 11.5 });
    T(s, "마지막 전체 check(v0.3.2) 19단계 통과", { x: 0.6, y: 5.6, w: 7.0, h: 0.3, fontSize: 12.5, bold: true });
    [["382", "엔진 v0.3"], ["61", "v0.4"], ["104", "v0.5"], ["40", "v0.5.1"], ["258", "backend"], ["1,022", "frontend"]].forEach(([n, l], i) => {
      const x = 0.6 + i * 1.18;
      T(s, n, { x, y: 5.92, w: 1.1, h: 0.45, fontSize: 22, bold: true, color: H.accent1 });
      T(s, l, { x, y: 6.38, w: 1.1, h: 0.25, fontSize: 10, color: C.text2 });
    });
    card(s, 8.0, 1.6, 4.7, 5.05, { fill: C.text1, name: "배포 절차 카드" });
    T(s, "배포 절차", { x: 8.3, y: 1.8, w: 4.2, h: 0.4, fontSize: 14.5, bold: true, color: C.background1 });
    const dep = ["전체 check 19단계 + E2E", "무트래픽 후보 리비전 배포", "API smoke 48건 대조 · 화면 확인", "사용자 승인 → 트래픽 100%", "직전 리비전은 복구 대상", "패치노트에 전환 기록"];
    dep.forEach((t, i) => {
      const y = 2.35 + i * 0.62;
      T(s, String(i + 1), { x: 8.3, y, w: 0.4, h: 0.42, fontSize: 13, bold: true, color: H.accent5, valign: "middle" });
      T(s, t, { x: 8.75, y, w: 3.8, h: 0.42, fontSize: 12.5, color: C.background1, valign: "middle" });
      s.addShape(pres.ShapeType.line, { x: 8.3, y: y + 0.5, w: 4.2, h: 0, line: { color: EDGE, width: 0.75 }, objectName: "구분선" });
    });
    T(s, "Codex 검수 3회 통과 · 운영 전환 10회 이상 · 롤백 0회", { x: 8.3, y: 6.2, w: 4.2, h: 0.3, fontSize: 11, color: H.accent5, bold: true });
    s.addNotes("신뢰. 테스트 수는 README 기준(v0.3.2). 배포는 scripts/deploy_cloud_run.py 로만 한다.");
  }

  // ---- 검증 결과 ----
  {
    const s = addContent("04 구조·검증·다음");
    heading(s, "검증 결과", "\"점수가 높으면 더 오래 살아남는다\"고 말할 수 없다");
    card(s, 0.6, 1.6, 4.6, 2.95, { fill: C.text1, name: "상관 카드" });
    T(s, "4관점 점수 vs 실제 3년 생존율", { x: 0.9, y: 1.77, w: 4.0, h: 0.32, fontSize: 12.5, bold: true, color: H.accent5 });
    T(s, "ρ = −0.067", { x: 0.9, y: 2.1, w: 4.0, h: 1.0, fontSize: 46, bold: true, color: C.background1, valign: "middle" });
    T(s, "음식 9개 업종 평균 순위상관", { x: 0.9, y: 3.1, w: 4.0, h: 0.3, fontSize: 11.5, color: C.background2 });
    T(s, [{ text: "95% 구간  ", options: { bold: true, color: H.accent5 } }, { text: "−0.179 ~ +0.042, 0을 포함", options: { color: C.background1 } }], { x: 0.9, y: 3.5, w: 4.0, h: 0.3, fontSize: 13 });
    T(s, "단순 기준(인구 · 점포 수)보다 낫다는 근거도, 못하다는 근거도 없다", { x: 0.9, y: 3.88, w: 4.0, h: 0.6, fontSize: 11.5, color: C.background2 });
    const biz = ["카페", "양식", "치킨", "중국집", "백반/한정식", "생맥주", "일식 회/초밥", "김밥/분식", "요리 주점"];
    const rho = [-0.298, -0.273, -0.241, -0.186, -0.127, -0.002, 0.105, 0.156, 0.26];
    s.addChart(pres.ChartType.bar, [{ name: "ρ (v0.5.1)", labels: biz, values: rho }], {
      x: 5.5, y: 1.45, w: 7.2, h: 3.3, barDir: "bar", chartColors: [H.accent1], invertedColors: [H.accent4],
      showTitle: true, title: "업종별 순위상관 ρ (음식 9개, 운영 엔진 v0.5.1)", titleFontSize: 12, titleColor: H.dk1, titleFontFace: "+mn-lt",
      showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 9, dataLabelColor: H.dk2, dataLabelFormatCode: "+0.00;-0.00", dataLabelFontFace: "+mn-lt",
      catAxisLabelFontSize: 10, catAxisLabelColor: H.dk1, catAxisLabelFontFace: "+mn-lt", catAxisOrientation: "maxMin", catAxisLabelPos: "low", catGridLine: { style: "none" },
      valAxisLabelFontSize: 9, valAxisLabelColor: H.dk2, valAxisLabelFontFace: "+mn-lt", valAxisMinVal: -0.4, valAxisMaxVal: 0.4, valAxisMajorUnit: 0.2, valGridLine: { color: LINE, size: 0.75 }, valAxisLabelFormatCode: "0.0",
      showLegend: false, barGapWidthPct: 60,
    });
    T(s, "구간이 0을 벗어난 업종은 카페 하나. 9개를 동시에 본 값이라 확정할 수 없다", { x: 5.5, y: 4.75, w: 7.2, h: 0.3, fontSize: 10, color: C.text2 });
    const lim = [[Fi.FiClock, "입력이 결과보다 뒤 시점", "예측 성능이 아니라 사후 연관", H.accent4], [Fi.FiFilter, "음식 9개 · 동 중심점만", "29개 업종 중 9개, 개별 점포 자리 아님", H.accent3]];
    for (let i = 0; i < 2; i++) await iconRow(s, lim[i][0], 0.6, 4.85 + i * 0.85, 4.6, lim[i][1], lim[i][2], { keep: lim[i][3], size: 0.48, headSize: 13, descSize: 11 });
    card(s, 5.5, 5.1, 7.2, 1.5, { name: "그래서 카드" });
    T(s, "그래서", { x: 5.8, y: 5.22, w: 3, h: 0.3, fontSize: 13, bold: true, color: H.accent1 });
    bullets(s, ["\"매출 · 성공 확률이 아니다\" 문구와 AI 금지 규칙 유지, 점수 · 계수는 바꾸지 않는다", "목적은 '설명'과 '비교'이고 '예측'은 주장하지 않는다", "전향적 검증 준비: 2026-09 입력 보관, 1년 결과는 2027-10 이후"], 5.8, 5.55, 6.7, 1.0, { fontSize: 11.5, gap: 4 });
    s.addNotes("가장 솔직해야 할 슬라이드. 팀 사후검증 스크립트를 바이트 그대로 재현했고(대조군 v0.5 일치), 결론은 '일관된 관계를 확인하지 못했다'. docs/VALIDATION_2026-11-01.md");
  }

  // ---- 타임라인 ----
  {
    const s = addContent("04 구조·검증·다음");
    heading(s, "한 달의 여정", "팀 피드백을 네 번의 배포로");
    const ev = [["10-14", "디자인 확정", "지도 탐색형 · 블루"], ["10-19", "v0.4 반경 선택", "300·500·1,000m"], ["10-25", "엔진 v0.5.1", "분동 결함 수정"], ["10-29", "v0.0.15 활용", "공유 · 보관 · 인쇄"], ["10-31", "R0 · R1 · R2", "긴급 수정 → 대시보드 → AI"], ["11-01", "R3 v0.3.0 · 3.1", "지원사업 · 데이터 2026-09"], ["11-02", "v0.3.3", "지도 위 시트"]];
    const n = ev.length, x0 = 0.9, x1 = 12.4, ly = 3.7;
    s.addShape(pres.ShapeType.line, { x: x0, y: ly, w: x1 - x0, h: 0, line: { color: "C5D3EA", width: 3 }, objectName: "타임라인" });
    s.addShape(pres.ShapeType.line, { x: x0 + ((x1 - x0) * 4) / 6, y: ly, w: ((x1 - x0) * 2) / 6, h: 0, line: { color: H.accent1, width: 3 }, objectName: "타임라인 강조" });
    ev.forEach(([d, t, desc], i) => {
      const cx = x0 + (i * (x1 - x0)) / (n - 1), up = i % 2 === 0, hi = i >= 4;
      s.addShape(pres.ShapeType.ellipse, { x: cx - 0.15, y: ly - 0.15, w: 0.3, h: 0.3, fill: { color: hi ? H.accent1 : H.lt1 }, line: { color: hi ? H.accent1 : "8B9DBB", width: 2.5 }, objectName: "시점" });
      const bw = 1.8, bx = Math.min(Math.max(cx - bw / 2, 0.6), 12.7 - bw), ty = up ? ly - 1.75 : ly + 0.4;
      T(s, d, { x: bx, y: ty, w: bw, h: 0.3, fontSize: 13, bold: true, color: hi ? H.accent1 : C.text2, align: "center" });
      T(s, t, { x: bx, y: ty + 0.32, w: bw, h: 0.35, fontSize: 13.5, bold: true, align: "center" });
      T(s, desc, { x: bx, y: ty + 0.7, w: bw, h: 0.5, fontSize: 10.5, color: C.text2, align: "center" });
      s.addShape(pres.ShapeType.line, { x: cx, y: up ? ly - 0.45 : ly + 0.15, w: 0, h: 0.3, line: { color: hi ? H.accent1 : "8B9DBB", width: 1.5 }, objectName: "연결선" });
    });
    [["팀 점검 보고서 10-30", "P0 3 · P1 6 · P2 8"], ["사용자 인터뷰 결정", "대시보드형 · AI $30 · 공공 API"], ["묶음 4개 R0~R3", "검증 → 무트래픽 → 승인 전환"], ["엔진 v0.6 요청서", "점수 변경은 엔진 담당에게"]].forEach(([h, d], i) => {
      const x = 0.6 + i * 3.075;
      card(s, x, 5.55, 2.85, 1.05, { name: "입력 카드" });
      T(s, h, { x: x + 0.2, y: 5.65, w: 2.5, h: 0.3, fontSize: 12.5, bold: true });
      T(s, d, { x: x + 0.2, y: 5.97, w: 2.5, h: 0.5, fontSize: 10.5, color: C.text2 });
    });
    s.addNotes("타임라인. 10-31 하루에 R0·R1·R2 세 배포(v0.0.16 02:20, v0.1.0 08:39, v0.1.1 09:20, v0.2.0 23:37 KST).");
  }

  // ---- 다음 단계 ----
  {
    const s = addContent("04 구조·검증·다음");
    heading(s, "다음 단계");
    const cols = [
      [Fi.FiCpu, "엔진 담당과", ["시간대 적합도에 지점 단위 자료", "야간 업종 보정", "등급 경계 70 / 40 / 25 확인", "경쟁성 v0.5 → v0.5.1 차이 설명"]],
      [Fi.FiCheckCircle, "검증", ["실기기 · Safari · Firefox · 스크린리더", "예비 창업자 과제 테스트", "전향적 검증 (2027-10 이후)", "동시 부하 측정"]],
      [Fi.FiToggleRight, "선택 기능", ["장소 이름 검색 (NAVER 키만 넣으면 됨)", "사용자 도메인", "확장 시 AI 예산 · IP 한도 공유 저장소"]],
    ];
    for (let i = 0; i < 3; i++) {
      const [Ic, h, items] = cols[i];
      const x = 0.6 + i * 4.1;
      card(s, x, 1.6, 3.9, 4.55, { fill: C.background1, line: LINE, name: "다음 단계 카드" });
      await iconCircle(s, Ic, x + 0.3, 1.9, 0.65, { name: h });
      T(s, h, { x: x + 1.15, y: 1.95, w: 2.6, h: 0.55, fontSize: 18, bold: true, valign: "middle" });
      items.forEach((t, j) => {
        const y = 2.9 + j * 0.72;
        T(s, "·", { x: x + 0.3, y, w: 0.3, h: 0.6, fontSize: 16, bold: true, color: H.accent1 });
        T(s, t, { x: x + 0.6, y, w: 3.05, h: 0.6, fontSize: 13 });
      });
    }
    T(s, "모든 다음 단위는 사용자 지시 또는 외부 조건(키 · 자료 · 엔진 회신)이 있어야 시작한다. 점수는 웹 저장소에서 바꾸지 않는다", { x: 0.6, y: 6.35, w: 12.1, h: 0.3, fontSize: 10.5, color: C.text2 });
    s.addNotes("다음 단계. 엔진 v0.6 요청서(docs/ENGINE_V0_6_REQUEST.md)는 전달 대기.");
  }

  // ---- 마무리 ----
  {
    const s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "04 구조·검증·다음" });
    s.addText("\"여기에 이 가게를\n열어도 될까?\"", { placeholder: "title" });
    s.addText("공개 데이터로 먼저 따져 보고, 근거를 보여 주고,\n결정은 사용자가 합니다.", { placeholder: "body" });
    T(s, "감사합니다", { x: 0.7, y: 5.7, w: 6, h: 0.35, fontSize: 13, color: C.text2 });
    [["다섯 관점", "인천 158개 동네와 견준 상대 위치"], ["근거와 함께", "숫자 · 단위 · 출처, AI 문장에도 근거"], ["다음 행동까지", "비교 · 순위 · 지원사업 · 현장 확인"]].forEach(([h, d], i) => {
      const y = 2.0 + i * 1.3;
      s.addShape(pres.ShapeType.line, { x: 7.9, y, w: 4.8, h: 0, line: { color: EDGE, width: 1 }, objectName: "구분선" });
      T(s, h, { x: 7.9, y: y + 0.2, w: 4.8, h: 0.4, fontSize: 17, bold: true, color: C.background1 });
      T(s, d, { x: 7.9, y: y + 0.62, w: 4.8, h: 0.4, fontSize: 12.5, color: C.background2 });
    });
    s.addNotes("마무리. 세 문장으로 요약하고 질문을 받는다.");
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  await fixKorean(OUT);
  console.log("written:", OUT);
}

// 한글: (1) 테마의 동아시아 글꼴(ea·cs·Hang 스크립트)을 Pretendard 로 — 아니면 한글만 '맑은 고딕'으로 나온다
//       (2) 런 언어 ko-KR — PowerPoint 가 한글을 어절 단위로 줄바꿈한다
async function fixKorean(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  for (const n of Object.keys(zip.files)) {
    if (/^ppt\/theme\/theme\d+\.xml$/.test(n)) {
      let xml = await zip.file(n).async("string");
      xml = xml.replace(/<a:ea typeface="[^"]*"\/>/g, `<a:ea typeface="${FONT}"/>`).replace(/<a:cs typeface="[^"]*"\/>/g, `<a:cs typeface="${FONT}"/>`);
      xml = xml.replace(/<a:font script="Hang" typeface="[^"]*"\/>/g, `<a:font script="Hang" typeface="${FONT}"/>`);
      zip.file(n, xml);
    } else if (/^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(n)) {
      let xml = await zip.file(n).async("string");
      xml = xml.replace(/lang="en-US"/g, 'lang="ko-KR"');
      // 글꼴을 직접 지정한 런에는 동아시아 글꼴도 같이
      xml = xml.replace(/<a:latin typeface="([^"]+)"\/>(?!<a:ea)/g, '<a:latin typeface="$1"/><a:ea typeface="$1"/>');
      zip.file(n, xml);
    }
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

build().catch((e) => { console.error(e); process.exit(1); });
