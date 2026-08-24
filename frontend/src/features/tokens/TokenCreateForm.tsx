import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import { API_TOKEN_SCOPES, type ApiTokenCreated, type ApiTokenScope } from "@/api/types";
import { apiTokenPayloadSchema } from "@/lib/api-token-schema";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

const SCOPE_HINTS: Record<ApiTokenScope, string> = {
  read: "View data through GET requests.",
  log: "Create and update data — logging workouts, meals, sleep, and more.",
  admin: "Full access, including managing other tokens.",
};

export function TokenCreateForm() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>(["read", "log"]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (payload: { name: string; scopes: ApiTokenScope[] }) =>
      apiFetch<ApiTokenCreated>("/tokens", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      toast.success(`Created "${created.name}"`);
      void navigate("/tokens", { state: { newToken: created.token } });
    },
    onError: (err: unknown) => toast.error(`Failed to create token: ${errorMessage(err)}`),
  });

  function toggleScope(scope: ApiTokenScope) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  }

  function submit() {
    const payload = { name: name.trim(), scopes };
    const result = apiTokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        nextErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(nextErrors);
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  return (
    <section id="token-form-view">
      <PageHeading>New API Token</PageHeading>

      <Card className="flex flex-col gap-4 p-4">
        <div>
          <label className="field-label" htmlFor="token-name">
            Name
          </label>
          <Input
            id="token-name"
            placeholder="e.g. MCP agent"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name ? <p className="mt-1 text-sm text-danger">{errors.name}</p> : null}
        </div>

        <fieldset>
          <legend className="field-label">Scopes</legend>
          <div className="flex flex-col gap-2">
            {API_TOKEN_SCOPES.map((scope) => (
              <label key={scope} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                />
                <span>
                  <span className="font-medium">{scope}</span>
                  <span className="text-muted"> — {SCOPE_HINTS[scope]}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.scopes ? <p className="mt-1 text-sm text-danger">{errors.scopes}</p> : null}
        </fieldset>
      </Card>

      <div className="mt-5 flex gap-2">
        <Button
          id="save-token-btn"
          variant="primary"
          disabled={mutation.isPending}
          onClick={submit}
        >
          Create token
        </Button>
        <Button onClick={() => void navigate("/tokens")}>Cancel</Button>
      </div>
    </section>
  );
}
