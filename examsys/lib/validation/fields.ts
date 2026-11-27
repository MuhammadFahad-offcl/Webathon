import type { ZodError } from "zod";

/** `{ field: "first message" }` for showing zod errors next to inputs. */
export function zodFieldMap(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    fields[key] ??= issue.message;
  }
  return fields;
}
