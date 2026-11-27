import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { computeExamStats, rankByScore, scoreDistribution } from "./exam-stats";
import { pdfSafe, renderAttemptReportPdf, renderExamReportPdf } from "./pdf";
import { maskName, scoreBand } from "./privacy";
import { qrPng } from "./qr";
import { createRateLimiter } from "./rate-limit";

describe("maskName", () => {
  it("keeps only initials", () => {
    expect(maskName("Ayesha Khan")).toBe("A. K.");
    expect(maskName("  muhammad   fahad  khan ")).toBe("M. F. K.");
    expect(maskName("Madonna")).toBe("M.");
  });
  it("skips punctuation, handles non-Latin names, caps at four parts", () => {
    expect(maskName("(Dr.) Sara Ali")).toBe("D. S. A.");
    expect(maskName("Élodie Østergaard")).toBe("É. Ø.");
    expect(maskName("A B C D E F")).toBe("A. B. C. D.");
    expect(maskName("   ")).toBe("-");
  });
});

describe("scoreBand", () => {
  it("is Pass at or above PASS_PERCENT (40%) of total, else Fail", () => {
    expect(scoreBand(20, 50)).toBe("Pass");
    expect(scoreBand(19.5, 50)).toBe("Fail");
    expect(scoreBand(0, 0)).toBe("Fail");
    expect(scoreBand(5, 10, 60)).toBe("Fail");
  });
});

describe("exam stats", () => {
  it("computes average, median, extremes and pass rate", () => {
    const stats = computeExamStats([
      { score: 10, total: 20 },
      { score: 4, total: 20 },
      { score: 20, total: 20 },
      { score: 7, total: 20 },
    ]);
    expect(stats).toEqual({
      attempts: 4, average: 10.25, median: 8.5, highest: 20, lowest: 4, averagePercent: 51.25, passed: 2, passRate: 0.5,
    });
    expect(computeExamStats([{ score: 3, total: 10 }]).median).toBe(3);
    expect(computeExamStats([])).toMatchObject({ attempts: 0, average: null, passRate: null });
  });

  it("buckets percentages into ten bins, 100 in the last", () => {
    const buckets = scoreDistribution([0, 9.99, 10, 55, 100, 99.5]);
    expect(buckets).toHaveLength(10);
    expect(buckets.map((b) => b.count)).toEqual([2, 1, 0, 0, 0, 1, 0, 0, 0, 2]);
    expect(buckets[9]).toMatchObject({ from: 90, to: 100 });
  });

  it("ranks with ties sharing a rank (1, 1, 3)", () => {
    const ranked = rankByScore([
      { name: "Bea", score: 8 },
      { name: "Al", score: 9 },
      { name: "Cy", score: 9 },
    ]);
    expect(ranked.map((r) => [r.name, r.rank])).toEqual([["Al", 1], ["Cy", 1], ["Bea", 3]]);
  });
});

describe("rate limiter", () => {
  it("allows `limit` hits per sliding window per key", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
    expect(limiter.hit("a").allowed).toBe(true);
    now = 500;
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterMs: 500 });
    expect(limiter.hit("b").allowed).toBe(true);
    now = 1_001; // first hit left the window
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
    limiter.configure({ limit: 5 });
    expect(limiter.hit("a").allowed).toBe(true);
    limiter.reset();
    expect(limiter.hit("a")).toEqual({ allowed: true, remaining: 4 });
  });
});

describe("pdf rendering", () => {
  it("makes any text drawable with the standard fonts", () => {
    expect(pdfSafe("Zoë — “quoted” €5")).toBe("Zoë — “quoted” €5");
    expect(pdfSafe("Łódź\tőr")).toBe("?ódz or");
    expect(pdfSafe("علي 李")).toBe("??? ?");
  });

  it("renders a multi-page result statement with a QR code", async () => {
    const topics = Array.from({ length: 40 }, (_, i) => ({ topic: `Topic ${i + 1} with a rather long descriptive name`, awarded: i % 5, available: 4 }));
    const bytes = await renderAttemptReportPdf(
      {
        examTitle: "Database Systems Midterm — Section A (李)",
        candidate: { name: "Ayesha Khan", rollNo: "R-001" },
        score: 38, totalMarks: 50, percentage: 76, passed: true, passPercent: 40,
        topics, submittedAt: new Date("2026-11-27T10:00:00Z"), issuedAt: new Date("2026-11-27T12:00:00Z"),
        verifyCode: "0123456789abcdef0123456789abcdef", verifyUrl: "http://localhost:3000/verify/0123456789abcdef0123456789abcdef",
      },
      await qrPng("http://localhost:3000/verify/0123456789abcdef0123456789abcdef"),
    );
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("renders an exam summary, also with no attempts", async () => {
    const base = {
      exam: { title: "Empty exam", startAt: new Date(), endAt: new Date(), durationMin: 60, totalMarks: 50, resultsPublishedAt: null },
      stats: computeExamStats([]), distribution: scoreDistribution([]), passPercent: 40, ranking: [], awaitingGrading: 0, generatedAt: new Date(),
    };
    const empty = await renderExamReportPdf(base);
    expect(Buffer.from(empty).subarray(0, 5).toString()).toBe("%PDF-");
    const full = await renderExamReportPdf({
      ...base,
      stats: computeExamStats([{ score: 30, total: 50 }, { score: 10, total: 50 }]),
      distribution: scoreDistribution([60, 20]),
      ranking: [
        { rank: 1, name: "Ayesha Khan", rollNo: "R-1", score: 30, total: 50, percentage: 60, passed: true },
        { rank: 2, name: "Bilal", rollNo: null, score: 10, total: 50, percentage: 20, passed: false },
      ],
    });
    expect(full.byteLength).toBeGreaterThan(empty.byteLength);
  });
});
