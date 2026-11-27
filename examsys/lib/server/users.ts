import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, conflict, notFound } from "@/lib/api/errors";
import type {
  ListUsersQuery,
  UserDto,
  createUserSchema,
  updateUserSchema,
} from "@/lib/validation/users";
import type { z } from "zod";

const BCRYPT_ROUNDS = 12;

export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  rollNo: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export function toUserDto(user: UserRow): UserDto {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

export async function listUsers(query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {};
  if (query.role) where.role = query.role;
  if (query.active) where.active = query.active === "true";
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
      { rollNo: { contains: query.search, mode: "insensitive" } },
    ];
  }
  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map(toUserDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

function isUniqueEmailError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const duplicateEmail = () =>
  new ApiError("CONFLICT", "A user with this email already exists", {
    email: "This email is already in use",
  });

export async function createUser(
  input: z.output<typeof createUserSchema>,
  actorId: string,
): Promise<UserDto> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        rollNo: input.rollNo ?? null,
        passwordHash,
      },
      select: userSelect,
    });
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "user.create",
        entity: "User",
        entityId: user.id,
        meta: { role: user.role },
      },
    });
    return toUserDto(user);
  } catch (error) {
    if (isUniqueEmailError(error)) throw duplicateEmail();
    throw error;
  }
}

/**
 * Updates a user. Safety rules (enforced here, never only in the UI):
 * - an admin cannot deactivate their own account;
 * - the last active admin cannot be demoted or deactivated.
 * The check and the write run in one SERIALIZABLE transaction, so two admins
 * demoting each other at the same moment cannot leave the system with none.
 */
export async function updateUser(
  id: string,
  input: z.output<typeof updateUserSchema>,
  actorId: string,
): Promise<UserDto> {
  const passwordHash = input.password
    ? await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    : undefined;

  return prisma.$transaction(
    async (tx) => {
      const current = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, active: true },
      });
      if (!current) throw notFound("User");

      if (id === actorId && input.active === false) {
        throw conflict("You cannot deactivate your own account");
      }

      const losesAdmin =
        current.role === Role.ADMIN &&
        current.active &&
        ((input.role !== undefined && input.role !== Role.ADMIN) || input.active === false);
      if (losesAdmin) {
        const otherActiveAdmins = await tx.user.count({
          where: { role: Role.ADMIN, active: true, id: { not: id } },
        });
        if (otherActiveAdmins === 0) {
          throw conflict("This is the last active admin. Make another user an admin first.");
        }
      }

      const user = await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          role: input.role,
          active: input.active,
          rollNo: input.rollNo,
          passwordHash,
        },
        select: userSelect,
      });

      const changed = Object.keys(input).filter((key) => key !== "password");
      await tx.auditLog.create({
        data: {
          actorId,
          action: input.password ? "user.update+password_reset" : "user.update",
          entity: "User",
          entityId: id,
          meta: { changed, ...(input.role ? { role: input.role } : {}) },
        },
      });
      return toUserDto(user);
    },
    // Prisma's default 5s limit is too tight on a slow link (~6 round trips here).
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 },
  );
}
