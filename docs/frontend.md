# Frontend Design

Next.js (App Router) + React + TypeScript, Tailwind + shadcn/ui, TanStack Query, react-hook-form + Zod, Recharts, `idb` (IndexedDB). The frontend is shared work: Member 3 owns the design system, candidate experience and offline module; Member 2 owns the admin and examiner screens and reuses Member 3's components.

Related: [api.md](api.md) (every endpoint used here), [architecture.md](architecture.md), [database.md](database.md), [systemdesign.md](systemdesign.md), and the member briefs `01`-`03`.

---

## 1. Principles

1. **The server is the authority; the UI is a view.** Hiding a button is never security. The UI must still handle 401/403/404/409 from the API gracefully.
2. **Never lose an answer.** Every change is written to the device first, then synced.
3. **Honest feedback.** Save status, connection status and the timer always tell the truth, including "the timer keeps running while you are offline".
4. **Accessible by default.** Keyboard, contrast, labels, reduced motion, responsive layouts (UI/UX is 20 marks and accessibility is named in the rubric).
5. **Designed, not templated.** One deliberate visual direction using shared tokens; shadcn components are customized, not shipped as defaults.
6. **One data path.** Client components call `app/api/*` through one fetch wrapper and TanStack Query.

---

## 2. Routes

| URL | Who | Owner | Purpose |
|---|---|---|---|
| `/` | any | M3 | Redirect by role after login: ADMIN -> `/admin/users`, EXAMINER -> `/examiner/exams`, CANDIDATE -> `/dashboard` |
| `/login` | public | M3 | Login with demo-accounts helper |
| `/dashboard` | CANDIDATE | M3 | Available / upcoming / completed exams |
| `/dashboard/exams/[examId]` | CANDIDATE | M3 | Instructions, privacy notice, confirmation, "Start exam" |
| `/exam/[attemptId]` | CANDIDATE | M3 | Exam workspace |
| `/results/[attemptId]` | CANDIDATE | M3 | Published result, PDF download |
| `/admin/users` | ADMIN | M2 | User and role management |
| `/examiner/exams` | EXAMINER, ADMIN | M2 | Exam list with phase badges |
| `/examiner/exams/new` | EXAMINER, ADMIN | M2 | Create exam |
| `/examiner/exams/[id]` | EXAMINER, ADMIN | M2 | Exam detail with tabs (query `?tab=`): `details`, `questions`, `candidates`, `monitor`, `grading`, `results`, `analytics` |
| `/examiner/questions` | EXAMINER, ADMIN | M2 | Question bank |
| `/examiner/exams/[id]/sandbox/[attemptId]` | EXAMINER | M2 | Sandbox preview using M3's workspace |
| `/verify/[code]` | public | M2 | Result verification page |

Route groups in the filesystem (`(auth)`, `(candidate)`, `(admin)`, `(examiner)`) share layouts without affecting URLs. `proxy.ts` provides the coarse URL guard (see architecture.md section 5.2); each page also handles a 401/403 from the API by redirecting to `/login` or showing a "not allowed" state.

---

## 3. Rendering model

- **Server components:** layouts and the root redirect.
- **Client components (`"use client"`):** anything interactive or time-based - the exam workspace, forms, tables with filters, monitor, charts, preferences.
- **Data:** TanStack Query against the JSON API. No page reads the database directly.

---

## 4. Data fetching and state

### 4.1 Fetch wrapper (`lib/api.ts`)
- Calls `fetch` with `credentials: "same-origin"` and JSON handling.
- On a non-2xx response throws `ApiError { status, code, message, fields?, details? }` built from the error format in api.md.
- `401 UNAUTHENTICATED` -> clear caches, redirect to `/login`.
- Retry policy: **no automatic retries for 4xx**; the autosave sync engine (section 10) has its own retry logic for network errors and 5xx.
- `NEXT_PUBLIC_USE_MOCK=true` switches to mock responses from `lib/mock/` (same JSON shapes as api.md) while the backend is still being built.

### 4.2 TanStack Query keys and refresh
| Query key | Endpoint | Refresh |
|---|---|---|
| `['me']` | `GET /api/me` | on mount, stale after 5 min |
| `['candidate','exams']` | `GET /api/candidate/exams` | on window focus; dashboard countdowns are computed client-side from `startAt` |
| `['attempt', id]` | `GET /api/attempts/:id` | loaded once for the workspace; afterwards the workspace owns its state (section 8) |
| `['exam', id]`, `['exam', id, 'enrollments']` ... | exam endpoints | invalidated after related mutations |
| `['exam', id, 'monitor']` | `GET /api/exams/:id/monitor` | `refetchInterval` = `MONITOR_POLL_MS` (4 s) only while the tab is visible |
| `['exam', id, 'analytics']` | analytics endpoints | on tab open |

Mutations invalidate the affected keys and show a toast on success or failure.

### 4.3 Local state
The exam workspace uses a reducer (section 8.2). Everything else uses component state plus TanStack Query. No global store is required.

---

## 5. Design system (Member 3, built first)

### 5.1 Tokens (CSS variables in `globals.css`)
Define once, use everywhere:
- Color roles: `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--brand`, `--brand-contrast`, `--success`, `--warning`, `--danger`, `--info`, `--focus-ring`.
- Typography: a clean sans for UI and a monospace for the timer, codes and verification IDs; a modular size scale.
- Spacing scale, radius, shadow and motion duration tokens.
- Three themes selected by `data-theme` on `<html>`: `light`, `dark`, `contrast` (high contrast). Density (`comfortable` / `compact`) and base font size (S/M/L/XL) are also driven by attributes/variables so the **customizable workspace** (feature 4.7) is mostly "set a variable".

Choose a deliberate palette and type pair instead of the shadcn defaults; check text contrast at 4.5:1 or better for every token pair in every theme.

### 5.2 Components (in `components/ui`)
Button, Input, Textarea, Select, Checkbox, Radio group, Dialog, Drawer/Sheet, Tabs, Table, Badge (status colors), Toast, Skeleton, ProgressBar, StatCard, EmptyState, ErrorState, PageHeader (title, actions, breadcrumbs). Each supports keyboard use, visible focus and ARIA labelling out of the box. A `/_design` page (or `components/README`) shows them so Member 2 can reuse them.

### 5.3 App shell
Role-aware sidebar/topbar (Admin: Users, Exams, Question bank; Examiner: Exams, Question bank; Candidate: Dashboard), user menu with logout, responsive behavior (sidebar collapses to a drawer on small screens), skip-to-content link, `header` / `nav` / `main` landmarks.

### 5.4 Status colors are never the only signal
Every state shown by color (answered, flagged, online/offline, phase badges) also has an icon or text label.

---

## 6. Login (`/login`)
Email + password form (react-hook-form + shared Zod schema), inline field errors, loading state, generic failure message from the API (it deliberately does not say which part was wrong), and a small "Demo accounts" helper listing the seeded credentials (admin, examiner, candidate) for judges.

---

## 7. Candidate dashboard and instructions

`/dashboard` shows three sections from `GET /api/candidate/exams`: **Available now**, **Upcoming**, **Completed**.

| `accessStatus` | Card shows | Action |
|---|---|---|
| `UPCOMING` | "Opens in 2h 10m" (client countdown from `startAt`) | disabled, with reason |
| `OPEN` | schedule, duration, marks | "View instructions / Start" |
| `IN_PROGRESS` | "In progress" | "Resume" -> `/exam/[attemptId]` |
| `SUBMITTED` | "Submitted - awaiting results" | none |
| `RESULT_PUBLISHED` | "Result published" | "View result" |
| `MISSED` | "Missed" | none |

Every list has loading skeletons, an empty state and an error state.

`/dashboard/exams/[examId]` shows full instructions, a rules summary (autosave, timer, what happens offline, and that a late start gets less time because the attempt ends no later than the exam window), a **transparent privacy notice** listing exactly what is logged (tab switches, fullscreen exit, copy/paste events, connection gaps) and stating these are indicators reviewed by a person, not automatic penalties, a confirmation checkbox, and the **Start exam** button (`POST /api/exams/:id/attempts`, then navigate to `/exam/[attemptId]`). API errors (`NOT_ENROLLED`, `EXAM_NOT_AVAILABLE`, `EXAM_ENDED`, `CONFLICT`) map to clear messages.

---

## 8. Exam workspace (`/exam/[attemptId]`)

### 8.1 Component tree
```
<ExamWorkspace mode="live | sandbox" attemptId>
  <WorkspaceProvider>                 reducer + outbox + clock + heartbeat hooks
    <WorkspaceHeader>
      title, <Timer/>, <SaveStatusChip/>, preferences gear, help, Submit
    <ConnectionBanner/>               Online / Unstable / Offline
    <AnnouncementBanner/>             dismissible examiner messages
    <main> (layout depends on palettePosition)
      <QuestionPane>
        <QuestionCard>                text, marks, "select all that apply" hint
          <AnswerInput type = MCQ | MULTI | WRITTEN/>
        <FlagToggle/>  <NavButtons/>
      <QuestionPalette/>              grid of question numbers
      <ScratchpadDrawer/>
    <ReviewSubmitDialog/>
```

### 8.2 Reducer state
```ts
type WorkspaceState = {
  attemptId: string;
  mode: "live" | "sandbox";
  questions: CandidateQuestion[];            // no answer keys
  answers: Record<string, { response: Response | null; flagged: boolean; seq: number }>;
  currentIndex: number;
  clock: { serverMsAtAnchor: number; perfAtAnchor: number };   // section 10.2
  expiresAtMs: number;                       // server time
  phase: "LIVE" | "LOCKED" | "SUBMITTING" | "DONE";
  sync: { state: "saved" | "saving" | "offline" | "retrying" | "failed";
          pending: number; lastSavedAt?: number };
  connection: "online" | "unstable" | "offline";
  announcements: Announcement[];
};
```
Actions: `LOADED`, `ANSWER_CHANGED`, `FLAG_TOGGLED`, `GO_TO`, `SYNC_STATE`, `CONNECTION_STATE`, `CLOCK_RECALIBRATED`, `ANNOUNCEMENTS_RECEIVED`, `LOCK`, `SUBMIT_STARTED`, `SUBMIT_DONE`.

### 8.3 Question palette
A grid of numbered buttons. States (never color alone):

| State | How it looks |
|---|---|
| Current | Strong outline + `aria-current="true"` |
| Answered | Check mark / filled style (response is non-empty) |
| Unanswered | Plain outline |
| Marked for review | Flag icon (can combine with answered) |

Each button has an accessible name like "Question 5, answered, marked for review". Position (left / right / bottom) follows the preference; on narrow screens it collapses into a drawer.

### 8.4 Answer inputs
- **MCQ:** radio group.
- **MULTI:** checkbox group with the hint "Select all that apply".
- **WRITTEN:** textarea with a character counter (limit 20000, matching the server).
- Every change dispatches `ANSWER_CHANGED` and writes to the outbox (section 10). Clearing an answer sends an empty `optionIds` / `text`.

### 8.5 Timer
Display derived from the **server** clock estimate (section 10.2): `remaining = expiresAtMs - estimatedServerNow()`.
- Warnings at 10, 5 and 1 minute: a visual change plus a single polite `aria-live` announcement (not every second).
- At 0: `phase` -> `LOCKED` (inputs disabled), **flush the outbox first, then call submit**. If offline, keep retrying flush + submit while the server reports `inGrace: true` (about 2 minutes). After the grace window, show "Your attempt was finalized with the answers saved before time ran out."
- A note under the timer while offline: "The timer keeps running while you are offline."
- The server decides expiry; the client timer can never extend it.

### 8.6 Keyboard
| Key | Action |
|---|---|
| Right arrow / `N` | Next question |
| Left arrow / `P` | Previous question |
| `F` | Toggle mark for review |
| `1`-`9` | Choose / toggle the Nth option |
| `S` | Toggle scratchpad |
| `?` | Show shortcut help |

Shortcuts are ignored while typing in a textarea or input. A help popover documents them.

### 8.7 Review and submit
A dialog/screen summarizing answered / unanswered / flagged counts and listing unanswered and flagged questions as links that jump back. Submit confirmation calls `POST /api/attempts/:id/submit`; the button is disabled while submitting (double clicks are harmless because the endpoint is idempotent). Afterwards show a "Submitted" state with a link back to the dashboard.

### 8.8 Leaving the page
`beforeunload` warning while `phase` is `LIVE`. A refresh restores everything (section 10.5).

---

## 9. Customizable workspace (feature 4.7)

Preference object (saved with `PUT /api/me/preferences`, also mirrored in `localStorage` key `examsys.prefs` so it applies instantly on load and offline):

| Key | Values | Effect |
|---|---|---|
| `theme` | `light`, `dark`, `contrast` | Sets `data-theme` on `<html>` |
| `fontSize` | `S`, `M`, `L`, `XL` | Sets the base font size variable |
| `density` | `comfortable`, `compact` | Sets spacing variables |
| `palettePosition` | `left`, `right`, `bottom` | Moves the question palette in the workspace grid |

Apply changes live from a gear-icon panel. Unknown keys are rejected by the API. (Optional stretch: a question-list vs single-question view would add one more key and one Zod change; no database change.)

---

## 10. Offline resilience and autosave (innovation 5.3 and feature 4.1)

Code lives in `lib/offline/*` (Member 3). The server-side rules it must respect are in `00_SHARED_CONTRACT.md` section 7 and api.md section 11.3.

### 10.1 IndexedDB layout (`idb`)
Database `examsys-offline`, version 1:

| Store | Key | Value |
|---|---|---|
| `outbox` | `[attemptId, questionId]` | `{ attemptId, questionId, response, flagged, seq, elapsedMs, updatedAt }` |
| `scratchpad` | `attemptId` | `{ text, drawing?, updatedAt }` |

The outbox keeps only the **latest** unsent change per question (a newer change overwrites an older one); because the server accepts only a higher `seq`, older intermediate values never matter. The next `seq` after a reload is `max(server seq from GET attempt, outbox seq) + 1`.

### 10.2 Clock calibration
The server sends `serverNow` on `GET attempt`, autosave and heartbeat responses.
- On each response record an anchor: `serverMsAtAnchor = Date.parse(serverNow)`, `perfAtAnchor = performance.now()` (optionally adjusted by half the round-trip time).
- `estimatedServerNow() = serverMsAtAnchor + (performance.now() - perfAtAnchor)`.
- Timer: `remaining = expiresAtMs - estimatedServerNow()`.
- `elapsedMs` for outbox items: `estimatedServerNow() - startedAtMs`.

Using `performance.now()` means changing the device clock mid-exam does not change the timer or `elapsedMs`. (The simple form in the member brief, `Date.now() + serverOffset`, is equivalent when the system clock is not touched; use the anchored form.)

### 10.3 Sync engine
```
onAnswerChanged(question, response, flagged):
    seq[question] += 1
    item = { attemptId, questionId, response, flagged, seq: seq[question], elapsedMs }
    await outbox.put(item)                    // device first
    setSync("saving"); scheduleFlush(AUTOSAVE_DEBOUNCE_MS = 500)

flush():
    if already flushing: mark "dirty" and return
    items = outbox.getAll(attemptId)  (max 100)
    if none: setSync("saved", lastSavedAt = now); return
    try:
        res = PUT /api/attempts/:id/answers { items }
        recalibrate clock from res.serverNow; update expiresAt from res.expiresAt
        for each result:
            saved or ignored_stale  -> delete from outbox IF the stored seq equals the seq that was sent
            rejected_late / rejected_invalid -> delete (permanent) and notify the candidate
        backoff = reset; if outbox still has items, flush again
    catch network error or 5xx:
        setSync(connection offline ? "offline" : "retrying", pending = outbox size)
        retry after backoff: 1s, 2s, 5s, 10s, then every 15s (cap)
```
The "delete only if seq matches" rule prevents deleting a newer change the candidate made while the request was in flight. Flush also runs immediately on the `online` event and when the tab becomes visible again.

### 10.4 Save status chip and connection banner
| Chip state | Text | Shown when |
|---|---|---|
| `saved` | "Saved" + "Last saved 12:03:41" | outbox empty |
| `saving` | "Saving..." | a request is in flight or debounce pending |
| `offline` | "Offline - answers kept on this device and will sync" | no connectivity |
| `retrying` | "Retrying (n pending)" | failures but possibly online |
| `failed` | "Sync failed - tell the invigilator" | continuous failure for over 60 seconds |

Connection state combines `navigator.onLine`, the latest heartbeat and the latest autosave result (do not trust `navigator.onLine` alone): **offline** if the browser reports offline or two consecutive requests failed; **unstable** after one recent failure or a response slower than 3 seconds; otherwise **online**. The heartbeat (`POST /heartbeat` every 15 s) also delivers announcements; the client sends `sinceAnnouncementAt` so none are missed.

### 10.5 Refresh / crash resume
On load: `GET /api/attempts/:id`; read the outbox for that attempt; for each question, use the outbox value when its `seq` is higher than the server's; restore the current question index (from `localStorage` key `examsys.pos.<attemptId>`), flags, scratchpad, and the remaining time from `expiresAt`; then flush. If the attempt is already finalized, show the "Submitted" state.

### 10.6 One writable tab per attempt
Two tabs that both increment `seq` would collide (the server would ignore the second tab's equal `seq`). Use the Web Locks API (`navigator.locks.request("attempt-" + id, { ifAvailable: true }, ...)`): the tab that gets the lock is writable; any other tab shows "This exam is open in another tab" in read-only mode.

### 10.7 Test matrix (run manually before the demo)
1. Airplane mode mid-answer, keep answering, reconnect: answers appear on the server, no loss.
2. Refresh while offline: answers, flags, scratchpad and remaining time restored.
3. Close and reopen the tab mid-exam.
4. Reconnect after expiry within the grace window: accepted, with an explanation; after the window: finalized with answers saved before expiry.
5. Change the device clock mid-exam: timer and `elapsedMs` are unaffected.
6. Open the attempt in two tabs: only one is writable.
7. Double-click Submit and spam keys: no duplicates, no errors.

---

## 11. Digital scratchpad (feature 4.8)
A collapsible drawer (toggle with `S`) containing a text area for rough work, optionally with a simple freehand canvas tab. It is **per attempt**, autosaved to IndexedDB (`scratchpad` store) every few seconds and on close, restored on refresh, **never sent to the server or graders**, and has a "Clear" button with confirmation.

---

## 12. Integrity signals (innovation 5.1, privacy-preserving)
The workspace reports only these events via `POST /api/attempts/:id/incidents`, throttled client-side as well as server-side:
- `TAB_HIDDEN` (with duration), `FULLSCREEN_EXIT` (only if fullscreen is offered as optional), `PASTE` / `COPY` in the answer area.

No screenshots, keystroke logging, camera or microphone. The instructions page tells the candidate exactly what is recorded; the examiner UI presents these as indicators for review. In **sandbox** mode the workspace does not send incidents.

---

## 13. Results (candidate)
`/results/[attemptId]` calls `GET /api/candidate/results/:attemptId`. Show: score, percentage, pass/fail, per-question marks, a topic breakdown chart, a "Download PDF" button (`/api/reports/:attemptId/pdf`) and the verification code. A `403` (not published) shows "Awaiting results"; a `404` shows a not-found state. No scores are shown before publication.

---

## 14. Examiner and admin UI patterns (Member 2)

| Screen | Pattern |
|---|---|
| Lists (users, exams, questions) | Filter bar + table + pagination (`page`, `pageSize`); phase/status badges; row actions |
| Create/edit forms | react-hook-form + shared Zod schema; map API `fields` errors to inputs; disable submit while saving |
| Exam review before publish | Summary of settings, question list with marks, total marks check, enrolled count, confirm dialog; show `details.problems` if the API refuses |
| Question picker | Dialog with filters and multi-select, per-exam marks input, reorder (drag or arrow buttons) |
| Bulk import | Drop file -> `dryRun=true` preview table with per-row status -> confirm -> summary ("38 imported, 2 failed") with downloadable error report and (for candidates) generated-credentials CSV; sample template downloads |
| Monitor tab | Poll every 4 s; status counters, attempts table with progress bars and "last seen" indicator, incident feed, announcement composer. Copy must state: "Incidents are indicators for review, not proof of misconduct." |
| Grading tab | Queue from `/grading/queue`, side-by-side question + answer + marks input (validated against the maximum), "Save and next", progress "14 / 20 graded" |
| Results tab | Scores table; "Publish results" shows blockers from the API's `details.blockers` |
| Analytics tab | Stat cards + Recharts histogram; question table with `observedDifficulty` vs declared and highlighted `LOW_CORRECT` / `HIGH_SKIPPED` flags |
| Reports | "Download PDF" buttons (per candidate and exam level); public `/verify/[code]` page showing valid/invalid, exam title, issue date, masked name, pass/fail band |

### Sandbox reuse
The "Preview as candidate" button calls `POST /api/exams/:id/attempts` with `{ "sandbox": true }` and opens `/examiner/exams/[id]/sandbox/[attemptId]`, which renders `<ExamWorkspace mode="sandbox" />` - the same component as the live exam, with a persistent "SANDBOX - not recorded" banner and incident reporting turned off. Because the attempt is flagged `isSandbox` on the server, it never affects results or statistics.

---

## 15. Forms and validation
- Schemas live in `lib/validation/*` and are shared with the API; the client validates for convenience and the server remains authoritative.
- Show inline, specific messages; keep the user's input on failure; focus the first invalid field.
- Server `VALIDATION_ERROR.fields` are mapped back to form fields.

---

## 16. Loading, empty and error states
Every data view defines all three: skeletons while loading, an `EmptyState` with a next action, and an `ErrorState` with a retry. Route-level `error.tsx` and `not-found.tsx` exist for each route group. Every mutation gives toast feedback.

---

## 17. Accessibility checklist
- All interactive elements reachable and operable by keyboard; visible focus ring.
- Contrast 4.5:1 or better in all three themes; status never conveyed by color alone.
- Labelled inputs, semantic landmarks, skip link, meaningful page titles.
- Timer announcements limited to 10 / 5 / 1 minute marks via a polite live region.
- `prefers-reduced-motion` respected; no essential information in animation.
- Usable at 200% zoom and at 360 px width.
- Run Lighthouse accessibility on login, dashboard and workspace; fix findings.

---

## 18. Responsive behavior
Breakpoints to verify: 360 px (phone), 768 px (tablet), 1280 px (desktop). On narrow screens the sidebar becomes a drawer, the question palette becomes a drawer, tables scroll horizontally or collapse to cards, and the exam workspace remains fully usable.

---

## 19. Performance notes
- Keep the exam workspace bundle lean (load Recharts and PDF-related code only on examiner pages).
- Debounce and batch autosave; avoid re-rendering the whole question list on each keystroke (memoize palette buttons).
- Skeletons instead of blocking spinners.

---

## 20. Definition of done (frontend)
- A candidate can log in, see exams, read instructions, take the exam with flag / skip / review, submit, and see published results.
- Pulling the network never loses an answer; refresh restores everything; the timer never gains time.
- The save chip and connection banner always reflect reality.
- Preferences and scratchpad survive refresh.
- Keyboard-only use works; contrast and responsive checks pass.
- The UI looks designed: consistent tokens, hierarchy and spacing.
