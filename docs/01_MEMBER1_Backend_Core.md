# Member 1 - Backend Core & Exam Engine

**You are the critical path.** Members 2 and 3 are blocked until your schema, auth and attempt API exist. Ship the foundation fast, then harden.

**Read first:** `00_SHARED_CONTRACT.md` and `prisma/schema.prisma`.
**Branch:** `m1-backend`
**Your marks:** most of Technical Quality (20), most of Core Functionality correctness (30), and the backend half of Innovation (15).

---

## You own

```
prisma/schema.prisma, migrations, seed.ts
lib/auth/*                     session, hashing, requireRole, assertExamOwner, assertEnrolled
lib/services/*                 examLifecycle, attemptService, gradingService, resultService
lib/validation/*               zod schemas for your endpoints
app/api/auth/*  app/api/me
app/api/candidate/*
app/api/attempts/*
app/api/exams/[id]/attempts, app/api/exams/[id]/results/publish
Deployment (Vercel + Neon), env vars, README
```

## Deliverables (in priority order)

### Phase A - Foundation (target: done by ~1:45; push to `main` immediately)
- [ ] Prisma schema migrated to Neon; `prisma db seed` creates admin, examiner, 10 candidates, a question bank, and exams (see contract section 11).
- [ ] Auth: login/logout/`GET /api/me`. Passwords hashed with bcrypt/argon2. Session in httpOnly + Secure + SameSite=Lax cookie (signed JWT via `jose`, or Auth.js).
- [ ] Rate-limit login (simple in-memory or DB counter per email+IP is enough).
- [ ] `requireRole`, `assertExamOwner`, `assertEnrolled` helpers, with consistent 401/403 error format.
- [ ] Next.js `middleware.ts` for coarse route protection (e.g. `/admin/*` needs ADMIN) **plus** real checks inside every API route.
- [ ] Shared `apiHandler()` wrapper that catches errors, maps Zod errors -> 400 `VALIDATION_ERROR`, unknown errors -> 500 without leaking stack traces.
- [ ] Message to the team: "Auth + seed are live on main."

### Phase B - Exam lifecycle & candidate listing
- [ ] `deriveExamPhase(exam, now)` -> `DRAFT | UPCOMING | ONGOING | COMPLETED`.
- [ ] `GET /api/candidate/exams`: only exams the candidate is enrolled in, grouped as **available** (ONGOING, not finished), **upcoming**, **completed**; includes `accessStatus` (e.g. "Opens in 2h", "Open now", "Submitted", "Result published").
- [ ] Block access before `startAt`, after `endAt`, if status is not PUBLISHED, or if not enrolled. Return `EXAM_NOT_AVAILABLE` / `EXAM_ENDED` / `NOT_ENROLLED`.

### Phase C - Attempt engine (core of the project)
- [ ] `POST /api/exams/:id/attempts`:
  - Validates enrollment + availability window.
  - **Resume** if an IN_PROGRESS attempt exists (return same id, `resumed: true`).
  - Otherwise creates the attempt in a **transaction**: `expiresAt = min(now + durationMin, exam.endAt)`; build `AttemptQuestion` rows, shuffling question order and option order if the exam settings say so, storing the full snapshot (text, options with `isCorrect`, marks, scheme) in `AttemptQuestion.snapshot`.
  - Unique `(examId,userId,sandboxRun=0)` prevents duplicates; catch the unique-violation and return the existing attempt.
  - `sandbox: true` (EXAMINER of that exam only): `isSandbox=true`, `sandboxRun = next integer`.
- [ ] `GET /api/attempts/:id`: owner only; return the shape in the contract; use `toCandidateQuestion()` to **strip answer keys**; include `serverNow`, saved answers, announcements. **Run lazy finalization first** (below).
- [ ] `PUT /api/attempts/:id/answers` (batch):
  - Reject if attempt not IN_PROGRESS.
  - If `now <= expiresAt`: accept. If `now <= expiresAt + GRACE_MS` AND `elapsedMs <= duration`: accept as late sync (`lateSyncCount++`, create `LATE_SYNC` incident). Else `rejected_late`.
  - Call `finalizeIfExpired` first (it only finalizes after the grace window, see below); if the attempt is already finalized, every item returns `rejected_late`.
  - Per item: validate response shape against question type (option ids must belong to that question; MCQ max 1 option; WRITTEN text max length e.g. 20k chars).
  - Upsert `Answer` only if incoming `seq > stored seq` (else `ignored_stale`).
  - Always return `serverNow` + `expiresAt` so the client can recalibrate its timer.
- [ ] `POST /api/attempts/:id/submit`: transaction + conditional update `status IN_PROGRESS -> SUBMITTED` (`updateMany where status=IN_PROGRESS`; if count 0, just return the current state). Calls `finalizeAttempt`.
- [ ] `finalizeAttempt(attemptId)`: sets `submittedAt`, auto-grades objective answers (gradingService), auto-grades unanswered WRITTEN as 0, computes score; sets `GRADED` if no WRITTEN answers need review, else stays `SUBMITTED`.
- [ ] **Lazy expiry finalization:** a helper `finalizeIfExpired(attempt)` called in `GET attempt`, `PUT answers`, `POST submit`, and in the examiner monitor/submissions queries (expose it for M2). No background worker is needed on serverless. Optionally add one Vercel Cron route as a sweeper (Hobby plan: once per day only, so don't rely on it).
  **Grace-window rule (easy to get wrong):** it finalizes only when `now > expiresAt + GRACE_MS`, NOT at `expiresAt`. Between `expiresAt` and `expiresAt + GRACE_MS` the attempt stays `IN_PROGRESS` so late-synced answers can still be accepted; `GET attempt` returns `remainingMs: 0, inGrace: true` during that time. An explicit `POST submit` finalizes immediately. Put `GRACE_MS` in `lib/constants.ts`.
- [ ] `POST /api/attempts/:id/heartbeat`: updates `lastHeartbeatAt`; returns `serverNow`, `expiresAt`, new announcements. If the gap since the last heartbeat is > 45s, record a `DISCONNECT`/`RECONNECT` incident pair.
- [ ] `POST /api/attempts/:id/incidents`: owner only, whitelisted types, size-limited `meta`; throttle (max N per minute) so a bad client can't spam.

### Phase D - Grading engine & results
- [ ] `gradingService.gradeObjective(snapshot, response)` implementing the rules in contract section 5 (MCQ, MULTI all-or-nothing, MULTI partial, negative marking). **Write unit tests** (Vitest) - a table of ~12 cases; judges love it and it protects correctness.
- [ ] `recomputeAttemptScore(attemptId)` - sums `awardedMarks`, flips status to `GRADED` when all WRITTEN answers are graded. Expose to M2, who calls it from the manual-grading endpoint. Must be transactional and consistent.
- [ ] `POST /api/exams/:id/results/publish`: examiner-of-exam only; first run `finalizeIfExpired` on all IN_PROGRESS attempts of the exam, then refuse if any attempt is still IN_PROGRESS (still inside its time or grace window) or has ungraded WRITTEN answers (return the list of blockers); sets `resultsPublishedAt`; writes an `AuditLog` row; creates `Report` rows (random `verifyCode`, SHA-256 `hash`) for graded attempts (M2 renders them).
- [ ] `GET /api/candidate/results/:attemptId`: owner only AND `resultsPublishedAt != null`; returns score, per-question outcome (and correct answers only if you decide to allow review - default: show score + marks per question, not keys).
- [ ] Authorization tests: candidate A cannot read candidate B's attempt/result (403/404); examiner cannot touch another examiner's exam.

### Phase E - Innovation 5.3 (backend half) & hardening
- [ ] Implement exactly the rules in contract section 7 (fixed expiry, seq idempotency, grace window, `elapsedMs` check, LATE_SYNC incident, resume).
- [ ] Concurrency check: fire 5 parallel submits and 10 parallel autosaves at one attempt (simple script) - no duplicates, no 500s.
- [ ] Input size limits and sanitation on all your routes.
- [ ] Security review pass: grep for any response containing `isCorrect`/`passwordHash`; confirm each route calls `requireRole`.

### Phase F - Delivery
- [ ] Production env vars on Vercel; run `prisma migrate deploy` + seed against Neon.
- [ ] Write README (see contract section 9) incl. grading rules, architecture, innovation trade-offs, test credentials.
- [ ] Final deploy at least 45 minutes before the deadline; verify the three roles can log in on the live URL.

## Suggested schedule
| Time | Work |
|---|---|
| 0:00-0:45 | Setup together; you finalize the schema |
| 0:45-1:45 | Phase A |
| 1:45-2:30 | Phase B |
| 2:30-5:00 | Phase C + grading unit tests |
| 5:00-5:30 | Phase D basics -> **integration checkpoint** |
| 5:30-8:00 | Phase D finish, Phase E |
| 8:00-10:00 | Phase F, bug bash, rehearsal |

## Interfaces you owe the others
- **To M2:** `requireRole/assertExamOwner`, `recomputeAttemptScore`, `finalizeIfExpired`, `deriveExamPhase`, `Report` creation on publish, seed data.
- **To M3:** stable payload shapes (contract section 6), CORS not needed (same origin), error codes for UI messages, a seeded open exam for UI testing.

## Definition of done
- Three roles log in; wrong-role requests get 403 from the **API** (test with curl).
- Refresh mid-exam restores answers and remaining time.
- Double submit and parallel autosave never corrupt data.
- Expired attempt auto-finalizes with only accepted answers.
- Candidate API responses contain no answer keys.
- Grading unit tests pass.

## Demo talking points (yours)
Server-side time, per-attempt snapshot, idempotent submit/seq, lazy finalization on serverless, grace-window trade-off, RBAC in the backend (show a 403 in the network tab).
