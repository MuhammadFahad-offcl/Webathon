"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { loginSchema } from "@/lib/validation/auth";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";
import { ExamIllustration } from "@/frontend/marketing/exam-illustration";
import { ExamSysBrand } from "@/frontend/marketing/brand";

const roleDestinations: Record<"ADMIN" | "EXAMINER" | "CANDIDATE", string> = {
  ADMIN: "/admin/users",
  EXAMINER: "/examiner/exams",
  CANDIDATE: "/dashboard",
};

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
      const result = await apiFetch<{ user: { role: keyof typeof roleDestinations } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      router.replace(roleDestinations[result.user.role]);
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
    <main className="auth-page">
      <section className="auth-story" aria-label="About ExamSys">
        <ExamSysBrand className="auth-brand" />
        <div className="auth-story-copy">
          <p className="auth-eyebrow">A secure examination system</p>
          <h1>Welcome back.<br /><span>Your next exam starts here.</span></h1>
          <p className="auth-story-description">
            A calmer, fairer way to learn and assess. Your instructions and
            progress stay organized, so you can focus on the work.
          </p>
        </div>
        <ExamIllustration variant="auth" />
        <div className="auth-story-benefits">
          <span><b aria-hidden="true">✓</b> Secure &amp; reliable</span>
          <span><b aria-hidden="true">↗</b> Easy access</span>
          <span><b aria-hidden="true">▥</b> Track progress</span>
        </div>
      </section>

      <section className="auth-panel" aria-label="Sign in to ExamSys">
        <div className="auth-panel-toolbar">
          <Link href="/" className="auth-back-link"><span aria-hidden="true">←</span> Back to home</Link>
          <span className="auth-secure-note"><span aria-hidden="true">●</span> Secure sign in</span>
        </div>
        <div className="auth-card">
          <div className="auth-card-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
              <path d="m3 14 17-9 17 9-17 9L3 14Z" fill="currentColor" />
              <path d="m10 18 10 5 10-5v8c-5.8 5-14.2 5-20 0v-8Z" fill="currentColor" opacity=".8" />
              <path d="M36 15v11" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
              <circle cx="36" cy="29" r="2" fill="currentColor" />
            </svg>
          </div>
          <p className="auth-card-eyebrow">Welcome back</p>
          <h2>Sign in to ExamSys</h2>
          <p className="auth-card-description">Use the account provided by your institution.</p>

          <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
            {formError && (
              <p className="auth-form-error" role="alert">
                {formError}
              </p>
            )}
            <label className="auth-label" htmlFor="login-email">
              Email address
              <Input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@institution.edu"
                value={email}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "login-email-error" : undefined}
                onChange={(event) => setEmail(event.target.value)}
                className="auth-input"
              />
              {errors.email && <span className="auth-field-error" id="login-email-error">{errors.email}</span>}
            </label>
            <label className="auth-label" htmlFor="login-password">
              Password
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Enter your password"
                value={password}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "login-password-error" : undefined}
                onChange={(event) => setPassword(event.target.value)}
                className="auth-input"
              />
              {errors.password && <span className="auth-field-error" id="login-password-error">{errors.password}</span>}
            </label>
            <Button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"} <span aria-hidden="true">→</span>
            </Button>
          </form>

          <div className="auth-divider"><span>Institution account</span></div>
          <p className="auth-account-note">
            Need an account? Contact your institution&apos;s ExamSys administrator.
          </p>
        </div>
        <p className="auth-panel-footer">Protected access for candidates, examiners, and administrators.</p>
      </section>
    </main>
  );
}
