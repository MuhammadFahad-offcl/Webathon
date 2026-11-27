# Integration tests (Member 2)

The tests call the real route handlers against a real Postgres database.

1. Create `examsys/.env.test` (git ignores it) with a **Neon test branch**, never the demo database:
   ```
   DATABASE_URL="<pooled connection string>&connect_timeout=30"
   DIRECT_URL="<direct connection string>&connect_timeout=30"
   SESSION_SECRET="test-only-secret"
   APP_URL="http://localhost:3000"
   ```
2. Apply migrations to it once: `npx dotenv -e .env.test -- prisma migrate deploy` (or set the two URLs in your shell and run `npx prisma migrate deploy`).
3. Run `npm test`.

Every row the tests create uses an email ending in `@m2test.local`, and `cleanupTestData()` removes only those rows. The one exception: the "last active admin" test briefly deactivates the other admins and reactivates them in a `finally` block.

Until Member 1's `lib/auth` lands, routes read the session from `lib/api/auth.ts`, a stand-in that is active only when `M2_DEV_AUTH=1` (the test setup sets it). `actAs(userId)` in `tests/helpers.ts` picks the user for the next calls.
