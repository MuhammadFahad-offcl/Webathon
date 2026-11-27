import { z } from "zod";
export const startSchema = z.object({ sandbox: z.boolean().optional() }).strict();
export const saveSchema = z.object({ items: z.array(z.object({ questionId: z.string().min(1), response: z.unknown(), flagged: z.boolean(), seq: z.number().int().min(1), elapsedMs: z.number().nonnegative() }).strict()).min(1).max(100) }).strict();
export const heartbeatSchema = z.object({ sinceAnnouncementAt: z.iso.datetime().optional() }).strict();
export const incidentSchema = z.object({ type: z.enum(["TAB_HIDDEN", "FULLSCREEN_EXIT", "PASTE", "COPY", "OTHER"]), meta: z.record(z.string(), z.unknown()).optional() }).strict();
