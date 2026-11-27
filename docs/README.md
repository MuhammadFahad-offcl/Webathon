# Project Docs - Secure Examination Management System

Web-e-Thon, Technoverse 5.0 (COMSATS University Lahore, 27-28 Nov 2026). Team of 3, 10-hour build.

| File | Who reads it |
|---|---|
| [00_SHARED_CONTRACT.md](00_SHARED_CONTRACT.md) | Everyone: stack, setup, folder ownership, API contract, grading rules, innovation rules, timeline |
| [01_MEMBER1_Backend_Core.md](01_MEMBER1_Backend_Core.md) | Member 1: auth, exam engine, grading, results, deployment |
| [02_MEMBER2_Examiner_Admin.md](02_MEMBER2_Examiner_Admin.md) | Member 2: admin/examiner features, import, monitoring, analytics, PDF, sandbox |
| [03_MEMBER3_Candidate_UI_Innovation.md](03_MEMBER3_Candidate_UI_Innovation.md) | Member 3: design system, candidate workspace, offline-resilient autosave |
| [schema.prisma](schema.prisma) | Database schema (Prisma 6). Copy to `prisma/schema.prisma` in the app |

Note: pin Prisma to v6 (`npm i prisma@6 @prisma/client@6`); the latest npm tag is v8 (RC) and rejects `url`/`directUrl` in the schema file.
