# Member 2 - Examiner & Admin Features (full-stack)

**Your area is the largest by feature count.** You build both the API and the UI for everything administrators and examiners do, plus most secondary features (import, analytics, PDF, verifiable reports, sandbox).

**Read first:** `00_SHARED_CONTRACT.md` and `prisma/schema.prisma`.
**Branch:** `m2-examiner`
**Your marks:** a large share of Core Functionality (30) and Secondary Features (15: import, question analytics, PDF, verifiable reports, sandbox), plus part of UI/UX (20) for admin/examiner screens.

---

## You own

```
app/(admin)/*                  admin pages
app/(examiner)/*               examiner pages
components/examiner/*          tables, forms, charts, monitor widgets
app/api/users|exams|questions|import|announcements|monitor|analytics|reports
app/verify/[code]              public verification page
lib/reports/*                  PDF generation, QR, analytics queries
lib/validation/*               zod schemas for your endpoints
```
Use M3's design system (`components/ui`) and app shell. Until it lands (~1:30), build with plain shadcn components and restyle later - don't wait.
Call M1's helpers: `requireRole`, `assertExamOwner`, `recomputeAttemptScore`, `finalizeIfExpired`, `deriveExamPhase`.

## Deliverables

### Phase A - Admin: user & role management (~0:45-1:45; works against mock until M1's auth lands)
- [ ] `GET/POST/PATCH /api/users` (ADMIN only): list with search + role filter + pagination, create user (hash password server-side), change role, activate/deactivate, reset password.
- [ ] UI `/admin/users`: table, create/edit dialog, role select, active toggle, inline validation messages.
- [ ] Safety rules enforced on the **backend**: an admin can't demote/deactivate the last remaining admin; email unique -> friendly 409.

### Phase B - Exam management
- [ ] `GET/POST/PATCH /api/exams`, `GET /api/exams/:id`: examiners see only their own exams (admins see all). Fields: title, instructions, startAt, endAt, durationMin, shuffleQuestions, shuffleOptions. Validation: `endAt > startAt`, `durationMin > 0`, `durationMin <= minutes(startAt..endAt)`.
- [ ] Edits locked once the exam has attempts (or once ONGOING): only allow safe fields; return 409 with a clear message otherwise.
- [ ] `PUT /api/exams/:id/questions`: assign questions from the bank with per-exam `marks` and `order`; recompute `Exam.totalMarks` server-side.
- [ ] `POST /api/exams/:id/publish`: **review-before-publish** rules - requires >=1 question, valid schedule, >=1 enrolled candidate (warn, don't block, if you prefer). Move DRAFT -> PUBLISHED; write AuditLog.
- [ ] UI `/examiner/exams` (list with phase badges: Draft / Upcoming / Ongoing / Completed), `/examiner/exams/new`, `/examiner/exams/[id]` with tabs: **Details - Questions - Candidates - Monitor - Grading - Results - Analytics**.
- [ ] **Review page** before publish: summary of settings, question list with marks, total marks check, enrolled count, and a clear "Publish" confirm dialog.

### Phase C - Question bank
- [ ] `GET/POST/PATCH/DELETE /api/questions`: filter by topic, difficulty, type, free-text search; pagination. Validation by type: MCQ needs exactly 1 correct option and >= 2 options; MULTI needs >= 1 correct and >= 2 options; WRITTEN needs no options. Don't hard-delete a question used by an exam (return 409, offer archive/duplicate).
- [ ] UI `/examiner/questions`: filter bar, table, create/edit drawer with dynamic option rows, topic autocomplete, difficulty select, marks, negative marks, multi-select scheme.
- [ ] Picker dialog inside an exam to add questions from the bank (filters + multi-select + marks input) and drag/arrow reordering.

### Phase D - Candidate enrollment
- [ ] `POST /api/exams/:id/enrollments` (by user ids or emails), `DELETE` single, `GET` list (name, email, status: not started / in progress / submitted).
- [ ] UI "Candidates" tab: search users with role CANDIDATE, add selected, remove, show attempt status per candidate.
- [ ] Reject enrolling non-candidates; ignore duplicates gracefully (unique `(examId,userId)`).

### Phase E - Secondary: Bulk import (4.4)
- [ ] `POST /api/import/candidates` (CSV/JSON): columns `name,email,rollNo,password(optional)`. Validate each row (email format, duplicates in file and in DB), **create valid rows, report invalid ones** with row number + reason. Optional `examId` to enroll imported users immediately. If no password given, generate a random one and return a downloadable credentials CSV once.
- [ ] `POST /api/import/questions` (CSV/JSON): CSV columns `topic,difficulty,type,text,marks,optionA..optionF,correct` (e.g. `A` or `A;C`). Same row-level validation and report.
- [ ] UI import dialog: file drop -> **preview table with per-row status** (valid/invalid + error) -> confirm import -> summary ("38 imported, 2 failed - download error report"). Provide downloadable sample CSV templates.
- [ ] Limits: max file size (e.g. 2 MB) and max rows (e.g. 2000), parsed server-side with PapaParse.

### Phase F - Live monitoring (3.6)
- [ ] `GET /api/exams/:id/monitor` per contract (counts, per-attempt progress, last heartbeat, recent incidents). Run `finalizeIfExpired` for stale attempts. Exclude sandbox attempts.
- [ ] `POST/GET /api/exams/:id/announcements`: examiner posts; candidates get them via heartbeat/attempt payload (M1).
- [ ] UI Monitor tab (poll every 4s with TanStack Query): status counters, table with progress bars, "last seen" with online/stale indicator, incident feed with filters, announcement composer. **UI copy must state: "Incidents are indicators for review, not proof of misconduct."** Per-candidate drawer showing the incident timeline.

### Phase G - Evaluation & grading (3.7)
- [ ] `GET /api/exams/:id/submissions` (list attempts + status + score) and `GET /api/attempts/:id/review` (examiner view: questions, candidate's responses, correct answers, awarded marks).
- [ ] `PATCH /api/answers/:id/grade`: only for WRITTEN answers; validate `0 <= awardedMarks <= marks`; save feedback; then call M1's `recomputeAttemptScore`.
- [ ] UI Grading tab: queue of ungraded written answers (filter by question or candidate), side-by-side question + answer + marks input with live validation, "Save & next". Show grading progress ("14 / 20 graded").
- [ ] Results tab: scores table, "Publish results" button (calls M1's publish endpoint; show blockers if any attempt is unfinalized/ungraded).

### Phase H - Analytics & question analytics (3.8, 4.5)
- [ ] `GET /api/exams/:id/analytics` from **real data** (exclude sandbox): attempts count, average/median/highest/lowest, pass rate (define threshold, e.g. 40%), score distribution histogram, average time used.
- [ ] `GET /api/exams/:id/questions/analytics`: per question - % correct, % skipped, most chosen wrong option, discrimination hint (upper vs lower group performance, optional), observed difficulty label vs. declared difficulty.
- [ ] UI: Recharts histogram + stat cards + a sortable question table with colored indicators and a "problematic questions" callout (e.g. <20% correct or >30% skipped).

### Phase I - Secondary: PDF reports (4.2) & verifiable reports (4.6)
- [ ] `GET /api/reports/:attemptId/pdf`: allowed for the exam's examiner/admin, or the candidate who owns it **only if results are published**. Content: exam title, candidate name, score, percentage, per-section/topic breakdown, date, verification code + QR. Built with pdf-lib/pdfkit from real DB data. No answer keys.
- [ ] `GET /api/exams/:id/report/pdf`: exam summary report (stats + distribution + ranked table).
- [ ] QR encodes `${APP_URL}/verify/${verifyCode}`; `Report.hash` = SHA-256 of canonical result payload (`attemptId|examId|score|issuedAt`). Verification recomputes and compares.
- [ ] Public `/verify/[code]` page + `GET /api/verify/:code`: shows valid/invalid badge, exam title, issue date, **masked candidate name** (e.g. "A. K."), score band. **No email, no answers.** Rate-limit lookups.
- [ ] UI: "Download PDF" buttons for examiner (per candidate + exam-level) and candidate (coordinate with M3).

### Phase J - Secondary: Sandbox (4.3)
- [ ] Button "Preview as candidate" on the exam page -> calls `POST /api/exams/:id/attempts` with `{ sandbox: true }` (M1 handles) and opens `/examiner/exams/[id]/sandbox/[attemptId]`, which **reuses M3's exam workspace component** with a visible "SANDBOX - not recorded" banner.
- [ ] Verify (and write a quick test): sandbox attempts never appear in monitor, results, analytics, reports, or counts - one shared `where isSandbox = false` helper used everywhere.

## Suggested schedule
| Time | Work |
|---|---|
| 0:45-2:00 | Phase A + start B (mock data until auth lands) |
| 2:00-3:30 | Phase B finish + C (question bank) |
| 3:30-4:30 | Phase D + start E |
| 4:30-5:30 | Phase E finish -> **integration checkpoint** |
| 5:30-7:00 | Phase F + G |
| 7:00-8:30 | Phase H + I + J |
| 8:30-10:00 | Bug bash, UI polish, demo rehearsal |

If time gets tight, protect in this order: B, C, D, G, F -> then H, I, E, J.

## Interfaces
- **From M1:** auth helpers, grading service, publish endpoint, seed data, `finalizeIfExpired`.
- **From M3:** design system/components, exam workspace component for sandbox, candidate-side download button wiring.
- **To M3:** report PDF endpoint, announcements GET, verify page.

## Definition of done
- Admin manages users/roles; examiner can run an exam end-to-end: create -> add questions -> enroll -> publish -> monitor -> grade -> publish results -> analytics -> PDF.
- CSV import shows row-level errors and imports valid rows.
- Every endpoint enforces role + ownership on the backend.
- Sandbox leaves zero trace in stats.
- PDF and verify page work from real data and leak nothing private.

## Demo talking points (yours)
Review-before-publish, import validation report, monitor with "indicators not proof" framing, question analytics finding a bad question, QR verification with minimal data exposure, sandbox isolation.
