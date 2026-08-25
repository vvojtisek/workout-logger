import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { CurrentUser } from "@/api/types";
import { acceptInvitePayloadSchema } from "@/lib/auth-schema";
import { Button, Card, Input, PageHeading } from "@/ui";

export function AcceptInviteView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: { token: string; password: string }) =>
      apiFetch<CurrentUser>("/auth/invites/accept", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onError: (err: unknown) => setFormError(errorMessage(err)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = acceptInvitePayloadSchema.safeParse({ token, password, confirmPassword });
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
    mutation.mutate({ token, password });
  }

  if (!token) {
    return (
      <section id="accept-invite-view" className="mx-auto max-w-sm px-4 pt-16">
        <PageHeading>Accept invite</PageHeading>
        <Card className="p-4">
          <p className="text-sm text-danger">
            This link is missing its invite token. Ask whoever invited you for a fresh link.
          </p>
        </Card>
      </section>
    );
  }

  if (mutation.isSuccess) {
    return (
      <section id="accept-invite-view" className="mx-auto max-w-sm px-4 pt-16">
        <PageHeading>Account created</PageHeading>
        <Card className="p-4">
          <p className="mb-3 text-sm">
            Your account for <span className="font-medium">{mutation.data.email}</span> is ready.
          </p>
          <Button variant="primary" onClick={() => void navigate("/login")}>
            Log in
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section id="accept-invite-view" className="mx-auto max-w-sm px-4 pt-16">
      <PageHeading>Accept invite</PageHeading>
      <Card className="p-4">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="field-label" htmlFor="invite-password">
              Password
            </label>
            <Input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {errors.password ? (
              <p className="mt-1 text-sm text-danger">{errors.password}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="invite-confirm-password">
              Confirm password
            </label>
            <Input
              id="invite-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {errors.confirmPassword ? (
              <p className="mt-1 text-sm text-danger">{errors.confirmPassword}</p>
            ) : null}
          </div>
          {formError ? (
            <p id="accept-invite-error" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            Create account
          </Button>
        </form>
      </Card>
    </section>
  );
}
