import { z } from "zod";

/** Shared by the admin users API and the /admin/users forms. */

export const ROLES = ["ADMIN", "EXAMINER", "CANDIDATE"] as const;

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const nameSchema = z.string().trim().min(2, "Name must be at least 2 characters").max(100);
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address"));
export const rollNoSchema = z
  .string()
  .trim()
  .max(50)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(ROLES, "Choose a role"),
  password: passwordSchema,
  rollNo: rollNoSchema,
});
export type CreateUserInput = z.input<typeof createUserSchema>;

/** PATCH /api/users/:id - every field optional; `password` = admin reset. */
export const updateUserSchema = z
  .object({
    name: nameSchema,
    role: z.enum(ROLES, "Choose a role"),
    active: z.boolean(),
    password: passwordSchema,
    rollNo: rollNoSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const listUsersQuerySchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  role: z.enum(ROLES).optional(),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;

/** The only user fields any API may return (never passwordHash). */
export type UserDto = {
  id: string;
  name: string;
  email: string;
  role: (typeof ROLES)[number];
  active: boolean;
  rollNo: string | null;
  createdAt: string;
};
