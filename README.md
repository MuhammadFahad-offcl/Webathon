# ExamSys

ExamSys is a secure examination management system for educational institutions. It brings exam setup, candidate assessments, grading, and results into one role-based web application.

## The problem

Exams are often managed across disconnected tools and manual processes. This can make it harder to keep schedules and question sets consistent, protect assessment data, monitor exam progress, and recover work when a candidate's connection is interrupted.

## The solution

ExamSys provides a shared workflow for administrators, examiners, and candidates. The application enforces access and exam timing on the server, saves candidate work locally before syncing it, and keeps grading and result publication in the same system.

## What it does

- **Administrators** manage user accounts and oversee the system.
- **Examiners** create and publish exams, manage questions and enrollments, import CSV data, monitor attempts, grade written answers, and publish results.
- **Candidates** view their assigned exams, complete timed assessments, and view results after publication.
- **Resilient assessments** use server-controlled deadlines and a browser-side IndexedDB outbox to preserve answer changes when connectivity is interrupted.
- **Fair grading** supports multiple-choice, multi-select, and written questions, with objective scoring and examiner grading for written answers.
- **Reports and verification** provide PDF reports and public verification of published result records using minimal public data.
- **Personal workspace** preferences and an attempt-local scratchpad help candidates configure their exam experience.

Accounts are created by an institution administrator. The **Sign up** button on the landing page opens sign-in; public self-registration is not enabled.

## Technology stack

| Area | Technology |
| --- | --- |
| Web application | Next.js 16 App Router, React 19, TypeScript |
| API | Next.js Route Handlers |
| Database and ORM | PostgreSQL, Prisma 6 |
| Authentication | bcryptjs password hashing, signed sessions with `jose`, HTTP-only cookies |
| Validation | Zod schemas shared by browser forms and API handlers |
| UI | Tailwind CSS 4, custom responsive CSS, Recharts |
| Offline support | Browser IndexedDB for the answer outbox and scratchpad |
| Imports and reports | PapaParse for CSV, pdf-lib for PDFs, qrcode for report verification |
| Tests | Vitest, including database-independent unit tests and PostgreSQL integration tests |

## Run locally

Requirements: Node.js and npm, plus a PostgreSQL database.

1. Install dependencies:

   ```bash
   cd examsys
   npm ci
   ```

2. Create `examsys/.env` with the database connection details and a private session secret:

   ```dotenv
   DATABASE_URL="your pooled PostgreSQL connection string"
   DIRECT_URL="your direct PostgreSQL connection string"
   SESSION_SECRET="replace-with-a-random-secret-of-at-least-32-characters"
   APP_URL="http://localhost:3000"
   ```

   Use the pooled connection for `DATABASE_URL` and the direct connection for `DIRECT_URL` when using Neon. Never commit `.env` or use production credentials for tests.

3. Generate the Prisma client and apply the checked-in migrations:

   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Quality checks

Run these commands from `examsys/`:

```bash
npm run lint
npm run typecheck
npm run build
```

Database-independent unit tests:

```bash
npm exec vitest -- run lib --reporter=dot
```

The full `npm test` suite includes integration tests against a real PostgreSQL database. Configure a **separate test database** in `examsys/.env.test` before running it; do not point integration tests at a production or shared demo database. See [integration test setup](examsys/tests/README.md).

## Project layout

```text
docs/                  Product contract, architecture, API, database, and UI docs
examsys/
  app/                 Next.js pages, layouts, and API route handlers
  components/          Role-specific application components
  frontend/            Shared design system and candidate-facing UI modules
  lib/                 Authentication, services, validation, reports, and offline support
  prisma/              Prisma schema, migrations, and seed data
  tests/               PostgreSQL-backed API integration tests
```

## Documentation

- [Project documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [API reference](docs/api.md)
- [Database design](docs/database.md)
- [Frontend guide](docs/frontend.md)
- [Integration test setup](examsys/tests/README.md)

## Deployment

The application is designed to deploy as a Next.js app (for example, on Vercel) with PostgreSQL (for example, Neon). Set `examsys/` as the application root in the hosting project and configure `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, and `APP_URL` as server-side environment variables. Apply database migrations during deployment using the project's migration workflow.
