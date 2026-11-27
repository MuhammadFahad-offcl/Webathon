import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listUsers, POST as createUser } from "@/app/api/users/route";
import { PATCH as updateUser } from "@/app/api/users/[id]/route";
import { prisma } from "@/lib/prisma";
import { actAs, call, cleanupTestData, makeUser, testEmail, TEST_DOMAIN } from "./helpers";

let admin: { id: string };
let examiner: { id: string };

beforeAll(async () => {
  await cleanupTestData();
  admin = await makeUser(Role.ADMIN, { name: "M2 Test Admin" });
  examiner = await makeUser(Role.EXAMINER);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe("access control", () => {
  it("rejects logged-out requests with 401", async () => {
    actAs(null);
    const res = await call(listUsers, { path: "/api/users" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects non-admins with 403 on every users endpoint", async () => {
    actAs(examiner.id);
    expect((await call(listUsers, { path: "/api/users" })).status).toBe(403);
    expect((await call(createUser, { method: "POST", body: {} })).status).toBe(403);
    const patch = await call(updateUser, {
      method: "PATCH",
      body: { role: "ADMIN" },
      params: { id: examiner.id },
    });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a deactivated admin immediately", async () => {
    const inactive = await makeUser(Role.ADMIN, { active: false });
    actAs(inactive.id);
    expect((await call(listUsers, { path: "/api/users" })).status).toBe(401);
  });
});

describe("create user", () => {
  it("creates a user, hashes the password and never returns the hash", async () => {
    actAs(admin.id);
    const email = testEmail("new");
    const res = await call(createUser, {
      method: "POST",
      body: { name: "New Candidate", email: email.toUpperCase(), role: "CANDIDATE", password: "Secret@123", rollNo: "R-1" },
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: "CANDIDATE", active: true, rollNo: "R-1" });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(stored.passwordHash).not.toBe("Secret@123");
    expect(await bcrypt.compare("Secret@123", stored.passwordHash)).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: "user.create", entityId: stored.id } });
    expect(audit?.actorId).toBe(admin.id);
  });

  it("returns 400 with per-field messages for invalid input", async () => {
    actAs(admin.id);
    const res = await call(createUser, {
      method: "POST",
      body: { name: "A", email: "not-an-email", role: "ROOT", password: "short" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["email", "name", "password", "role"]);
  });

  it("returns 400 for a body that is not JSON", async () => {
    actAs(admin.id);
    const res = await call(createUser, { method: "POST", body: "{oops" });
    expect(res.status).toBe(400);
  });

  it("returns a friendly 409 for a duplicate email", async () => {
    actAs(admin.id);
    const existing = await makeUser(Role.CANDIDATE);
    const res = await call(createUser, {
      method: "POST",
      body: { name: "Copy", email: existing.email, role: "CANDIDATE", password: "Secret@123" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "CONFLICT", fields: { email: expect.any(String) } });
  });
});

describe("list users", () => {
  it("filters by search, role and active, and paginates", async () => {
    actAs(admin.id);
    const tag = `zz${Date.now()}`;
    for (let i = 0; i < 3; i++) await makeUser(Role.CANDIDATE, { name: `${tag} cand ${i}` });
    await makeUser(Role.EXAMINER, { name: `${tag} exam` });
    await makeUser(Role.CANDIDATE, { name: `${tag} off`, active: false });

    const page1 = await call(listUsers, { path: `/api/users?search=${tag}&role=CANDIDATE&active=true&pageSize=2` });
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.items.every((u: { role: string }) => u.role === "CANDIDATE")).toBe(true);

    const page2 = await call(listUsers, { path: `/api/users?search=${tag}&role=CANDIDATE&active=true&pageSize=2&page=2` });
    expect(page2.body.items).toHaveLength(1);

    const all = await call(listUsers, { path: `/api/users?search=${tag}` });
    expect(all.body.total).toBe(5);
    expect(JSON.stringify(all.body)).not.toContain("passwordHash");
  });

  it("rejects an invalid role filter", async () => {
    actAs(admin.id);
    expect((await call(listUsers, { path: "/api/users?role=ROOT" })).status).toBe(400);
  });
});

describe("update user", () => {
  it("changes role, name and active flag", async () => {
    actAs(admin.id);
    const user = await makeUser(Role.CANDIDATE);
    const res = await call(updateUser, {
      method: "PATCH",
      body: { role: "EXAMINER", name: "Promoted", active: false },
      params: { id: user.id },
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: "EXAMINER", name: "Promoted", active: false });
  });

  it("resets a password", async () => {
    actAs(admin.id);
    const user = await makeUser(Role.CANDIDATE);
    const res = await call(updateUser, { method: "PATCH", body: { password: "Brand@New1" }, params: { id: user.id } });
    expect(res.status).toBe(200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("Brand@New1", stored.passwordHash)).toBe(true);
  });

  it("returns 404 for an unknown user and 400 for an empty body", async () => {
    actAs(admin.id);
    expect((await call(updateUser, { method: "PATCH", body: { name: "Nobody" }, params: { id: "missing" } })).status).toBe(404);
    expect((await call(updateUser, { method: "PATCH", body: {}, params: { id: admin.id } })).status).toBe(400);
  });

  it("does not let an admin deactivate their own account", async () => {
    actAs(admin.id);
    const res = await call(updateUser, { method: "PATCH", body: { active: false }, params: { id: admin.id } });
    expect(res.status).toBe(409);
  });

  it("allows demoting an admin while another active admin exists", async () => {
    actAs(admin.id);
    const other = await makeUser(Role.ADMIN);
    const res = await call(updateUser, { method: "PATCH", body: { role: "EXAMINER" }, params: { id: other.id } });
    expect(res.status).toBe(200);
  });

  it("blocks demoting or deactivating the last active admin", async () => {
    // Temporarily make our test admins the only active admins, then restore.
    const others = await prisma.user.findMany({
      where: { role: Role.ADMIN, active: true, NOT: { email: { endsWith: TEST_DOMAIN } } },
      select: { id: true },
    });
    const otherIds = others.map((user) => user.id);
    const second = await makeUser(Role.ADMIN);
    await prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { active: false } });
    await prisma.user.updateMany({
      where: { role: Role.ADMIN, active: true, email: { endsWith: TEST_DOMAIN }, id: { notIn: [admin.id, second.id] } },
      data: { active: false },
    });
    try {
      actAs(admin.id);
      // Two admins: demoting one is fine.
      expect((await call(updateUser, { method: "PATCH", body: { active: false }, params: { id: second.id } })).status).toBe(200);
      // Now `admin` is the last one; the other admin can't remove it either (re-activate second to act).
      await prisma.user.update({ where: { id: second.id }, data: { active: true, role: Role.EXAMINER } });
      const demote = await call(updateUser, { method: "PATCH", body: { role: "CANDIDATE" }, params: { id: admin.id } });
      expect(demote.status).toBe(409);
      expect(demote.body.error.message).toMatch(/last active admin/i);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe(Role.ADMIN);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { active: true } });
    }
  });
});
