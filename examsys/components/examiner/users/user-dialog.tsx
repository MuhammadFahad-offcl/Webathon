"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { zodFieldMap } from "@/lib/validation/fields";
import {
  ROLES,
  createUserSchema,
  updateUserSchema,
  type UserDto,
} from "@/lib/validation/users";

type Props = {
  /** null = create a new user */
  user: UserDto | null;
  open: boolean;
  onClose: () => void;
  onSaved: (user: UserDto) => void;
};

type FormState = {
  name: string;
  email: string;
  role: UserDto["role"];
  rollNo: string;
  active: boolean;
  password: string;
};

const empty: FormState = { name: "", email: "", role: "CANDIDATE", rollNo: "", active: true, password: "" };

export function UserDialog({ user, open, onClose, onSaved }: Readonly<Props>) {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isEdit = user !== null;
  const submitLabel = isEdit ? "Save changes" : "Create user";

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setForm(
        user
          ? { name: user.name, email: user.email, role: user.role, rollNo: user.rollNo ?? "", active: user.active, password: "" }
          : empty,
      );
      setErrors({});
      setFormError(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, user]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const { [key]: _removed, ...rest } = current; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    });
  };

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setFormError(null);

    let body: Record<string, unknown>;
    if (isEdit) {
      body = { name: form.name, role: form.role, active: form.active, rollNo: form.rollNo };
      if (form.password) body.password = form.password;
      const parsed = updateUserSchema.safeParse(body);
      if (!parsed.success) return setErrors(zodFieldMap(parsed.error));
    } else {
      body = { name: form.name, email: form.email, role: form.role, rollNo: form.rollNo, password: form.password };
      const parsed = createUserSchema.safeParse(body);
      if (!parsed.success) return setErrors(zodFieldMap(parsed.error));
    }

    setSaving(true);
    try {
      const result = await apiFetch<{ user: UserDto }>(isEdit ? `/api/users/${user.id}` : "/api/users", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved(result.user);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError("Something went wrong");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="user-dialog-title"
      className="m-auto w-full max-w-md rounded-xl border border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-6">
        <h2 id="user-dialog-title" className="text-lg font-semibold">
          {isEdit ? "Edit user" : "New user"}
        </h2>

        {formError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
            {formError}
          </p>
        )}

        <Field label="Full name" error={errors.name}>
          <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </Field>

        <Field label="Email" error={errors.email} hint={isEdit ? "Email can't be changed." : undefined}>
          <input
            className={inputClass}
            type="email"
            value={form.email}
            disabled={isEdit}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Role" error={errors.role}>
            <select className={inputClass} value={form.role} onChange={(e) => set("role", e.target.value as FormState["role"])}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role.charAt(0) + role.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Roll no. (optional)" error={errors.rollNo}>
            <input className={inputClass} value={form.rollNo} onChange={(e) => set("rollNo", e.target.value)} />
          </Field>
        </div>

        <Field
          label={isEdit ? "Reset password (optional)" : "Password"}
          error={errors.password}
          hint="At least 8 characters."
        >
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
            Account active
            {errors.active && <span className="text-red-600"> — {errors.active}</span>}
          </label>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={primaryButton}>
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: Readonly<{ label: string; error?: string; hint?: string; children: React.ReactNode }>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-red-600 dark:text-red-400">{error}</span> : hint && <span className="opacity-60">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 dark:border-white/20";
export const primaryButton =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60";
export const secondaryButton =
  "rounded-md border border-black/15 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";
