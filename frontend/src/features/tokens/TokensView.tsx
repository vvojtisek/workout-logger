import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { ApiToken, Paginated } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, Card, EmptyState, PageHeading } from "@/ui";

function formatScopes(scopes: ApiToken["scopes"]): string {
  return scopes.join(" + ");
}

export function TokensView() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);

  const newToken = (location.state as { newToken?: string } | null)?.newToken ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paginated<ApiToken>>("/tokens?limit=100");
      setTokens(data.items);
      setError(null);
    } catch (err) {
      setError(`Failed to load tokens: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function dismissNewToken() {
    void navigate(".", { replace: true, state: null });
  }

  async function revokeToken(token: ApiToken) {
    try {
      await apiFetch(`/tokens/${token.id}/revoke`, { method: "POST" });
      toast.success(`Revoked "${token.name}"`);
      void load();
    } catch (err) {
      toast.error(`Failed to revoke: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="tokens-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Scoped credentials for other clients (an MCP agent, an automation) alongside your bootstrap API key.">
          API Tokens
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate("/tokens/new")}>
          New token
        </Button>
      </div>

      {newToken ? (
        <div id="new-token-reveal">
          <Card className="mb-5 p-4">
            <p className="font-medium">Save this token now</p>
            <p className="mt-1 text-sm text-muted">
              This is the only time the full secret is shown. It cannot be recovered later.
            </p>
            <code className="mt-3 block break-all rounded-md bg-surface-raised p-3 text-sm">
              {newToken}
            </code>
            <Button className="mt-3" variant="primary" onClick={dismissNewToken}>
              I've saved it
            </Button>
          </Card>
        </div>
      ) : null}

      <ul id="tokens-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && tokens.length === 0 ? (
          <li>
            <EmptyState
              title="No API tokens yet"
              description="Tap 'New token' to mint a scoped credential."
            />
          </li>
        ) : null}
        {tokens.map((token) => (
          <li key={token.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium">
                {token.name}
                {token.revoked_at ? <span className="ml-2 text-sm text-danger">revoked</span> : null}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {formatScopes(token.scopes)} · {token.token_prefix}…
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {token.last_used_at
                  ? `Last used ${new Date(token.last_used_at).toLocaleString()}`
                  : "Never used"}
              </p>
            </div>
            {!token.revoked_at ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setRevokeTarget(token)}>
                  Revoke
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget) void revokeToken(revokeTarget);
        }}
        title="Revoke API token"
        message={`Are you sure you want to revoke "${revokeTarget?.name}"? Any client using it will immediately lose access.`}
        confirmLabel="Revoke"
      />
    </section>
  );
}
