# Project Docs - Secure Examination Management System

Web-e-Thon, Technoverse 5.0 (COMSATS University Lahore, 27-28 Nov 2026). Team of 3, 10-hour build.

| File | Who reads it |
|---|---|
| [00_SHARED_CONTRACT.md](00_SHARED_CONTRACT.md) | Everyone: stack, setup, folder ownership, API contract, grading rules, innovation rules, timeline |
| [01_MEMBER1_Backend_Core.md](01_MEMBER1_Backend_Core.md) | Member 1: auth, exam engine, grading, results, deployment |
| [02_MEMBER2_Examiner_Admin.md](02_MEMBER2_Examiner_Admin.md) | Member 2: admin/examiner features, import, monitoring, analytics, PDF, sandbox |
| [03_MEMBER3_Candidate_UI_Innovation.md](03_MEMBER3_Candidate_UI_Innovation.md) | Member 3: design system, candidate workspace, offline-resilient autosave |
| [architecture.md](architecture.md) | Layers, folder structure, auth/authorization model, constants, decisions, deployment, testing |
| [api.md](api.md) | Full API reference: every endpoint, request/response, errors, rules |
| [database.md](database.md) | ER diagram, data dictionary, constraints, transactions, scoring and analytics definitions |
| [frontend.md](frontend.md) | Routes, design system, exam workspace, offline/autosave module, accessibility |
| [systemdesign.md](systemdesign.md) | Requirements traceability, flows, state machines, concurrency, failure modes, security, scaling |
| [schema.prisma](schema.prisma) | Database schema (Prisma 6). Copy to `prisma/schema.prisma` in the app |

## Doc updates, 27 Nov 2026 (all members please read)

| Change | Affects | Details |
|---|---|---|
| Late sync now checks `elapsedMs <= expiresAt - startedAt`, not the exam duration (a late starter could otherwise have answers written after expiry accepted) | M1, M3 | Contract section 7 |
| Attempt endpoints must allow the examiner's own sandbox attempt, not only `CANDIDATE` | M1, M2 | Contract section 4 |
| Folder ownership completed: `answers`, `candidates`, `verify` and `attempts/[id]/review` are M2; `candidate` and `proxy.ts` are M1 | M1, M2 | Contract section 3 |
| Setup creates the app at the repo root; `proxy.ts` replaces `middleware.ts` (Next.js 16); no `tailwind.config` (Tailwind 4) | Everyone | Contract section 2 |

Note: pin Prisma to v6 (`npm i prisma@6 @prisma/client@6`); the latest npm tag is v8 (RC) and rejects `url`/`directUrl` in the schema file.
