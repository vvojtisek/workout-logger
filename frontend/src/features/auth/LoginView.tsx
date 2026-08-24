import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { apiFetch, errorMessage } from "@/api/client";
import type { CurrentUser } from "@/api/types";
import { loginPayloadSchema } from "@/lib/auth-schema";
import { Button, Card, Input, PageHeading } from "@/ui";

export function LoginView() {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const redirectTo = (location.state as { from?: string } | null)?.from || "/";

  const mutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      apiFetch<CurrentUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      await refresh();
      void navigate(redirectTo, { replace: true });
    },
    onError: (err: unknown) => setFormError(errorMessage(err)),
  });

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = { email: email.trim(), password };
    const result = loginPayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        nextErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setFormError("");
    mutation.mutate(payload);
  }

  return (
    <section id="login-view" className="mx-auto max-w-sm px-4 pt-16">
      <PageHeading>Log in</PageHeading>
      <Card className="p-4">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="field-label" htmlFor="login-email">
              Email
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {errors.email ? <p className="mt-1 text-sm text-danger">{errors.email}</p> : null}
          </div>
          <div>
            <label className="field-label" htmlFor="login-password">
              Password
            </label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {errors.password ? (
              <p className="mt-1 text-sm text-danger">{errors.password}</p>
            ) : null}
          </div>
          {formError ? (
            <p id="login-error" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            Log in
          </Button>
        </form>
      </Card>
    </section>
  );
}
