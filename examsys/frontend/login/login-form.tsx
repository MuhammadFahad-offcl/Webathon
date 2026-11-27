"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { loginSchema } from "@/lib/validation/auth";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";

const demoAccounts = [
  { role: "Administrator", email: "admin@exam.test", password: "Admin@123" },
  { role: "Examiner", email: "examiner@exam.test", password: "Exam@123" },
  { role: "Candidate", email: "candidate1@exam.test", password: "Cand@123" },
];

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !fieldErrors[field]) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<{ user: { role: string } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      router.replace("/");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError("Sign in failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-wrap">
      <section className="login-intro" aria-label="About ExamSys">
        <div className="flex items-center gap-3 font-bold tracking-wide">
          <span className="app-brand-mark" aria-hidden="true">EX</span>
          EXAMSYS
        </div>
        <div className="max-w-xl py-12">
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-emerald-200">Secure examination system</p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            A calmer, fairer way to take exams.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-emerald-50/85">
            Clear instructions, server-timed assessments, and reliable progress saving help everyone focus on the work.
          </p>
        </div>
        <p className="text-sm text-emerald-100/75">Built for students, examiners, and administrators.</p>
      </section>

      <section className="login-panel">
        <div className="login-card page-surface">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--brand)]">Welcome back</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">Sign in to ExamSys</h2>
            <p className="mt-2 text-sm text-muted">Use the account provided by your institution.</p>
          </div>

          <form className="login-form" onSubmit={(event) => void submit(event)} noValidate>
            {formError && (
              <p className="rounded-lg border border-[var(--danger)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">
                {formError}
              </p>
            )}
            <label className="form-label" htmlFor="login-email">
              Email address
              <Input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "login-email-error" : undefined}
                onChange={(event) => setEmail(event.target.value)}
              />
              {errors.email && <span className="text-sm text-[var(--danger)]" id="login-email-error">{errors.email}</span>}
            </label>
            <label className="form-label" htmlFor="login-password">
              Password
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "login-password-error" : undefined}
                onChange={(event) => setPassword(event.target.value)}
              />
              {errors.password && <span className="text-sm text-[var(--danger)]" id="login-password-error">{errors.password}</span>}
            </label>
            <Button className="mt-1 w-full" type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <details className="mt-7 border-t border-[var(--border)] pt-5">
            <summary className="cursor-pointer text-sm font-bold">Demo accounts</summary>
            <ul className="mt-3 grid gap-3 text-sm">
              {demoAccounts.map((account) => (
                <li key={account.email} className="rounded-lg bg-[var(--surface-2)] p-3">
                  <p className="font-bold">{account.role}</p>
                  <p className="mt-1 font-mono text-xs">{account.email}</p>
                  <p className="font-mono text-xs">{account.password}</p>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </section>
    </div>
  );
}
