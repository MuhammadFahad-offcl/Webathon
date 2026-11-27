# Member 3 - Candidate Experience, UI/UX & Innovation (front end)

**You decide how the project feels in the demo.** UI/UX is 20 marks, and the spec explicitly penalizes "generic, template-like or unrefined AI-generated interfaces." You also own the visible half of the innovation (failure-resilient exams), which judges will test live.

**Read first:** `00_SHARED_CONTRACT.md` (especially sections 6 and 7).
**Branch:** `m3-candidate`
**Your marks:** UI/UX (20), the candidate side of Core Functionality (30), four secondary features (network-aware UI, customizable workspace, scratchpad, plus your part of sandbox), and the frontend half of Innovation (15).

---

## You own

```
app/layout.tsx, globals.css, components/ui/*   design system + app shell (Tailwind 4: tokens in globals.css)
app/(auth)/*                   login page
app/(candidate)/*              dashboard, exam workspace, results
components/candidate/*         palette, timer, question card, status chip, scratchpad
lib/offline/*                  IndexedDB outbox, sync engine, clock calibration
app/api/me/preferences         save/load workspace preferences (uses M1's session)
```

## Deliverables

### Phase A - Design system & app shell (FIRST; target ~1:30 so M2 can reuse it)
- [ ] Pick a deliberate visual direction (do not ship shadcn defaults): choose a brand color + neutral palette, a type pair (e.g. a clean sans for UI + mono for timer/codes), spacing scale, radius, shadow rules. Define tokens as CSS variables in `globals.css`; support light + dark.
- [ ] Core components: Button, Input, Select, Dialog, Drawer, Table, Badge (status colors), Tabs, Toast, Skeleton, EmptyState, ErrorState, ProgressBar, Stat card.
- [ ] App shell: role-aware sidebar/topbar (Admin / Examiner / Candidate nav), user menu, responsive (mobile drawer), page header pattern (title + actions + breadcrumbs).
- [ ] Login page: clean, shows validation errors, loading state, and (for demo convenience) a small "Demo accounts" helper listing the seeded credentials.
- [ ] Accessibility baseline: visible focus rings, color contrast >= 4.5:1, semantic landmarks (`header/nav/main`), labels on all inputs, skip link, `prefers-reduced-motion` respected.
- [ ] Share a short `components/README` (or Storybook-like demo page `/_design`) so M2 knows what to use. Message the team when merged to `main`.

### Phase B - Candidate dashboard (3.4)
- [ ] Uses `GET /api/candidate/exams` (mock until M1 ships). Three clear sections: **Available now**, **Upcoming**, **Completed**.
- [ ] Each card: title, schedule, duration, total marks, instructions preview, **access status** ("Opens in 2h 10m" countdown, "Open now - Start", "Submitted", "Result published - View"). Disabled button with reason when not available.
- [ ] Exam detail/instructions screen before starting: full instructions, rules summary (autosave, timer, offline behavior, what is monitored - be transparent about privacy), a confirm checkbox, "Start exam" button.
- [ ] Empty states and error states for every list.

### Phase C - Exam workspace (3.5) - the centerpiece
Route: `/exam/[attemptId]` (client component; keep it reducer-driven with `useReducer`/Zustand).
- [ ] Load via `GET /api/attempts/:id`; store `serverOffset = serverNow - Date.now()`; **timer = expiresAt - (Date.now() + serverOffset)** and recalibrate on every API response (autosave, heartbeat). Display only - the server enforces expiry.
- [ ] Layout: header (exam title, timer, save status chip, Submit), main question pane, **question palette** (grid of numbers) showing states: answered / unanswered / marked-for-review / current (use color **and** shape/icon, not color alone), previous/next buttons, "Mark for review" toggle, marks shown per question.
- [ ] Inputs: MCQ radio group, MULTI checkbox group (state "select all that apply"), WRITTEN textarea with character count.
- [ ] Keyboard: arrow keys / `N`/`P` for next/prev, `F` to flag, `1-9` to pick options (document in a help popover).
- [ ] **Review & submit screen:** counts (answered/unanswered/flagged), list of unanswered/flagged questions that jump back to the question, confirm dialog. Submit calls `POST /submit`, shows result state; handle repeats/double-clicks (disable + idempotent).
- [ ] Timer warnings at 10/5/1 min (visual + one polite `aria-live` announcement, not every second). At 0: lock inputs, **flush the outbox first, then** call submit, show "Time's up - your answers up to now were saved." If offline at 0, keep retrying the flush + submit until the server's grace window (2 min, `inGrace: true` in `GET attempt`) ends; after that show "Your attempt was finalized with the answers saved before time ran out."
- [ ] Show **announcements** from examiner as a dismissible banner/toast (from heartbeat/attempt payload).
- [ ] Block accidental exits: `beforeunload` warning while in progress.

### Phase D - Autosave + Network-aware UI (4.1) + Innovation 5.3 front end
Implement `lib/offline` exactly per contract section 7.
- [ ] **Outbox:** on every answer/flag change -> write `{attemptId, questionId, response, flagged, seq, elapsedMs}` to IndexedDB **first**, then try to send (debounce ~500 ms, batch items). `seq` is a per-question counter that increases on every change. `elapsedMs` = time since attempt start measured with the calibrated server clock (`performance.now()` based so changing the system clock doesn't help).
- [ ] **Sync engine:** send via `PUT /api/attempts/:id/answers`; on `saved`/`ignored_stale` remove from outbox; on network error keep and retry with exponential backoff (1s -> 2s -> 5s -> 10s, cap 15s); on `rejected_late` or `rejected_invalid` drop the item from the outbox (permanent failure) and show a clear message; flush immediately on `online` event and on tab visibility return.
- [ ] **Status chip** (always visible): `Saved` ✓, `Saving...`, `Offline - answers kept on this device, will sync`, `Retrying (n pending)`, `Sync failed - tell the invigilator` (after long failure). Include timestamp "Last saved 12:03:41".
- [ ] **Connectivity detection:** don't trust only `navigator.onLine`; combine it with heartbeat success/failure (`POST /heartbeat` every ~15 s). Banner states: Online / Unstable (slow or failing intermittently) / Offline. Heartbeat sends `sinceAnnouncementAt` (newest announcement seen) and shows any new announcements.
- [ ] **Refresh / crash resume:** on load, fetch server state, merge any unsent outbox items on top (higher `seq` wins), restore current question index, flags, scratchpad, and the remaining time from the server.
- [ ] **Never give extra time:** timer always derives from server `expiresAt`; show a small note when offline: "The timer keeps running while you are offline."
- [ ] Test matrix (do it manually before the demo): airplane mode mid-answer; refresh while offline; close tab and reopen; reconnect after expiry (should be accepted only within grace window and show an explanation); two tabs open on the same attempt (second tab shows "This exam is open in another tab" or just stays consistent via seq).

### Phase E - Customizable workspace (4.7) & Digital scratchpad (4.8)
- [ ] Preferences panel (gear icon): **layout** (palette on left / right / bottom; stored as `palettePosition`), **font size** (S/M/L/XL), **theme** (stored as `light` / `dark` / `contrast`, where `contrast` is the high-contrast theme), **density** (comfortable/compact), optionally question-list vs single-question view. Apply live.
- [ ] Persist via `GET/PUT /api/me/preferences` (JSON in `UserPreference`) plus a localStorage fallback so it applies instantly on load, even offline.
- [ ] **Scratchpad:** a collapsible side panel/drawer with a text area (rough work) and optionally a simple freehand canvas tab; per-attempt, autosaved locally (IndexedDB) every few seconds and restored on refresh; never sent to the grader; clear button with confirm. Keyboard shortcut to toggle (`S`).

### Phase F - Light integrity signals (5.1 - supports monitoring)
- [ ] Listen for `visibilitychange` (tab hidden), `fullscreenchange` exit (if you offer fullscreen as optional/encouraged, not mandatory), `paste`/`copy` in the answer area. Send `POST /incidents` (throttled, include only type + short duration/count - **no screenshots, no keystroke logging, no webcam**).
- [ ] Be transparent: instructions screen states exactly what is logged and that these are indicators reviewed by a human, not automatic penalties. This is the "without compromising privacy" part of the challenge.

### Phase G - Results (candidate side)
- [ ] `/results/[attemptId]`: visible only if published (handle the 403/404 gracefully): total score, percentage, pass/fail band, per-question marks, topic breakdown chart, "Download PDF report" (M2's endpoint) and the verification code/QR shown on the report.
- [ ] Completed exams without published results show "Awaiting results" (no scores leaked).

### Phase H - Polish (last 90 minutes)
- [ ] Responsive pass at 360 px, 768 px, 1280 px (exam workspace must remain usable on a phone/tablet: collapse palette into a drawer).
- [ ] Consistent loading skeletons, empty states, error boundaries (`error.tsx`, `not-found.tsx`), toast feedback for every action.
- [ ] Micro-interactions that help (not decorate): palette state transitions, save-chip transitions, subtle focus/hover states.
- [ ] Run Lighthouse accessibility check on login, dashboard, workspace; fix issues. Test with keyboard only and with browser zoom 200%.

## Suggested schedule
| Time | Work |
|---|---|
| 0:45-1:30 | Phase A (design system, shell, login) - merge to `main` early |
| 1:30-3:00 | Phase B + workspace skeleton against mock data (copy the contract JSON) |
| 3:00-5:30 | Phase C + D (workspace, autosave, outbox) -> **integration checkpoint** |
| 5:30-7:00 | Phase D tests, Phase E |
| 7:00-8:00 | Phase F + G |
| 8:00-10:00 | Phase H, cross-browser check, bug bash, demo rehearsal |

## Mocking tip
Until M1's endpoints exist, create `lib/mock/` with the exact JSON shapes from the contract and a `NEXT_PUBLIC_USE_MOCK=true` switch in your fetch wrapper. Switch it off at the integration checkpoint.

## Interfaces
- **From M1:** attempt/answers/heartbeat/incidents/results endpoints, seeded open exam and candidate accounts.
- **From M2:** PDF download endpoint, announcements (already via M1 payload).
- **To M2:** design system components and a reusable `<ExamWorkspace mode="live|sandbox" />` component (sandbox: shows banner, sends to a sandbox attempt, same code path).

## Definition of done
- A candidate can: log in -> see available/upcoming/completed -> read instructions -> take the exam -> flag/skip/review -> submit -> view published results.
- Pulling the network mid-exam never loses an answer; refresh restores everything; the timer never gains time.
- Status chip always tells the truth about saving.
- Preferences and scratchpad survive refresh.
- Passes keyboard-only use, 4.5:1 contrast, works at phone width.
- UI looks designed (consistent tokens, hierarchy, spacing), not template-default.

## Demo talking points (yours)
Offline-first outbox and why server time wins, honest status feedback, privacy-respecting integrity signals, accessibility choices (not color-only states, keyboard shortcuts, reduced motion), design decisions.
