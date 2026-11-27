"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Top navigation for examiner and admin screens (Member 2). Plain Tailwind until
 * Member 3's app shell lands; the links shown depend on the signed-in role.
 */

type Me = { user: { name: string; role: "ADMIN" | "EXAMINER" | "CANDIDATE" } };

const LINKS = [
  { href: "/examiner/exams", label: "Exams", roles: ["ADMIN", "EXAMINER"] },
  { href: "/examiner/questions", label: "Question bank", roles: ["ADMIN", "EXAMINER"] },
  { href: "/admin/users", label: "Users", roles: ["ADMIN"] },
] as const;

/** Same height as the nav, shown while it loads, so the page doesn't jump. */
export function StaffNavFallback() {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex h-[57px] w-full max-w-6xl items-center px-4">
        <span className="font-semibold">ExamSys</span>
      </div>
    </header>
  );
}

export function StaffNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me["user"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((res) => (res.ok ? (res.json() as Promise<Me>) : null))
      .then((body) => {
        if (!cancelled && body) setMe(body.user);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  const links = LINKS.filter((link) => !me || (link.roles as readonly string[]).includes(me.role));

  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3" aria-label="Main">
        <span className="font-semibold">ExamSys</span>
        <ul className="flex flex-wrap gap-1 text-sm">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 ${
                    active ? "bg-blue-600 text-white" : "hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {me && (
            <span className="opacity-70">
              {me.name} · {me.role.charAt(0) + me.role.slice(1).toLowerCase()}
            </span>
          )}
          <button onClick={() => void logout()} className="rounded-md border border-black/15 px-3 py-1.5 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">
            Log out
          </button>
        </div>
      </nav>
    </header>
  );
}
