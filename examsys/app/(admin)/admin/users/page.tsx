import type { Metadata } from "next";
import { UsersAdmin } from "@/components/examiner/users/users-admin";

export const metadata: Metadata = { title: "Users · Admin" };

// Access is enforced by the /api/users endpoints (ADMIN only). Page-level redirects
// arrive with Member 1's proxy.ts and session helpers.
export default function AdminUsersPage() {
  return <UsersAdmin />;
}
