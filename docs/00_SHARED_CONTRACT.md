# 00 - Shared Contract (read by ALL members)

**Project:** Secure Examination Management System - Web-e-Thon, Technoverse 5.0 (27-28 Nov 2026, COMSATS Lahore)
**Time budget:** 10 hours | **Team:** 3 | **Demo:** 15-minute live demo + judge-led testing
**Marks:** Core 30 · Secondary 15 · Technical Quality 20 · Innovation 15 · UI/UX 20

---

## 1. Stack (locked)

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript (frontend + backend in one repo) |
| DB / ORM | PostgreSQL on Neon (free) + Prisma |
| Auth | httpOnly cookie sessions (Auth.js credentials or custom JWT cookie), argon2/bcrypt hashes |
| Validation | Zod - SAME schemas on client and server (`lib/validation/*`) |
| UI | Tailwind + shadcn/ui (customized), Recharts for charts |
| Data fetching | TanStack Query (polling for monitor + announcements) |
| PDF / QR | pdf-lib (or pdfkit) + `qrcode` |
| Import | PapaParse (CSV) + JSON |
| Offline | IndexedDB via `idb` |
| Hosting | Vercel (app) + Neon (DB). No paid services anywhere. |

## 2. Setup (do together in the first 45 minutes)

```bash
npx create-next-app@latest examsys --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm
cd examsys
# IMPORTANT: pin Prisma to v6. `npm i prisma` now installs v8 (release candidate), which rejects
# `url` / `directUrl` inside schema.prisma and needs a different setup (prisma.config.ts + driver adapters).
npm i prisma@6 @prisma/client@6
npm i zod bcryptjs jose @tanstack/react-query react-hook-form @hookform/resolvers recharts idb papaparse pdf-lib qrcode
npm i -D @types/bcryptjs @types/papaparse tsx vitest
npx shadcn@latest init
# copy prisma/schema.prisma from this pack, then:
npx prisma migrate dev --name init
```
Add to `package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }` so `npx prisma db seed` works, and `"postinstall": "prisma generate"` so Vercel builds generate the client.

Tell everyone to install with the same lockfile (commit `package-lock.json`) so nobody ends up on a different Prisma version.

`.env` (never commit; add the same vars in Vercel):
```
DATABASE_URL=   # Neon pooled connection string
DIRECT_URL=     # Neon direct connection string
SESSION_SECRET= # 32+ random chars
APP_URL=        # https://<your>.vercel.app  (used in QR verify links)
```

**Deploy a hello-world to Vercel in the first hour.** A live URL early removes the biggest last-minute risk.

## 3. Folder ownership (prevents merge conflicts)

```
prisma/                         M1   (others: ask M1 for schema changes)
lib/auth/  lib/services/        M1   (core engine: attempts, grading, lifecycle)
lib/validation/                 shared - add files, don't rewrite others'
lib/offline/                    M3
lib/reports/                    M2   (PDF, QR, analytics queries)
app/api/auth|attempts|results   M1
app/api/me/route.ts             M1   (GET /api/me)   |  app/api/me/preferences/route.ts   M3
app/api/exams/[id]/attempts, app/api/exams/[id]/results/publish   M1  (everything else under app/api/exams = M2)
app/api/users|exams|questions|import|reports|analytics|announcements|monitor   M2
app/(auth)  app/(candidate)     M3
app/(admin)  app/(examiner)     M2
components/ui  app/layout.tsx  globals.css  tailwind config   M3 (design system)
components/examiner/            M2
```

**Git rules**
- One branch per member: `m1-backend`, `m2-examiner`, `m3-candidate`. Merge into `main` at least every ~90 min (pull `main` first).
- Small, meaningful commits (version history is a submission requirement). No commits/pushes after the official deadline.
- Never force-push `main`.

## 4. Global conventions

**Error format (all APIs):**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "fields": { "durationMin": "Must be > 0" } } }
```
Status codes: 400 validation · 401 not logged in · 403 forbidden · 404 not found · 409 conflict (duplicate/state) · 429 rate limited.
Codes in use: `VALIDATION_ERROR, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, EXAM_NOT_AVAILABLE, EXAM_ENDED, ATTEMPT_CLOSED, NOT_ENROLLED, RATE_LIMITED`.

**Auth helpers (M1 provides in `lib/auth`):**
```ts
getSession(): Promise<{ userId, role } | null>
requireRole(...roles: Role[]): Promise<{ userId, role }>   // throws 401/403
assertExamOwner(examId, userId, role)                       // examiner owns exam, admins pass
assertEnrolled(examId, userId)
```
**Every API route must call `requireRole` first.** Hiding buttons is never enough.

**Never leak:** `Option.isCorrect`, `AttemptQuestion.snapshot.options[].isCorrect`, `passwordHash`, other users' results. Candidate payloads go through a `toCandidateQuestion()` mapper (M1) that strips answer keys.

**Time:** all enforcement uses server time (`new Date()` on the server). Client clocks are display-only.

**Exam status:** stored `DRAFT | PUBLISHED | ARCHIVED`. Derived for display (helper `deriveExamPhase(exam, now)` by M1):
`DRAFT` -> `PUBLISHED_UPCOMING` (now < startAt) -> `ONGOING` -> `COMPLETED` (now > endAt).

## 5. Grading rules (document these in the README)

- **MCQ:** full marks if the selected option is the correct one, else 0. If `negativeMarks > 0`, a wrong answer deducts that amount; an unanswered question deducts nothing. Total score floors at 0.
- **MULTI, ALL_OR_NOTHING:** full marks only if the selected set equals the correct set.
- **MULTI, PARTIAL:** `marks * max(0, (correctPicked - wrongPicked) / totalCorrect)`.
- **WRITTEN:** examiner awards `0 <= awarded <= marks` (validated server-side).
- Attempt becomes `GRADED` only when every WRITTEN answer has `awardedMarks`; objective answers are graded at finalize time.
- Unanswered written questions are auto-graded 0.

## 6. API contract (key endpoints and shapes)

Owner column = who implements. Consumers may build against these shapes with mock data from minute 45.

| Method + Path | Owner | Who can call |
|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` | M1 | any |
| `GET/POST/PATCH /api/users` | M2 | ADMIN |
| `GET/POST/PATCH /api/exams`, `GET /api/exams/:id`, `POST /api/exams/:id/publish` | M2 | EXAMINER (own), ADMIN |
| `GET/POST/PATCH/DELETE /api/questions` | M2 | EXAMINER, ADMIN |
| `PUT /api/exams/:id/questions` (assign list + marks + order) | M2 | EXAMINER (own) |
| `POST /api/exams/:id/enrollments`, `GET /api/exams/:id/enrollments`, `DELETE /api/exams/:id/enrollments/:userId` | M2 | EXAMINER (own) |
| `POST /api/import/questions`, `POST /api/import/candidates` | M2 | EXAMINER, ADMIN |
| `GET /api/candidate/exams` | M1 | CANDIDATE |
| `POST /api/exams/:id/attempts` (start or resume) | M1 | CANDIDATE (enrolled) / EXAMINER (sandbox) |
| `GET /api/attempts/:id` | M1 | owner |
| `PUT /api/attempts/:id/answers` (autosave, batch) | M1 | owner |
| `POST /api/attempts/:id/submit` | M1 | owner |
| `POST /api/attempts/:id/heartbeat`, `POST /api/attempts/:id/incidents` | M1 | owner |
| `GET /api/exams/:id/monitor`, `POST /api/exams/:id/announcements`, `GET /api/exams/:id/announcements` | M2 | EXAMINER(own) / CANDIDATE(enrolled, GET only) |
| `GET /api/exams/:id/submissions`, `GET /api/attempts/:id/review` (examiner view with keys), `PATCH /api/answers/:id/grade` | M2 (calls M1 grading service) | EXAMINER (own) |
| `POST /api/exams/:id/results/publish` | M1 | EXAMINER (own) |
| `GET /api/candidate/results/:attemptId` | M1 | owner, only if published |
| `GET /api/exams/:id/analytics`, `GET /api/exams/:id/questions/analytics` | M2 | EXAMINER (own) |
| `GET /api/reports/:attemptId/pdf`, `GET /api/exams/:id/report/pdf` | M2 | EXAMINER (own) / owner candidate (own, published) |
| `GET /verify/:code` (public page), `GET /api/verify/:code` | M2 | public, minimal data |
| `GET/PUT /api/me/preferences` | M3 (uses M1 session) | any |

### Key payloads

**Start/resume attempt** `POST /api/exams/:id/attempts` (body `{ "sandbox": false }`) ->
```json
{ "attemptId": "cl...", "resumed": false }
```
Errors: `NOT_ENROLLED` 403, `EXAM_NOT_AVAILABLE` 403 (before start / not published), `EXAM_ENDED` 403, `CONFLICT` 409 if already submitted.

**Load attempt** `GET /api/attempts/:id` ->
```json
{
  "serverNow": "2026-11-27T10:00:00.000Z",
  "attempt": { "id": "cl..", "status": "IN_PROGRESS", "startedAt": "...", "expiresAt": "...",
               "remainingMs": 3540000, "inGrace": false },
  "exam": { "title": "...", "instructions": "...", "durationMin": 60, "totalMarks": 50 },
  "questions": [
    { "id": "<attemptQuestionId>", "order": 1, "type": "MCQ", "text": "...", "marks": 2,
      "options": [ { "id": "o1", "text": "..." } ] }
  ],
  "answers": { "<attemptQuestionId>": { "response": { "optionIds": ["o1"] }, "flagged": false, "seq": 4 } },
  "announcements": [ { "id": "..", "message": "..", "at": ".." } ]
}
```
(`options` never contain `isCorrect`. `id` of a question = `AttemptQuestion.id`.)

**Autosave** `PUT /api/attempts/:id/answers` (supports batch for outbox flush) ->
```json
// request
{ "items": [ { "questionId": "<attemptQuestionId>", "response": { "optionIds": ["o1","o3"] },
               "flagged": false, "seq": 7, "elapsedMs": 183400 } ] }
// response
{ "serverNow": "...", "expiresAt": "...", "results": [ { "questionId": "..", "status": "saved|ignored_stale|rejected_late" } ] }
```
Response format by type: MCQ `{ "optionIds": ["x"] }` · MULTI `{ "optionIds": ["x","y"] }` · WRITTEN `{ "text": "..." }`.

**Submit** `POST /api/attempts/:id/submit` -> `{ "status": "SUBMITTED", "submittedAt": "..." }` - safe to call repeatedly (idempotent).

**Heartbeat** `POST /api/attempts/:id/heartbeat` -> `{ "serverNow", "expiresAt", "announcements": [ ...new since last ] }`

**Incident** `POST /api/attempts/:id/incidents` body `{ "type": "TAB_HIDDEN", "meta": { "durationMs": 4200 } }`

**Monitor** `GET /api/exams/:id/monitor` ->
```json
{ "serverNow": "...", "counts": { "enrolled": 40, "notStarted": 12, "inProgress": 25, "submitted": 3 },
  "attempts": [ { "attemptId": "..", "candidate": { "id": "..", "name": ".." }, "status": "IN_PROGRESS",
                  "answered": 14, "total": 30, "lastHeartbeatAt": "..", "incidentCount": 2, "lateSyncCount": 0 } ],
  "recentIncidents": [ { "attemptId": "..", "candidateName": "..", "type": "TAB_HIDDEN", "at": "..", "meta": {} } ] }
```
Incidents are shown as **indicators**, not proof (UI copy must say this).

**Public verify** `GET /api/verify/:code` -> `{ "valid": true, "examTitle": "...", "issuedAt": "...", "candidate": "A. K.", "scoreBand": "Pass" }` - minimal data only (no answers, no email).

## 7. Innovation challenge (chosen): 5.3 Failure-Resilient Examinations (+ light 5.1 incident logging)

Rules the whole team must respect:
1. `expiresAt` is fixed at attempt start and never extended - disconnects do NOT pause the clock.
2. Client writes every answer change to an **IndexedDB outbox** first, then sends it. Outbox drains on reconnect, in `seq` order.
3. Server ignores any `seq <= stored seq` for that answer (idempotent, out-of-order safe).
4. **Late sync:** answers arriving after `expiresAt` are accepted only inside a grace window of **120 seconds** (`GRACE_MS = 120_000`, one constant in `lib/constants.ts`), and only if the item's `elapsedMs <= durationMin*60000`. Accepted late syncs increment `Attempt.lateSyncCount` and create a `LATE_SYNC` incident for examiner review.
   **Important - lazy finalization must respect the grace window:** an attempt stays `IN_PROGRESS` until `expiresAt + GRACE_MS`. `finalizeIfExpired` only finalizes when `now > expiresAt + GRACE_MS` (an explicit `submit` always finalizes immediately). While `expiresAt < now <= expiresAt + GRACE_MS`, `GET /api/attempts/:id` returns `remainingMs: 0` and `inGrace: true`, and the UI shows the exam as ended (inputs locked) but still flushes the outbox. Otherwise a reconnecting candidate's buffered answers would be rejected because the attempt was already finalized.
   Seq numbering: client `seq` starts at 1 per question and increases on every change; the server's stored `Answer.seq` starts at 0.
5. Refresh/crash -> `GET /api/attempts/:id` restores saved answers and remaining time; local outbox is merged on top.
6. Trade-off to state in the demo: `elapsedMs` is client-reported, so a determined cheater could fake it. Mitigations: short grace window, heartbeat gap history, examiner-visible LATE_SYNC flag. The system favors not punishing honest candidates over perfect cheat-proofing.

## 8. Timeline (10 hours)

| Time | Milestone |
|---|---|
| 0:00-0:45 | Together: repo, stack, schema migrated, Vercel hello-world, read this contract |
| 0:45-1:45 | **M1 ships auth + schema + seed (login works for 3 roles).** M2/M3 build with mock data until then |
| 1:45-5:30 | Feature build (see individual briefs) |
| **5:30** | **Integration checkpoint** - one full flow: create exam -> enroll -> attempt -> grade -> publish -> candidate sees result |
| 5:30-8:30 | Secondary features, innovation, hardening, polish |
| 8:30-10:00 | Together: bug bash, seed realistic data, README, final deploy, demo rehearsal x2 |

## 9. README checklist (M1 owns, everyone contributes a section)

- Project summary, live URL, repo URL
- Setup steps (env vars, `npx prisma migrate deploy`, `npx prisma db seed`, `npm run dev`)
- **Test credentials for each role** (fictional data)
- Stack + why; architecture diagram (simple boxes); DB diagram (screenshot of Prisma schema or Mermaid ER)
- Grading rules (section 5), innovation description + trade-offs (section 7)
- Known limitations (be honest; judges ask)

## 10. Demo script (15 minutes)

1. (1 min) Problem + architecture in one slide/diagram.
2. (3 min) Admin creates users -> Examiner creates exam, imports questions via CSV, enrolls candidates, publishes.
3. (4 min) Candidate takes exam: palette, flag, scratchpad, custom layout, autosave chip. **Pull the network** -> offline banner, keep answering, refresh page -> state restored, reconnect -> synced.
4. (2 min) Examiner monitor: progress, incidents, announcement appears on candidate screen.
5. (2 min) Grading: auto-graded MCQ, manual written grade, publish results.
6. (2 min) Analytics, PDF report, scan QR -> verify page, sandbox preview.
7. (1 min) Security/data integrity talking points: server time, snapshot, idempotent submit, RBAC.

## 11. Test-credential seed (create in `prisma/seed.ts`)

```
admin@exam.test       / Admin@123     (ADMIN)
examiner@exam.test    / Exam@123      (EXAMINER)
candidate1@exam.test  / Cand@123      (CANDIDATE)  ... up to candidate10
```
Seed also creates: a question bank of 30+ questions across 3 topics, one PUBLISHED exam that is currently open, one DRAFT exam, one COMPLETED exam with graded attempts (so analytics/PDF demos have real data).
