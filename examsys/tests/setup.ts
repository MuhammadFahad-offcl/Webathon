import { existsSync } from "node:fs";

// Integration tests run against the Neon TEST branch in .env.test (never the demo DB).
// Unit tests (lib/**/*.test.ts) don't need it, so a missing file is only a warning.
if (existsSync(".env.test")) process.loadEnvFile(".env.test");
else console.warn("[tests] examsys/.env.test not found: integration tests will fail (see tests/README.md)");
