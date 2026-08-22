import { useState } from "react";
import type { FormEvent } from "react";

import { clearStoredApiKey, setStoredApiKey } from "@/api/client";
import { Button, Card, Input, PageHeading } from "@/ui";

export function SettingsView() {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    setStoredApiKey(value.trim());
    setValue("");
    setStatus("API key saved.");
  }

  function forget() {
    clearStoredApiKey();
    setValue("");
    setStatus("API key removed.");
  }

  return (
    <section id="settings-view">
      <PageHeading hint="Stored in this browser only and sent as the X-API-Key header.">
        API Key
      </PageHeading>
      <Card className="p-4">
        <form id="api-key-form" onSubmit={save} autoComplete="off" className="flex flex-col gap-3">
          <div>
            <label className="field-label" htmlFor="api-key-input">
              X-API-Key
            </label>
            <Input
              id="api-key-input"
              name="api-key"
              type="password"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              Save key
            </Button>
            <Button id="forget-api-key" onClick={forget}>
              Forget API key
            </Button>
          </div>
        </form>
        {status ? (
          <p id="api-key-status" className="mt-3 text-sm text-muted">
            {status}
          </p>
        ) : (
          <p id="api-key-status" className="mt-3 text-sm text-muted" />
        )}
      </Card>
    </section>
  );
}
