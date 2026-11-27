# API Reference

REST-style JSON API implemented as Next.js Route Handlers under `app/api/`. This is the full reference; [00_SHARED_CONTRACT.md](00_SHARED_CONTRACT.md) section 6 is the short summary and the two must agree. Data shapes refer to [database.md](database.md).

**Owner key:** M1 = Member 1 (backend core), M2 = Member 2 (examiner/admin), M3 = Member 3 (candidate/UI).

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | Same origin as the web app (`/api/...`). No CORS needed. |
| Authentication | Session cookie (httpOnly, Secure, SameSite=Lax) set by `POST /api/auth/login`. Every endpoint except `login`, `GET /api/verify/:code` requires a valid session. |
| Content type | Requests and responses are `application/json`, except file uploads (`multipart/form-data`) and PDF downloads. |
| IDs | Opaque strings (cuid). |
| Timestamps | ISO-8601 UTC strings, e.g. `2026-11-27T10:00:00.000Z`. |
| Mutating requests | Must come from the app's own origin (the `Origin` header, when present, must match `APP_URL`'s host). Defense in depth on top of SameSite=Lax. |
| Idempotency | `submit`, `publish results`, `start attempt` and `autosave` are safe to repeat. Others are not unless stated. |
| Admin access | Wherever a route says "EXAMINER (own)", an ADMIN is also allowed (the guard `assertExamOwner` lets admins pass). Sandbox attempts are the exception (examiner of that exam only). |

### 1.1 Error format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable summary",
    "fields": { "durationMin": "Must be greater than 0" },
    "details": { }
  }
}
```
`fields` appears on validation errors. `details` (optional) carries structured extras, such as the blockers that prevent publishing results.

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body, query or params failed Zod validation |
| 401 | `UNAUTHENTICATED` | No/invalid session, bad credentials, deactivated user |
| 403 | `FORBIDDEN` | Wrong role; or a candidate asks for results that are not published |
| 403 | `NOT_ENROLLED` | Candidate is not enrolled in the exam |
| 403 | `EXAM_NOT_AVAILABLE` | Exam is not PUBLISHED, or the window has not opened |
| 403 | `EXAM_ENDED` | Window closed, or results already published |
| 404 | `NOT_FOUND` | Resource does not exist **or belongs to someone else** |
| 409 | `CONFLICT` | Duplicate (e.g. email, second real attempt), locked edit, blocked state change |
| 409 | `ATTEMPT_CLOSED` | Heartbeat/incident call on an already finalized attempt |
| 429 | `RATE_LIMITED` | Too many requests (see 1.3) |
| 500 | `INTERNAL` | Unexpected error (no internals leaked) |

### 1.2 Pagination
List endpoints that can grow take `page` (1-based, default 1) and `pageSize` (default 20, max 100) and return:
```json
{ "items": [ ], "page": 1, "pageSize": 20, "total": 134 }
```

### 1.3 Rate limits
| Endpoint | Limit | Result |
|---|---|---|
| `POST /api/auth/login` | 5 failures / 15 min per email + IP | 429 |
| `POST /api/attempts/:id/incidents` | 30 / minute per attempt | 429 |
| `GET /api/verify/:code` | 30 / minute per IP | 429 |

### 1.4 Shared value sets
- `phase`: `DRAFT | UPCOMING | ONGOING | COMPLETED | ARCHIVED` (derived; see database.md section 1).
- Question `type`: `MCQ | MULTI | WRITTEN`. `difficulty`: `EASY | MEDIUM | HARD`. `multiScheme`: `ALL_OR_NOTHING | PARTIAL`.
- Attempt `status`: `IN_PROGRESS | SUBMITTED | GRADED`.
- Answer `response`: MCQ `{ "optionIds": ["id"] }`, MULTI `{ "optionIds": ["id","id"] }`, WRITTEN `{ "text": "..." }`.

---

## 2. Endpoint index

| # | Method + path | Owner | Access |
|---|---|---|---|
| 1 | `POST /api/auth/login` | M1 | public |
| 2 | `POST /api/auth/logout` | M1 | any logged-in |
| 3 | `GET /api/me` | M1 | any logged-in |
| 4 | `GET /api/me/preferences`, `PUT /api/me/preferences` | M3 | any logged-in |
| 5 | `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` | M2 | ADMIN |
| 6 | `GET /api/candidates` | M2 | EXAMINER, ADMIN |
| 7 | `GET /api/questions`, `POST /api/questions`, `GET /api/questions/:id`, `PATCH /api/questions/:id`, `DELETE /api/questions/:id` | M2 | EXAMINER (own), ADMIN |
| 8 | `GET /api/exams`, `POST /api/exams`, `GET /api/exams/:id`, `PATCH /api/exams/:id` | M2 | EXAMINER (own), ADMIN |
| 9 | `PUT /api/exams/:id/questions` | M2 | EXAMINER (own) |
| 10 | `POST /api/exams/:id/publish` | M2 | EXAMINER (own) |
| 11 | `GET /api/exams/:id/enrollments`, `POST /api/exams/:id/enrollments`, `DELETE /api/exams/:id/enrollments/:userId` | M2 | EXAMINER (own) |
| 12 | `POST /api/import/candidates`, `POST /api/import/questions` | M2 | EXAMINER, ADMIN |
| 13 | `GET /api/candidate/exams` | M1 | CANDIDATE |
| 14 | `POST /api/exams/:id/attempts` | M1 | CANDIDATE (enrolled); EXAMINER for `sandbox: true` |
| 15 | `GET /api/attempts/:id` | M1 | attempt owner |
| 16 | `PUT /api/attempts/:id/answers` | M1 | attempt owner |
| 17 | `POST /api/attempts/:id/submit` | M1 | attempt owner |
| 18 | `POST /api/attempts/:id/heartbeat` | M1 | attempt owner |
| 19 | `POST /api/attempts/:id/incidents` | M1 | attempt owner |
| 20 | `GET /api/exams/:id/monitor` | M2 | EXAMINER (own) |
| 21 | `GET /api/exams/:id/announcements`, `POST /api/exams/:id/announcements` | M2 | GET: EXAMINER (own) or enrolled CANDIDATE; POST: EXAMINER (own) |
| 22 | `GET /api/exams/:id/submissions` | M2 | EXAMINER (own) |
| 23 | `GET /api/attempts/:id/review` | M2 | EXAMINER (own) |
| 24 | `GET /api/exams/:id/grading/queue` | M2 | EXAMINER (own) |
| 25 | `PATCH /api/answers/:id/grade` | M2 | EXAMINER (own) |
| 26 | `POST /api/exams/:id/results/publish` | M1 | EXAMINER (own) |
| 27 | `GET /api/candidate/results/:attemptId` | M1 | attempt owner, published only |
| 28 | `GET /api/exams/:id/analytics`, `GET /api/exams/:id/questions/analytics` | M2 | EXAMINER (own) |
| 29 | `GET /api/reports/:attemptId/pdf`, `GET /api/exams/:id/report/pdf` | M2 | see section 16 |
| 30 | `GET /api/verify/:code` (and public page `/verify/:code`) | M2 | public |

---

## 3. Authentication and profile

### 3.1 `POST /api/auth/login`
Request: `{ "email": "candidate1@exam.test", "password": "Cand@123" }`
Response `200` + `Set-Cookie`: `{ "user": { "id": "...", "name": "...", "email": "...", "role": "CANDIDATE" } }`
Errors: `401 UNAUTHENTICATED` ("Invalid email or password" for unknown email, wrong password and deactivated account alike), `429 RATE_LIMITED`.

### 3.2 `POST /api/auth/logout`
Clears the cookie. Response `200`: `{ "ok": true }`.

### 3.3 `GET /api/me`
Response `200`: `{ "user": { "id", "name", "email", "role" } }`. `401` when not logged in.

### 3.4 `GET /api/me/preferences` / `PUT /api/me/preferences`
`GET` response: `{ "prefs": { ... } }` (or `{ "prefs": null }` if never saved).
`PUT` request: `{ "prefs": { "theme": "dark", "fontSize": "L", "density": "compact", "palettePosition": "right" } }`
Allowed values: `theme`: `light | dark | contrast`; `fontSize`: `S | M | L | XL`; `density`: `comfortable | compact`; `palettePosition`: `left | right | bottom`. Unknown keys are rejected (`400`). Response `200`: `{ "prefs": { ... } }`.

---

## 4. Users (ADMIN)

### 4.1 `GET /api/users`
Query: `search` (name/email), `role`, `active` (`true|false`), `page`, `pageSize`.
Response: paginated `items` of `{ "id", "name", "email", "role", "active", "rollNo", "createdAt" }`.

### 4.2 `POST /api/users`
Request: `{ "name", "email", "password", "role", "rollNo"? }` - password at least 8 characters.
Response `201`: `{ "user": { ... } }`. Errors: `400`, `409 CONFLICT` (email already exists).

### 4.3 `PATCH /api/users/:id`
Request (any subset): `{ "name", "role", "active", "rollNo", "password" }` (`password` = reset).
Response `200`: `{ "user": { ... } }`.
Rules (server-enforced): the last active ADMIN cannot be demoted or deactivated -> `409 CONFLICT`. Writes an `AuditLog` row.

---

## 5. Candidate lookup (EXAMINER, ADMIN)

### `GET /api/candidates`
Query: `search` (name, email or roll number), `page`, `pageSize`.
Response: paginated `items` of `{ "id", "name", "email", "rollNo" }`, only users with role CANDIDATE and `active = true`. Exists so examiners can enroll people without being able to call `/api/users`.

---

## 6. Question bank

Questions are visible and editable only by their creator (ADMIN sees all).

### 6.1 `GET /api/questions`
Query: `topic`, `difficulty`, `type`, `search` (text), `page`, `pageSize`.
Item: `{ "id", "topic", "difficulty", "type", "text", "defaultMarks", "negativeMarks", "multiScheme", "options": [ { "id", "text", "isCorrect", "order" } ], "usedInExams": 2 }`. (Examiner/admin responses include `isCorrect`.)

### 6.2 `POST /api/questions`
```json
{ "topic": "Networking", "difficulty": "MEDIUM", "type": "MULTI",
  "text": "Select all transport-layer protocols.", "defaultMarks": 2,
  "negativeMarks": 0, "multiScheme": "PARTIAL",
  "options": [ { "text": "TCP", "isCorrect": true }, { "text": "UDP", "isCorrect": true },
               { "text": "HTTP", "isCorrect": false } ] }
```
Validation: `topic` 1-100 chars; `text` 1-5000; `defaultMarks` > 0; `negativeMarks` >= 0. By type: **MCQ** - 2 to 6 options, exactly 1 correct; **MULTI** - 2 to 6 options, at least 1 correct; **WRITTEN** - no options. Option text 1-1000 chars.
Response `201`: `{ "question": { ... } }`.

### 6.3 `GET /api/questions/:id`, `PATCH /api/questions/:id`
`PATCH` takes any subset of the creation fields; if `options` is sent it replaces the whole option list (validated as above). Editing a question never changes existing attempts (they use snapshots).

### 6.4 `DELETE /api/questions/:id`
`204`. `409 CONFLICT` if the question is assigned to any exam.

---

## 7. Exams

Exam object (examiner view):
```json
{ "id": "...", "title": "...", "instructions": "...", "startAt": "...", "endAt": "...",
  "durationMin": 60, "totalMarks": 50, "status": "PUBLISHED", "phase": "UPCOMING",
  "shuffleQuestions": true, "shuffleOptions": true, "resultsPublishedAt": null,
  "createdById": "...", "createdAt": "..." }
```

### 7.1 `GET /api/exams`
Query: `phase`, `search`, `page`, `pageSize`. Examiners see their own exams; admins see all.
Item: exam object + `"questionCount"`, `"enrolledCount"`.

### 7.2 `POST /api/exams`
Request: `{ "title", "instructions", "startAt", "endAt", "durationMin", "shuffleQuestions", "shuffleOptions" }`
Validation: `title` 1-200; `instructions` up to 10000; `durationMin` integer 1-1440; `endAt > startAt`; `durationMin <=` window length in minutes.
Response `201`: `{ "exam": { ... } }` (status `DRAFT`, `totalMarks` 0).

### 7.3 `GET /api/exams/:id`
Response: `{ "exam": { ... }, "questions": [ { "questionId", "order", "marks", "type", "topic", "difficulty", "text" } ], "enrolledCount": 40 }`.

### 7.4 `PATCH /api/exams/:id`
Any subset of the creation fields, same validation. **Locking:** once the phase is ONGOING or COMPLETED, or any real attempt exists, only `title` and `instructions` may change; any other field -> `409 CONFLICT`.

### 7.5 `PUT /api/exams/:id/questions`
Replaces the exam's question list:
```json
{ "items": [ { "questionId": "...", "marks": 2, "order": 1 }, { "questionId": "...", "marks": 5, "order": 2 } ] }
```
Server recomputes `Exam.totalMarks` as the sum of `marks`. Questions must belong to the caller (or caller is admin). `409 CONFLICT` if a real attempt already exists. Response `200`: `{ "exam": { ... } }`.

### 7.6 `POST /api/exams/:id/publish`
Review-before-publish gate. Succeeds only if: status is `DRAFT`, there is at least one question, schedule is valid (`endAt > startAt`, `durationMin <=` window, `endAt` in the future).
Response `200`: `{ "exam": { "status": "PUBLISHED", ... }, "warnings": [ "No candidates are enrolled yet" ] }`.
Errors: `409 CONFLICT` with `details.problems: [ "No questions assigned", ... ]`. There is no unpublish. Writes an `AuditLog` row.

---

## 8. Enrollments

### 8.1 `GET /api/exams/:id/enrollments`
Response: `{ "items": [ { "userId", "name", "email", "rollNo", "attemptStatus": "NOT_STARTED|IN_PROGRESS|SUBMITTED|GRADED" } ] }` (real attempts only).

### 8.2 `POST /api/exams/:id/enrollments`
Request: `{ "userIds": ["..."], "emails": ["..."] }` (at least one of the two, max 500 entries total).
Response `200`: `{ "added": 12, "skipped": [ { "ref": "x@y.com", "reason": "NOT_FOUND|NOT_A_CANDIDATE|INACTIVE|ALREADY_ENROLLED" } ] }`.
`409 CONFLICT` if results are already published.

### 8.3 `DELETE /api/exams/:id/enrollments/:userId`
`204`. `409 CONFLICT` if that candidate already has a real attempt.

---

## 9. Bulk import

`POST /api/import/candidates` and `POST /api/import/questions` - `multipart/form-data` with field `file` (`.csv` or `.json`, up to 2 MB and 2000 rows). Query `dryRun=true` validates only and imports nothing (powers the preview table); without it, **valid rows are imported and invalid rows are reported**.
Candidate import also accepts form field `examId` to enroll the imported users immediately.

**Candidate CSV columns:** `name,email,rollNo,password` (`password` optional; if missing a random one is generated). JSON: array of objects with the same keys.
**Question CSV columns:** `topic,difficulty,type,text,marks,optionA,optionB,optionC,optionD,optionE,optionF,correct` plus optional `negativeMarks,multiScheme`. `correct` is one or more option letters separated by `;` (e.g. `B` or `A;C`); `marks` maps to `defaultMarks`. JSON: array of `{ topic, difficulty, type, text, marks, negativeMarks?, multiScheme?, options: [ { text, isCorrect } ] }`.

Response `200`:
```json
{ "dryRun": false, "total": 40, "valid": 38, "invalid": 2, "imported": 38,
  "rows": [ { "row": 3, "status": "invalid", "errors": ["email: invalid format"] },
            { "row": 4, "status": "imported", "errors": [] } ],
  "credentialsCsv": "email,password\nali@x.com,Xk29...\n" }
```
`row` is the 1-based data row (header excluded). Row-level problems checked: required fields, formats, duplicates within the file, duplicates against the database (e.g. existing email), question rules from section 6.2. `credentialsCsv` is present only on a real candidate import that generated passwords, and is returned once. Errors: `400` for an unreadable or too-large file. Writes an `AuditLog` row.

---

## 10. Candidate: my exams

### `GET /api/candidate/exams`
Only PUBLISHED exams the candidate is enrolled in. Attempts that are past their grace window are finalized first.
```json
{ "available": [ ], "upcoming": [ ], "completed": [ ] }
```
Item:
```json
{ "examId": "...", "title": "...", "instructions": "...", "startAt": "...", "endAt": "...",
  "durationMin": 60, "totalMarks": 50, "phase": "ONGOING",
  "accessStatus": "OPEN", "attemptId": null, "resultsPublished": false }
```
`accessStatus`: `UPCOMING` (not yet open) · `OPEN` (can start) · `IN_PROGRESS` (resume; `attemptId` set) · `SUBMITTED` (finalized, result not published) · `RESULT_PUBLISHED` · `MISSED` (window ended or results published without an attempt).
Grouping: **available** = `OPEN`, `IN_PROGRESS`; **upcoming** = `UPCOMING`; **completed** = `SUBMITTED`, `RESULT_PUBLISHED`, `MISSED`. The client builds countdown text from `startAt`.

---

## 11. Attempts

**Access for 11.2-11.6:** the attempt owner, whether the attempt is live or sandbox. The guard is `requireRole("CANDIDATE", "EXAMINER")`; a different `userId` -> `404`; a role that does not match the attempt (`isSandbox` -> EXAMINER, otherwise CANDIDATE) -> `403`.

### 11.1 `POST /api/exams/:id/attempts` - start or resume
Request: `{ "sandbox": false }` (body optional; `sandbox` defaults to `false`).
Response: `201 { "attemptId": "...", "resumed": false }` when created, `200 { "attemptId": "...", "resumed": true }` when an in-progress attempt is returned.
Rules:
- **Real attempt:** caller must be an enrolled CANDIDATE; exam PUBLISHED; `startAt <= now <= endAt`; results not yet published. `expiresAt = min(now + durationMin, exam.endAt)`. Creates the snapshot (see database.md 7.1).
- **Sandbox attempt** (`sandbox: true`): only the EXAMINER who owns the exam. Skips enrollment, status (DRAFT allowed), window and results-published checks; `expiresAt = now + durationMin`; `isSandbox = true`, `sandboxRun` = next integer. Excluded from every statistic, monitor, report and result.
Errors: `403 NOT_ENROLLED`, `403 EXAM_NOT_AVAILABLE`, `403 EXAM_ENDED`, `409 CONFLICT` (a finished real attempt already exists).

### 11.2 `GET /api/attempts/:id` - load attempt
Owner only (`404` otherwise). Runs lazy finalization first. Response:
```json
{
  "serverNow": "2026-11-27T10:00:00.000Z",
  "attempt": { "id": "...", "status": "IN_PROGRESS", "startedAt": "...", "expiresAt": "...",
               "remainingMs": 3540000, "inGrace": false },
  "exam": { "title": "...", "instructions": "...", "durationMin": 60, "totalMarks": 50 },
  "questions": [ { "id": "<attemptQuestionId>", "order": 1, "type": "MCQ", "text": "...",
                   "marks": 2, "options": [ { "id": "o1", "text": "..." } ] } ],
  "answers": { "<attemptQuestionId>": { "response": { "optionIds": ["o1"] }, "flagged": false, "seq": 4 } },
  "announcements": [ { "id": "...", "message": "...", "at": "..." } ]
}
```
- `options` never include `isCorrect`. A question's `id` is the `AttemptQuestion` id.
- `exam.totalMarks` is the sum of this attempt's question marks.
- `remainingMs` = `max(0, expiresAt - serverNow)`. `inGrace` is `true` while `expiresAt < now <= expiresAt + GRACE_MS` and the attempt is still `IN_PROGRESS`.
- For a finalized attempt `status` is `SUBMITTED` or `GRADED` and the client shows a read-only "submitted" state.

### 11.3 `PUT /api/attempts/:id/answers` - autosave (batch)
Request:
```json
{ "items": [ { "questionId": "<attemptQuestionId>", "response": { "optionIds": ["o1","o3"] },
               "flagged": false, "seq": 7, "elapsedMs": 183400 } ] }
```
Limits: up to 100 items per request; `seq` >= 1; `elapsedMs` >= 0.
Response `200`:
```json
{ "serverNow": "...", "expiresAt": "...",
  "results": [ { "questionId": "...", "status": "saved" } ] }
```
Per-item `status`:
| Status | Meaning | Client action |
|---|---|---|
| `saved` | Accepted (including accepted late syncs) | Remove from outbox |
| `ignored_stale` | An equal or newer `seq` is already stored | Remove from outbox |
| `rejected_late` | Outside the time or grace window, or attempt already finalized | Permanent: drop, tell the candidate |
| `rejected_invalid` | Unknown question, option id not in that question, wrong shape or too long | Permanent: drop, show an error |

Time rule: accepted if `now <= expiresAt`; accepted as a **late sync** if `now <= expiresAt + GRACE_MS` and `elapsedMs <= expiresAt - startedAt` in ms (increments `lateSyncCount`, records a `LATE_SYNC` incident); otherwise `rejected_late`. A request body that is structurally invalid is `400`; item-level problems never fail the batch.

### 11.4 `POST /api/attempts/:id/submit`
Finalizes immediately (does not wait for the grace window). Idempotent: a repeat returns the current state.
Response `200`: `{ "status": "SUBMITTED", "submittedAt": "..." }` (status may be `GRADED` if no written answers need review).

### 11.5 `POST /api/attempts/:id/heartbeat`
Optional body: `{ "sinceAnnouncementAt": "<ISO timestamp>" }` (the newest announcement the client has seen).
Response `200`: `{ "serverNow": "...", "expiresAt": "...", "announcements": [ { "id", "message", "at" } ] }` containing announcements with `at` later than `sinceAnnouncementAt` (all if omitted).
Updates `lastHeartbeatAt`; if the gap since the previous heartbeat exceeded `DISCONNECT_GAP_MS` (45 s), records a `DISCONNECT` / `RECONNECT` incident pair. `409 ATTEMPT_CLOSED` if already finalized.

### 11.6 `POST /api/attempts/:id/incidents`
Request: `{ "type": "TAB_HIDDEN", "meta": { "durationMs": 4200 } }`. Allowed client-sent types: `TAB_HIDDEN`, `FULLSCREEN_EXIT`, `PASTE`, `COPY`, `OTHER` (`DISCONNECT`, `RECONNECT`, `LATE_SYNC` are written by the server only). `meta` is small and size-limited.
Response `201`: `{ "id": "..." }`. Errors: `409 ATTEMPT_CLOSED`, `429 RATE_LIMITED`.

---

## 12. Monitoring and announcements

### 12.1 `GET /api/exams/:id/monitor`
Real attempts only. Triggers lazy finalization for attempts past their grace window.
```json
{ "serverNow": "...",
  "counts": { "enrolled": 40, "notStarted": 12, "inProgress": 25, "submitted": 3 },
  "attempts": [ { "attemptId": "...", "candidate": { "id": "...", "name": "..." },
                  "status": "IN_PROGRESS", "answered": 14, "total": 30,
                  "lastHeartbeatAt": "...", "incidentCount": 2, "lateSyncCount": 0 } ],
  "recentIncidents": [ { "attemptId": "...", "candidateName": "...", "type": "TAB_HIDDEN",
                         "at": "...", "meta": { } } ] }
```
`submitted` counts attempts with status `SUBMITTED` or `GRADED`. `answered` counts answers with a non-empty response. Incidents are **indicators for human review, not proof of misconduct**; the UI must say so.

### 12.2 `GET /api/exams/:id/announcements`
Response `{ "items": [ { "id", "message", "at" } ] }`, newest last. Allowed for the owning examiner and for enrolled candidates.

### 12.3 `POST /api/exams/:id/announcements`
Request: `{ "message": "Ten minutes remaining" }` (1-500 chars). Exam must be PUBLISHED. Response `201`: `{ "announcement": { "id", "message", "at" } }`.

---

## 13. Evaluation and grading

### 13.1 `GET /api/exams/:id/submissions`
Real attempts, after lazy finalization.
Item: `{ "attemptId", "candidate": { "id", "name", "rollNo" }, "status", "score", "totalMarks", "submittedAt", "lateSyncCount", "incidentCount", "pendingWritten": 1 }` (`pendingWritten` = written answers awaiting marks).

### 13.2 `GET /api/attempts/:id/review`
Examiner view of one finalized attempt, **including answer keys**:
```json
{ "attempt": { "id": "...", "status": "SUBMITTED", "score": 18, "submittedAt": "...",
               "candidate": { "id": "...", "name": "..." } },
  "questions": [ { "attemptQuestionId": "...", "order": 1, "type": "WRITTEN", "text": "...", "marks": 5,
                   "options": [ { "id": "...", "text": "...", "isCorrect": true } ],
                   "answer": { "id": "<answerId>", "response": { "text": "..." }, "flagged": false,
                               "awardedMarks": null, "feedback": null } } ],
  "incidents": [ { "type": "LATE_SYNC", "at": "...", "meta": { } } ] }
```
(`options` is empty for WRITTEN questions.)

### 13.3 `GET /api/exams/:id/grading/queue`
Query: `questionId` (the bank question id), `candidateId`, `page`, `pageSize`. Ungraded WRITTEN answers (non-empty response, `awardedMarks` null) of finalized attempts.
Item: `{ "answerId", "attemptId", "candidate": { "id", "name", "rollNo" }, "question": { "attemptQuestionId", "questionId", "text", "marks" }, "response": { "text": "..." }, "submittedAt": "..." }`.

### 13.4 `PATCH /api/answers/:id/grade`
Request: `{ "awardedMarks": 3.5, "feedback": "Good reasoning" }`.
Response `200`: `{ "answer": { "id", "awardedMarks", "feedback" }, "attempt": { "id", "status", "score" } }`.
Rules: answer must be WRITTEN, its attempt finalized, and `0 <= awardedMarks <= marks` -> else `400 VALIDATION_ERROR`; once results are published -> `409 CONFLICT`. The attempt score is recomputed in the same transaction and the status becomes `GRADED` when no ungraded written answers remain. Writes an `AuditLog` row.

---

## 14. Results

### 14.1 `POST /api/exams/:id/results/publish`
No body. Runs lazy finalization for the exam's in-progress attempts, then publishes only if no blockers exist.
Response `200`: `{ "publishedAt": "...", "reportsIssued": 38, "alreadyPublished": false }`. Idempotent: a second call returns `alreadyPublished: true` and the original timestamp.
Blocked -> `409 CONFLICT`:
```json
{ "error": { "code": "CONFLICT", "message": "Results cannot be published yet",
             "details": { "blockers": [
               { "type": "IN_PROGRESS", "attemptId": "...", "candidate": { "id": "...", "name": "..." } },
               { "type": "UNGRADED_WRITTEN", "attemptId": "...", "candidate": { "id": "...", "name": "..." }, "count": 2 } ] } } }
```
Effects: sets `resultsPublishedAt`, creates `Report` rows (random `verifyCode`, SHA-256 hash) for graded real attempts, writes an `AuditLog` row, and **closes the exam to new attempts**.

### 14.2 `GET /api/candidate/results/:attemptId`
Owner only (`404` for someone else's attempt). `403 FORBIDDEN` ("Results have not been published") until the exam's results are published.
```json
{ "exam": { "title": "..." },
  "attempt": { "id": "...", "submittedAt": "...", "score": 38, "totalMarks": 50,
               "percentage": 76, "passed": true },
  "questions": [ { "order": 1, "type": "MCQ", "topic": "Networking", "text": "...", "marks": 2,
                   "awardedMarks": 2, "outcome": "CORRECT" } ],
  "topicBreakdown": [ { "topic": "Networking", "awarded": 12, "total": 16 } ],
  "report": { "verifyCode": "...", "pdfUrl": "/api/reports/<attemptId>/pdf" } }
```
`outcome`: `CORRECT | PARTIAL | INCORRECT | UNANSWERED` (derived from `awardedMarks`, `marks` and whether a response exists). Answer keys are **not** included. `totalMarks` is the sum of the attempt's snapshot marks.

---

## 15. Analytics

Real, graded attempts only.

### 15.1 `GET /api/exams/:id/analytics`
```json
{ "exam": { "id": "...", "title": "...", "totalMarks": 50 },
  "counts": { "enrolled": 40, "attempted": 38, "graded": 38 },
  "score": { "average": 31.2, "median": 32, "highest": 49, "lowest": 8 },
  "passPercent": 40, "passRate": 0.84, "avgTimeUsedMin": 41.5,
  "distribution": [ { "from": 0, "to": 10, "count": 1 }, { "from": 10, "to": 20, "count": 3 } ] }
```
`distribution` has ten buckets of score percentage (`from` inclusive, `to` exclusive, except the last bucket which includes 100). Definitions in database.md section 9.

### 15.2 `GET /api/exams/:id/questions/analytics`
```json
{ "items": [ { "questionId": "...", "text": "...", "topic": "Networking", "type": "MCQ",
               "declaredDifficulty": "EASY", "observedDifficulty": "HARD",
               "attempts": 38, "correctPct": 18, "skippedPct": 5, "avgMarksPct": 18,
               "mostChosenWrongOption": { "text": "UDP", "count": 20 },
               "flags": [ "LOW_CORRECT" ] } ] }
```
`mostChosenWrongOption` is `null` for WRITTEN questions or when no wrong option was chosen. `flags` can contain `LOW_CORRECT` (correctPct < 20) and `HIGH_SKIPPED` (skippedPct > 30).

---

## 16. Reports and verification

### 16.1 `GET /api/reports/:attemptId/pdf`
Returns `application/pdf` (`Content-Disposition: attachment; filename="result-<attemptId>.pdf"`). Content: exam title, candidate name, score, percentage, topic breakdown, date, verification code and QR code. **No answer keys.** Requires published results (a `Report` row):
- candidate who owns the attempt: `403 FORBIDDEN` if not yet published; `404` if not theirs;
- owning examiner / admin: `409 CONFLICT` ("Publish results first") if not published.

### 16.2 `GET /api/exams/:id/report/pdf`
Exam summary PDF (statistics, distribution, ranked list of graded attempts). Owning examiner / admin.

### 16.3 `GET /api/verify/:code` and page `/verify/:code`
Public, rate-limited. The server looks up the `Report`, recomputes the hash from current data and compares it.
```json
{ "valid": true, "examTitle": "Database Systems Midterm", "issuedAt": "2026-11-27T12:00:00.000Z",
  "candidate": "A. K.", "scoreBand": "Pass" }
```
Unknown code or hash mismatch -> `200 { "valid": false }` (same shape for every invalid case). `candidate` is the initials-masked name (single-name users give e.g. `"A."`). `scoreBand` is `Pass` or `Fail` per `PASS_PERCENT`. **No email, roll number, answers or exact score.** The QR code on the PDF encodes `${APP_URL}/verify/${verifyCode}`.

---

## 17. Quick sequence reference: a candidate's calls

1. `POST /api/auth/login`
2. `GET /api/candidate/exams`
3. `POST /api/exams/:id/attempts` -> `attemptId`
4. `GET /api/attempts/:id` (with the `attemptId` from step 3)
5. Repeating (all under `/api/attempts/:id`): `PUT .../answers` (debounced / outbox flush), `POST .../heartbeat` (every 15 s), `POST .../incidents` (as events occur)
6. `POST /api/attempts/:id/submit`
7. After publication: `GET /api/candidate/results/:attemptId`, `GET /api/reports/:attemptId/pdf` (same attempt id)
