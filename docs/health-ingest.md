# Health ingest recipe: Health Sync, Tasker, HTTP Shortcuts

`POST /api/v1/ingest/{weight|steps|sleep|sessions}` lets an Android automation app push data
from Health Connect (or any other tracker) into this server without a companion app. This is
that recipe. A dedicated Kotlin companion app stays deferred — these three apps cover the same
ground with no extra code to maintain.

## How ingest works

- Auth is the same `X-API-Key` header as every other endpoint. Mint the automation app its own
  token at Settings → Tokens (or `POST /api/v1/tokens`) with the **`log`** scope — never hand it
  your `admin` phone key. See the API Tokens section of the main README.
- Every request carries `source` (a short slug you choose for the app, e.g. `"health_connect"`)
  and `external_id` (that record's id in the source app). The pair is unique per endpoint: a
  request replaying a `source`+`external_id` already ingested returns the **existing** row with
  `200 OK` and `"created": false` instead of creating a duplicate or erroring. A first-time
  request returns `201 Created` and `"created": true`. This is what makes a re-sync — after a
  missed run, a retried request, a device that resyncs its whole history — safe to fire blindly.
- Timestamps are ISO 8601 with an explicit UTC offset (`...Z` or `+00:00`); a naive timestamp is
  rejected with `422`.
- Responses are the same shape as the domain's own read model (`/api/v1/body-metrics/{id}`,
  `/api/v1/sleep-entries/{id}`, `/api/v1/logs/{id}`), plus the `created` flag. Ingested rows show
  up in the regular GUI views (Biometrics, Sleep, History) exactly like manually logged ones.

## Endpoints at a glance

| Endpoint | Target | Required fields |
|---|---|---|
| `POST /api/v1/ingest/weight` | a body-metrics entry | `measured_at`, `weight_kg`, `source`, `external_id` |
| `POST /api/v1/ingest/steps` | a daily step-count row | `recorded_date`, `steps`, `source`, `external_id` |
| `POST /api/v1/ingest/sleep` | a sleep entry | `sleep_start`, `sleep_end`, `timezone`, `source`, `external_id` |
| `POST /api/v1/ingest/sessions` | a completed workout log | `performed_at`, `total_time_minutes`, `overall_feeling`, `source`, `external_id` |

`weight` accepts every optional field `POST /api/v1/body-metrics` does (`body_fat_percent`,
`waist_cm`, ...); `sleep` accepts every optional field `POST /api/v1/sleep-entries` does
(`quality_score`, `resting_heart_rate`, ...); `sessions` accepts `exercises` the same way
`POST /api/v1/logs` does. Full field-level validation is in `app/schemas/ingest.py` and mirrors
the domain schema each one wraps — check `GET /docs` for the exact request/response bodies.

Example request:

```bash
curl -X POST https://your-host/api/v1/ingest/weight \
  -H "X-API-Key: wl_..." \
  -H "Content-Type: application/json" \
  -d '{
    "measured_at": "2026-08-23T07:00:00Z",
    "weight_kg": 78.2,
    "body_fat_percent": 18.5,
    "source": "health_connect",
    "external_id": "hc-record-abc123"
  }'
```

## Recipe: Health Sync

[Health Sync](https://www.healthsyncapp.com/) reads Health Connect and can push each record to a
custom REST endpoint via its "3rd Party App Sync" → "Custom API" option.

1. In Health Sync, add a Custom API target and set the base URL to
   `https://your-host/api/v1/ingest/weight` (repeat per data type you sync — Health Sync fires a
   separate request per record type, so weight, sleep, and step syncs each need their own
   target with the matching path).
2. Add a static header `X-API-Key: wl_...` (the `log`-scoped token minted above).
3. Set the request body template. Health Sync exposes the source record's own id as a
   placeholder — use it for `external_id` so a re-sync (Health Sync re-syncs its whole recent
   window on every run) stays idempotent:
   ```json
   {
     "measured_at": "{{startTime}}",
     "weight_kg": "{{weight}}",
     "source": "health_sync",
     "external_id": "{{uuid}}"
   }
   ```
   Field names in `{{...}}` come from Health Sync's own template variable list, which differs per
   data type (weight vs. sleep vs. steps) — check its Custom API documentation for the exact set
   available for that sync.
4. Enable the sync schedule. Health Sync retries failed pushes, which is exactly the case
   `external_id` idempotency exists for.

## Recipe: Tasker

Tasker can read Health Connect via its own plugin (or run on a timer/event) and fire an **HTTP
Request** action directly.

1. New Task → Add Action → Net → HTTP Request.
2. Method: `POST`. URL: `https://your-host/api/v1/ingest/sleep`.
3. Headers: `X-API-Key: wl_...` and `Content-Type: application/json`.
4. Body: build the JSON from Tasker variables, e.g.:
   ```json
   {
     "sleep_start": "%SLEEP_START",
     "sleep_end": "%SLEEP_END",
     "timezone": "%TIMEZONE",
     "source": "tasker",
     "external_id": "%SLEEP_START_EPOCH"
   }
   ```
   Using the source record's own start timestamp (or another stable value from it) as
   `external_id` is enough to dedupe — it does not need to be a real remote id, only stable and
   unique per record from Tasker's point of view.
5. Trigger the task from a Health Connect plugin event, or a daily time profile that reads the
   most recent record.

## Recipe: HTTP Shortcuts

[HTTP Shortcuts](https://http-shortcuts.rmy.ch/) is a good fit when you want a manual "sync now"
button, or a target for a Tasker task to call instead of building the request in Tasker itself.

1. Create a shortcut → Method `POST` → URL `https://your-host/api/v1/ingest/sessions`.
2. Request Headers: `X-API-Key: wl_...`.
3. Request Body → JSON, with variables for the fields that change per run:
   ```json
   {
     "performed_at": "{{performed_at}}",
     "total_time_minutes": {{total_time_minutes}},
     "overall_feeling": {{overall_feeling}},
     "source": "http_shortcuts",
     "external_id": "{{external_id}}"
   }
   ```
4. Define each `{{variable}}` as an HTTP Shortcuts variable (a text/number prompt, or one
   populated from another shortcut/Tasker via its variable-passing intent).
5. Add the shortcut to a home screen widget for one-tap logging, or trigger it from Tasker's
   "Run Shortcut" action so Tasker handles reading Health Connect and HTTP Shortcuts handles the
   request.

## Testing an integration

`GET /docs` (Swagger UI) lets you fire a real request with your token before wiring up any
automation app — useful for confirming field names and the `created: false` replay behavior work
the way you expect against a real deployment.
