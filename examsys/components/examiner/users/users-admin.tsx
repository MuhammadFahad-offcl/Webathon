"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { ROLES, type UserDto } from "@/lib/validation/users";
import { UserDialog, inputClass, primaryButton, secondaryButton } from "./user-dialog";

type ListResponse = { items: UserDto[]; page: number; pageSize: number; total: number; totalPages: number };

const PAGE_SIZE = 20;

const roleBadge: Record<UserDto["role"], string> = {
  ADMIN: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  EXAMINER: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  CANDIDATE: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

export function UsersAdmin() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; user: UserDto | null }>({ open: false, user: null });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (role) params.set("role", role);
    if (status) params.set("active", status);
    return params.toString();
  }, [page, debouncedSearch, role, status]);
  const requestKey = `${query}#${reloadKey}`;
  const loading = settledKey !== requestKey;
  const load = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ListResponse>(`/api/users?${query}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load users");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function toggleActive(user: UserDto) {
    try {
      await apiFetch(`/api/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ active: !user.active }) });
      setToast(`${user.name} ${user.active ? "deactivated" : "activated"}`);
      load();
    } catch (err) {
      setToast(err instanceof ApiClientError ? err.message : "Update failed");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm opacity-70">Create accounts, change roles and deactivate access.</p>
        </div>
        <button className={primaryButton} onClick={() => setDialog({ open: true, user: null })}>
          + New user
        </button>
      </header>

      <div className="flex flex-wrap gap-3" role="search">
        <input
          className={`${inputClass} min-w-60 flex-1`}
          placeholder="Search name, email or roll no."
          aria-label="Search users"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={inputClass}
          aria-label="Filter by role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.charAt(0) + r.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
          <button className="underline" onClick={() => load()}>
            Retry
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
        <table className="w-full min-w-160 text-left text-sm">
          <thead className="bg-black/3 text-xs uppercase tracking-wide opacity-80 dark:bg-white/5">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Roll no.</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {data?.items.map((user) => (
              <tr key={user.id} className="border-t border-black/5 dark:border-white/10">
                <td className="px-4 py-3 font-medium">{user.name}</td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge[user.role]}`}>{user.role}</span>
                </td>
                <td className="px-4 py-3">{user.rollNo ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={user.active ? "text-green-700 dark:text-green-400" : "text-gray-500"}>
                    {user.active ? "● Active" : "○ Inactive"}
                  </span>
                </td>
                <td className="space-x-2 px-4 py-3 text-right whitespace-nowrap">
                  <button className="text-blue-600 hover:underline" onClick={() => setDialog({ open: true, user })}>
                    Edit
                  </button>
                  <button className="text-blue-600 hover:underline" onClick={() => void toggleActive(user)}>
                    {user.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center opacity-60">
                  No users match these filters.
                </td>
              </tr>
            )}
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center opacity-60">
                  Loading users…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="opacity-70">
            {data.total} user{data.total === 1 ? "" : "s"} · page {data.page} of {data.totalPages}
          </span>
          <div className="flex gap-2">
            <button className={secondaryButton} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button className={secondaryButton} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </nav>
      )}

      <UserDialog
        open={dialog.open}
        user={dialog.user}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSaved={(user) => {
          setDialog({ open: false, user: null });
          setToast(dialog.user ? `Saved ${user.name}` : `Created ${user.name}`);
          load();
        }}
      />

      {toast && (
        <div role="status" className="fixed right-4 bottom-4 rounded-md bg-gray-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
