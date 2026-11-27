import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { DistributionBucket, ExamStats } from "./exam-stats";

/**
 * PDF rendering for result statements and exam summaries (pdf-lib, standard Helvetica
 * fonts, A4). Renderers take plain data objects that the server layer has already
 * filtered: whatever is not in the data cannot leak into the document.
 */

// ---------------------------------------------------------------------------------------
// Data contracts
// ---------------------------------------------------------------------------------------

export type AttemptReportData = {
  examTitle: string;
  candidate: { name: string; rollNo: string | null };
  score: number;
  totalMarks: number;
  percentage: number;
  passed: boolean;
  passPercent: number;
  topics: { topic: string; awarded: number; available: number }[];
  submittedAt: Date | null;
  issuedAt: Date;
  verifyCode: string;
  verifyUrl: string;
};

export type ExamReportData = {
  exam: {
    title: string;
    startAt: Date;
    endAt: Date;
    durationMin: number;
    totalMarks: number;
    resultsPublishedAt: Date | null;
  };
  stats: ExamStats;
  distribution: DistributionBucket[];
  passPercent: number;
  ranking: { rank: number; name: string; rollNo: string | null; score: number; total: number; percentage: number; passed: boolean }[];
  awaitingGrading: number;
  generatedAt: Date;
};

// ---------------------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------------------

/** Characters (beyond Latin-1) that the standard fonts' WinAnsi encoding can draw. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const encodable = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch);
};

/**
 * Makes any string drawable with the standard fonts: whitespace/control characters become
 * spaces, accented letters outside WinAnsi lose their accent ("ő" -> "o"), anything else
 * becomes "?". Without this, pdf-lib throws on e.g. CJK or Arabic names.
 */
export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    if (/\s/u.test(ch) || (ch.codePointAt(0) ?? 0) < 0x20) out += " ";
    else if (encodable(ch)) out += ch;
    else {
      const base = ch.normalize("NFD")[0];
      out += base && base !== ch && encodable(base) ? base : "?";
    }
  }
  return out;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
});
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export const formatDateTime = (date: Date | null) => (date ? `${dateTimeFormat.format(date)} UTC` : "-");
export const formatDate = (date: Date) => dateFormat.format(date);

/** 38 -> "38", 31.25 -> "31.25", 31.5 -> "31.5". */
export function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}
export const formatPercent = (value: number) => `${formatNumber(Math.round(value * 10) / 10)}%`;

// ---------------------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------------------

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - 2 * MARGIN;
/** Content never goes below this line; the footer lives underneath. */
const BOTTOM = 70;

const C = {
  ink: rgb(0.1, 0.12, 0.17),
  muted: rgb(0.42, 0.45, 0.51),
  line: rgb(0.85, 0.87, 0.9),
  surface: rgb(0.965, 0.97, 0.98),
  header: rgb(0.93, 0.945, 0.965),
  band: rgb(0.07, 0.16, 0.33),
  bandSoft: rgb(0.62, 0.72, 0.88),
  accent: rgb(0.15, 0.39, 0.92),
  white: rgb(1, 1, 1),
  pass: rgb(0.08, 0.5, 0.25),
  passBg: rgb(0.91, 0.97, 0.92),
  passLine: rgb(0.62, 0.84, 0.67),
  fail: rgb(0.74, 0.15, 0.15),
  failBg: rgb(0.99, 0.93, 0.93),
  failLine: rgb(0.93, 0.66, 0.66),
  failBar: rgb(0.93, 0.56, 0.53),
};

type TextStyle = { size?: number; font?: PDFFont; color?: RGB };
type Align = "left" | "right" | "center";
type Column = { header: string; width?: number; align?: Align };
type Cell = string | { text: string; color?: RGB; bold?: boolean; bar?: { value: number; color: RGB } };
type Card = { label: string; value: string; sub?: string; tone?: "pass" | "fail" };

class ReportWriter {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  private constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly mono: PDFFont,
    private readonly meta: { heading: string; kicker: string; dateLine: string; footer: string },
  ) {}

  static async create(meta: { docTitle: string; heading: string; kicker: string; dateLine: string; footer: string }) {
    const doc = await PDFDocument.create();
    doc.setTitle(pdfSafe(meta.docTitle), { showInWindowTitleBar: true });
    doc.setCreator("Secure Examination Management System");
    doc.setProducer("Secure Examination Management System");
    const [regular, bold, mono] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
      doc.embedFont(StandardFonts.Courier),
    ]);
    const writer = new ReportWriter(doc, regular, bold, mono, meta);
    writer.newPage();
    return writer;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    if (this.pages.length === 1) {
      const bandH = 100;
      this.page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: C.band });
      this.page.drawRectangle({ x: 0, y: PAGE_H - bandH - 4, width: PAGE_W, height: 4, color: C.accent });
      this.text(this.meta.kicker, MARGIN, PAGE_H - 36, { size: 8, font: this.bold, color: C.bandSoft });
      this.text(this.meta.heading, MARGIN, PAGE_H - 66, { size: 23, font: this.bold, color: C.white });
      this.textRight(this.meta.dateLine, PAGE_W - MARGIN, PAGE_H - 66, { size: 9, color: C.bandSoft });
      this.y = PAGE_H - bandH - 40;
    } else {
      const bandH = 30;
      this.page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: C.band });
      this.text(this.meta.heading, MARGIN, PAGE_H - 19, { size: 9, font: this.bold, color: C.white });
      this.textRight(this.meta.kicker, PAGE_W - MARGIN, PAGE_H - 19, { size: 7.5, color: C.bandSoft });
      this.y = PAGE_H - bandH - 32;
    }
  }

  /** Starts a new page unless `height` points still fit above the footer. */
  ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  width(text: string, size: number, font = this.regular) {
    return font.widthOfTextAtSize(pdfSafe(text), size);
  }

  text(text: string, x: number, y: number, style: TextStyle = {}) {
    const safe = pdfSafe(text);
    if (!safe) return;
    this.page.drawText(safe, { x, y, size: style.size ?? 10, font: style.font ?? this.regular, color: style.color ?? C.ink });
  }

  textRight(text: string, right: number, y: number, style: TextStyle = {}) {
    this.text(text, right - this.width(text, style.size ?? 10, style.font), y, style);
  }

  /** Truncates with an ellipsis so the text fits `maxWidth`. */
  fit(text: string, maxWidth: number, size: number, font = this.regular) {
    const safe = pdfSafe(text);
    if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
    let lo = 0;
    let hi = safe.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (font.widthOfTextAtSize(`${safe.slice(0, mid).trimEnd()}…`, size) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return `${safe.slice(0, lo).trimEnd()}…`;
  }

  /** Word-wraps to `maxWidth`; words longer than a line are broken by character. */
  wrap(text: string, maxWidth: number, size: number, font = this.regular) {
    const lines: string[] = [];
    let line = "";
    for (const word of pdfSafe(text).split(/ +/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines;
  }

  paragraph(text: string, options: TextStyle & { maxWidth?: number; x?: number; lineHeight?: number; maxLines?: number } = {}) {
    const size = options.size ?? 10;
    const font = options.font ?? this.regular;
    const maxWidth = options.maxWidth ?? CONTENT_W;
    const lineHeight = options.lineHeight ?? size * 1.35;
    let lines = this.wrap(text, maxWidth, size, font);
    if (options.maxLines && lines.length > options.maxLines) {
      lines = [...lines.slice(0, options.maxLines - 1), this.fit(lines.slice(options.maxLines - 1).join(" "), maxWidth, size, font)];
    }
    for (const line of lines) {
      this.ensure(lineHeight);
      this.text(line, options.x ?? MARGIN, this.y - size, { size, font, color: options.color });
      this.y -= lineHeight;
    }
  }

  section(title: string) {
    this.ensure(64);
    this.y -= 14;
    this.page.drawRectangle({ x: MARGIN, y: this.y - 13, width: 3, height: 14, color: C.accent });
    this.text(title, MARGIN + 10, this.y - 11.5, { size: 12.5, font: this.bold });
    this.y -= 26;
  }

  /** Label/value pairs laid out in a grid. */
  facts(items: [string, string][], columns = 2) {
    const colW = CONTENT_W / columns;
    for (let i = 0; i < items.length; i += columns) {
      this.ensure(36);
      items.slice(i, i + columns).forEach(([label, value], j) => {
        const x = MARGIN + j * colW;
        this.text(label.toUpperCase(), x, this.y - 8, { size: 7.5, font: this.bold, color: C.muted });
        this.text(this.fit(value, colW - 16, 11), x, this.y - 23, { size: 11 });
      });
      this.y -= 36;
    }
  }

  cards(cards: Card[], height = 68) {
    const gap = 12;
    const w = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
    this.ensure(height + 4);
    cards.forEach((card, i) => {
      const x = MARGIN + i * (w + gap);
      const tone = card.tone === "pass" ? [C.passBg, C.passLine, C.pass] : card.tone === "fail" ? [C.failBg, C.failLine, C.fail] : [C.surface, C.line, C.ink];
      this.page.drawRectangle({ x, y: this.y - height, width: w, height, color: tone[0], borderColor: tone[1], borderWidth: 0.75 });
      this.text(card.label.toUpperCase(), x + 12, this.y - 18, { size: 7.5, font: this.bold, color: C.muted });
      this.text(this.fit(card.value, w - 24, 19, this.bold), x + 12, this.y - 43, { size: 19, font: this.bold, color: tone[2] });
      if (card.sub) this.text(this.fit(card.sub, w - 24, 8), x + 12, this.y - 58, { size: 8, color: C.muted });
    });
    this.y -= height + 10;
  }

  /** A table whose header repeats on every page it spans. Width-less columns share the rest. */
  table(columns: Column[], rows: Cell[][], options: { rowHeight?: number; size?: number } = {}) {
    const rowH = options.rowHeight ?? 22;
    const headH = 22;
    const size = options.size ?? 9.5;
    const pad = 8;
    const fixed = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
    const flexCount = columns.filter((c) => !c.width).length || 1;
    const widths = columns.map((c) => c.width ?? (CONTENT_W - fixed) / flexCount);
    const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));

    const place = (text: string, i: number, baseline: number, style: TextStyle) => {
      const align = columns[i].align ?? "left";
      const fitted = this.fit(text, widths[i] - 2 * pad, style.size ?? size, style.font);
      const w = (style.font ?? this.regular).widthOfTextAtSize(fitted, style.size ?? size);
      const x = align === "right" ? xs[i] + widths[i] - pad - w : align === "center" ? xs[i] + (widths[i] - w) / 2 : xs[i] + pad;
      this.text(fitted, x, baseline, style);
    };
    const header = () => {
      this.page.drawRectangle({ x: MARGIN, y: this.y - headH, width: CONTENT_W, height: headH, color: C.header });
      columns.forEach((c, i) => place(c.header.toUpperCase(), i, this.y - headH / 2 - 2.6, { size: 7.5, font: this.bold, color: C.muted }));
      this.y -= headH;
    };

    this.ensure(headH + rowH);
    header();
    rows.forEach((row, r) => {
      if (this.y - rowH < BOTTOM) {
        this.newPage();
        header();
      }
      if (r % 2) this.page.drawRectangle({ x: MARGIN, y: this.y - rowH, width: CONTENT_W, height: rowH, color: C.surface });
      this.page.drawLine({ start: { x: MARGIN, y: this.y - rowH }, end: { x: MARGIN + CONTENT_W, y: this.y - rowH }, thickness: 0.5, color: C.line });
      const baseline = this.y - rowH / 2 - size * 0.35;
      row.forEach((cell, i) => {
        const value = typeof cell === "string" ? { text: cell } : cell;
        const style = { size, font: value.bold ? this.bold : this.regular, color: value.color };
        if (!value.bar) return place(value.text, i, baseline, style);
        const labelW = 40;
        const trackW = widths[i] - 2 * pad - labelW - 6;
        const barY = this.y - rowH / 2 - 3;
        this.page.drawRectangle({ x: xs[i] + pad, y: barY, width: trackW, height: 6, color: C.header });
        const fill = Math.max(0, Math.min(1, value.bar.value)) * trackW;
        if (fill > 0) this.page.drawRectangle({ x: xs[i] + pad, y: barY, width: fill, height: 6, color: value.bar.color });
        this.textRight(value.text, xs[i] + widths[i] - pad, baseline, style);
      });
      this.y -= rowH;
    });
  }

  /** Draws footers (rule, note, "Page i of n") on every page and serializes the document. */
  async finish() {
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      this.page = page;
      page.drawLine({ start: { x: MARGIN, y: 48 }, end: { x: PAGE_W - MARGIN, y: 48 }, thickness: 0.5, color: C.line });
      this.text(this.fit(this.meta.footer, CONTENT_W - 80, 7.5), MARGIN, 34, { size: 7.5, color: C.muted });
      this.textRight(`Page ${i + 1} of ${total}`, PAGE_W - MARGIN, 34, { size: 7.5, font: this.bold, color: C.muted });
    });
    return this.doc.save();
  }
}

// ---------------------------------------------------------------------------------------
// Result statement (one attempt)
// ---------------------------------------------------------------------------------------

export async function renderAttemptReportPdf(data: AttemptReportData, qrPng: Uint8Array): Promise<Uint8Array> {
  const w = await ReportWriter.create({
    docTitle: `Result statement - ${data.examTitle}`,
    heading: "Result Statement",
    kicker: "SECURE EXAMINATION MANAGEMENT SYSTEM",
    dateLine: `Issued ${formatDate(data.issuedAt)}`,
    footer: `Verification code ${data.verifyCode}  ·  Contains no answer keys or responses.`,
  });

  w.paragraph(data.examTitle, { size: 17, font: w.bold, maxLines: 3, lineHeight: 22 });
  w.paragraph("Official result statement", { size: 9.5, color: C.muted });
  w.y -= 12;

  w.facts([
    ["Candidate", data.candidate.name],
    ["Roll no.", data.candidate.rollNo || "-"],
    ["Submitted", formatDateTime(data.submittedAt)],
    ["Issued", formatDateTime(data.issuedAt)],
  ]);
  w.y -= 4;

  w.cards([
    { label: "Score", value: `${formatNumber(data.score)} / ${formatNumber(data.totalMarks)}`, sub: "marks awarded / available" },
    { label: "Percentage", value: formatPercent(data.percentage), sub: `pass mark ${data.passPercent}%` },
    { label: "Result", value: data.passed ? "PASS" : "FAIL", tone: data.passed ? "pass" : "fail", sub: data.passed ? "at or above the pass mark" : "below the pass mark" },
  ]);

  w.section("Topic breakdown");
  if (data.topics.length) {
    w.table(
      [{ header: "Topic" }, { header: "Awarded", width: 72, align: "right" }, { header: "Available", width: 72, align: "right" }, { header: "Score", width: 170, align: "right" }],
      data.topics.map((t) => {
        const ratio = t.available > 0 ? t.awarded / t.available : 0;
        return [
          t.topic,
          formatNumber(t.awarded),
          formatNumber(t.available),
          { text: formatPercent(ratio * 100), bar: { value: ratio, color: ratio * 100 >= data.passPercent ? C.accent : C.failBar } },
        ];
      }),
    );
  } else {
    w.paragraph("No questions were recorded for this attempt.", { size: 9.5, color: C.muted });
  }

  // Verification panel: QR code + code + URL.
  w.section("Verification");
  const qr: PDFImage = await w.doc.embedPng(qrPng);
  const boxH = 132;
  w.ensure(boxH);
  const top = w.y;
  w.page.drawRectangle({ x: MARGIN, y: top - boxH, width: CONTENT_W, height: boxH, color: C.surface, borderColor: C.line, borderWidth: 0.75 });
  const qrSize = 108;
  w.page.drawImage(qr, { x: MARGIN + 12, y: top - 12 - qrSize, width: qrSize, height: qrSize });
  const textX = MARGIN + 12 + qrSize + 18;
  const textW = CONTENT_W - (textX - MARGIN) - 14;
  w.y = top - 6;
  w.paragraph("Scan to verify this result", { x: textX, maxWidth: textW, size: 11.5, font: w.bold });
  w.paragraph(
    "The verification page confirms that this result was issued by the system and has not been altered since. " +
      "It shows only the exam, issue date, the candidate's initials and a pass/fail band.",
    { x: textX, maxWidth: textW, size: 8.5, color: C.muted, maxLines: 3 },
  );
  w.y -= 4;
  w.text("VERIFICATION CODE", textX, w.y - 8, { size: 7, font: w.bold, color: C.muted });
  w.text(w.fit(data.verifyCode, textW, 9.5, w.mono), textX, w.y - 20, { size: 9.5, font: w.mono });
  w.y -= 26;
  w.text("VERIFY ONLINE", textX, w.y - 8, { size: 7, font: w.bold, color: C.muted });
  w.y -= 10;
  w.paragraph(data.verifyUrl, { x: textX, maxWidth: textW, size: 8.5, color: C.accent, maxLines: 2, lineHeight: 11 });
  w.y = top - boxH - 8;

  return w.finish();
}

// ---------------------------------------------------------------------------------------
// Exam summary
// ---------------------------------------------------------------------------------------

export async function renderExamReportPdf(data: ExamReportData): Promise<Uint8Array> {
  const { exam, stats } = data;
  const w = await ReportWriter.create({
    docTitle: `Exam summary - ${exam.title}`,
    heading: "Exam Summary Report",
    kicker: "SECURE EXAMINATION MANAGEMENT SYSTEM",
    dateLine: `Generated ${formatDateTime(data.generatedAt)}`,
    footer: "Real (non-sandbox) graded attempts only  ·  Confidential: for examiner use.",
  });

  w.paragraph(exam.title, { size: 17, font: w.bold, maxLines: 3, lineHeight: 22 });
  w.y -= 10;
  w.facts([
    ["Window", `${formatDateTime(exam.startAt)} - ${formatDateTime(exam.endAt)}`],
    ["Duration · total marks", `${exam.durationMin} min · ${formatNumber(exam.totalMarks)} marks`],
    ["Results", exam.resultsPublishedAt ? `Published ${formatDateTime(exam.resultsPublishedAt)}` : "Not published yet"],
    ["Graded attempts", data.awaitingGrading ? `${stats.attempts} (${data.awaitingGrading} awaiting grading, not included)` : String(stats.attempts)],
  ]);
  w.y -= 4;

  const marks = (value: number | null) => (value === null ? "-" : formatNumber(value));
  const pct = (value: number | null) => (value === null || !exam.totalMarks ? undefined : `${formatPercent((value / exam.totalMarks) * 100)} of ${formatNumber(exam.totalMarks)}`);
  w.cards([
    { label: "Attempts", value: String(stats.attempts), sub: "graded, real attempts" },
    { label: "Average", value: marks(stats.average), sub: stats.averagePercent === null ? undefined : `${formatPercent(stats.averagePercent)} average score` },
    { label: "Median", value: marks(stats.median), sub: pct(stats.median) },
  ], 64);
  w.cards([
    { label: "Highest", value: marks(stats.highest), sub: pct(stats.highest) },
    { label: "Lowest", value: marks(stats.lowest), sub: pct(stats.lowest) },
    {
      label: "Pass rate",
      value: stats.passRate === null ? "-" : formatPercent(stats.passRate * 100),
      sub: `${stats.passed} of ${stats.attempts} at or above ${data.passPercent}%`,
    },
  ], 64);

  w.section("Score distribution");
  if (stats.attempts) drawDistribution(w, data.distribution, data.passPercent);
  else w.paragraph("No graded attempts yet.", { size: 9.5, color: C.muted });

  w.section("Ranking");
  if (data.ranking.length) {
    w.table(
      [
        { header: "Rank", width: 50, align: "center" },
        { header: "Candidate" },
        { header: "Roll no.", width: 96 },
        { header: "Score", width: 78, align: "right" },
        { header: "%", width: 58, align: "right" },
        { header: "Result", width: 62, align: "center" },
      ],
      data.ranking.map((r) => [
        { text: String(r.rank), bold: true },
        r.name,
        r.rollNo || "-",
        `${formatNumber(r.score)} / ${formatNumber(r.total)}`,
        formatPercent(r.percentage),
        { text: r.passed ? "Pass" : "Fail", bold: true, color: r.passed ? C.pass : C.fail },
      ]),
    );
  } else {
    w.paragraph("No graded attempts yet.", { size: 9.5, color: C.muted });
  }

  return w.finish();
}

/** Vertical bar chart of the ten percentage buckets, drawn with rectangles and lines. */
function drawDistribution(w: ReportWriter, buckets: DistributionBucket[], passPercent: number) {
  const chartH = 130;
  const axisW = 26;
  w.ensure(chartH + 58);
  const x0 = MARGIN + axisW;
  const chartW = CONTENT_W - axisW;
  const top = w.y - 18;
  const base = top - chartH;

  const max = Math.max(1, ...buckets.map((b) => b.count));
  const step = Math.max(1, Math.ceil(max / 4));
  const yMax = step * Math.ceil(max / step);

  // Legend (top right).
  const legend: [string, RGB][] = [[`Below pass mark (${passPercent}%)`, C.failBar], ["Pass", C.accent]];
  let lx = MARGIN + CONTENT_W;
  for (const [label, color] of [...legend].reverse()) {
    lx -= w.width(label, 7.5) + 4;
    w.text(label, lx, w.y - 7, { size: 7.5, color: C.muted });
    lx -= 12;
    w.page.drawRectangle({ x: lx, y: w.y - 8, width: 8, height: 8, color });
    lx -= 12;
  }

  for (let v = 0; v <= yMax; v += step) {
    const y = base + (v / yMax) * chartH;
    w.page.drawLine({ start: { x: x0, y }, end: { x: x0 + chartW, y }, thickness: v === 0 ? 0.9 : 0.4, color: v === 0 ? C.muted : C.line });
    w.textRight(String(v), x0 - 6, y - 2.6, { size: 7.5, color: C.muted });
  }

  const slot = chartW / buckets.length;
  const barW = slot * 0.62;
  buckets.forEach((b, i) => {
    const x = x0 + i * slot + (slot - barW) / 2;
    const h = (b.count / yMax) * chartH;
    if (h > 0) w.page.drawRectangle({ x, y: base, width: barW, height: h, color: b.from >= passPercent ? C.accent : C.failBar });
    if (b.count) {
      const label = String(b.count);
      w.text(label, x + (barW - w.width(label, 8, w.bold)) / 2, base + h + 4, { size: 8, font: w.bold });
    }
    const tick = `${b.from}-${b.to}`;
    w.text(tick, x0 + i * slot + (slot - w.width(tick, 7)) / 2, base - 12, { size: 7, color: C.muted });
  });

  // Pass mark marker.
  const px = x0 + (Math.min(100, Math.max(0, passPercent)) / 100) * chartW;
  w.page.drawLine({ start: { x: px, y: base }, end: { x: px, y: top + 6 }, thickness: 0.8, color: C.fail, dashArray: [3, 2] });

  const axis = "Score (% of total marks)";
  w.text(axis, x0 + (chartW - w.width(axis, 7.5)) / 2, base - 26, { size: 7.5, color: C.muted });
  w.y = base - 40;
}
