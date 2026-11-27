import { Prisma } from "@prisma/client";

/**
 * The one definition of a "real" attempt (Member 2, PR 10).
 *
 * An examiner's "Preview as candidate" run is an ordinary Attempt row with `isSandbox: true`.
 * It must never show up in a count, list, statistic, lock rule, grading queue, monitor or
 * report. Every Member 2 query over attempts (or over rows reached through an attempt:
 * answers, incidents, attempt questions) spreads this scope instead of hand-writing the flag:
 *
 *   prisma.attempt.count({ where: { examId, ...REAL_ATTEMPT } })
 *   prisma.incident.findMany({ where: { attempt: { examId, ...REAL_ATTEMPT } } })
 *   _count: { select: { attempts: { where: REAL_ATTEMPT } } }
 *
 * Raw SQL uses `realAttemptSql("a")` for the same condition on an aliased "Attempt" table.
 */
export const REAL_ATTEMPT = { isSandbox: false } as const satisfies Prisma.AttemptWhereInput;

const SQL_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `<alias>."isSandbox" = false` for raw queries; `alias` is a hard-coded table alias, never user input. */
export function realAttemptSql(alias: string): Prisma.Sql {
  if (!SQL_ALIAS.test(alias)) throw new Error(`Invalid SQL alias: ${alias}`);
  return Prisma.raw(`"${alias}"."isSandbox" = false`);
}
