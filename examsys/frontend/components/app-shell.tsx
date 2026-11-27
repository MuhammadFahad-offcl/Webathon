"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { Badge } from "@/frontend/components/ui/badge";

type Role = "ADMIN" | "EXAMINER" | "CANDIDATE";
type Props = {
  role: Role;
  children: React.ReactNode;
};
type UserInfo = {
  name: string;
  email: string;
  role: Role;
};
type NavigationItem = {
  href: string;
  label: string;
  icon: string;
};

const navigation: Record<Role, NavigationItem[]> = {
  ADMIN: [
    { href: "/admin/users", label: "User management", icon: "01" },
    { href: "/examiner/exams", label: "Exams", icon: "02" },
    { href: "/examiner/questions", label: "Question bank", icon: "03" },
  ],
  EXAMINER: [
    { href: "/examiner/exams", label: "Exams", icon: "01" },
    { href: "/examiner/questions", label: "Question bank", icon: "02" },
  ],
  CANDIDATE: [{ href: "/dashboard", label: "My exams", icon: "01" }],
};

const roleLabel: Record<Role, string> = {
  ADMIN: "Administrator",
  EXAMINER: "Examiner",
  CANDIDATE: "Candidate",
};

function NavigationLinks({ items }: Readonly<{ items: NavigationItem[] }>) {
  const pathname = usePathname();
  return (
    <nav className="app-nav" aria-label="Main navigation">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            className="app-nav-link"
            href={item.href}
            aria-current={active ? "page" : undefined}
          >
            <span className="font-mono text-xs opacity-70" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function NavigationFallback({ items }: Readonly<{ items: NavigationItem[] }>) {
  return (
    <nav className="app-nav" aria-label="Main navigation">
      {items.map((item) => (
        <Link key={item.href} className="app-nav-link" href={item.href}>
          <span className="font-mono text-xs opacity-70" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ role, children }: Readonly<Props>) {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ user: UserInfo }>("/api/me", { signal: controller.signal })
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiClientError && error.status === 401) {
          router.replace("/login");
          return;
        }
        setUserError("Account details could not be loaded.");
      });
    return () => controller.abort();
  }, [router]);

  async function signOut() {
    setSignOutError(null);
    setSigningOut(true);
    try {
      await apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setSignOutError(error instanceof ApiClientError ? error.message : "Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const items = navigation[role];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="app-sidebar" aria-label="ExamSys">
        <Link className="app-brand" href="/">
          <span className="app-brand-mark" aria-hidden="true">EX</span>
          <span>ExamSys</span>
        </Link>
        <Suspense fallback={<NavigationFallback items={items} />}>
          <NavigationLinks items={items} />
        </Suspense>
        <div className="app-sidebar-footer">
          <Badge tone="info">{roleLabel[role]}</Badge>
        </div>
      </aside>
      <div className="app-main-column">
        <header className="app-topbar">
          <details className="mobile-navigation">
            <summary aria-label="Open main navigation">
              <span className="app-brand-mark" aria-hidden="true">EX</span>
              <span>ExamSys</span>
            </summary>
            <Suspense fallback={<NavigationFallback items={items} />}>
              <NavigationLinks items={items} />
            </Suspense>
          </details>
          <div className="app-user">
            <p className="truncate text-sm font-bold">{user?.name ?? roleLabel[role]}</p>
            <p className="truncate text-xs text-muted" role={userError ? "status" : undefined}>
              {user?.email ?? userError ?? roleLabel[role]}
            </p>
          </div>
          <button
            className="button-secondary"
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </header>
        {signOutError && (
          <p className="mx-4 mt-4 rounded-lg border border-[var(--danger)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">
            {signOutError}
          </p>
        )}
        <main className="app-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
