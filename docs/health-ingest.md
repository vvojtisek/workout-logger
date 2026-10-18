# Health ingest recipe: HC Webhook, Tasker, HTTP Shortcuts

`POST /api/v1/ingest/health-connect` takes a whole Health Connect batch from the HC Webhook
app, and `POST /api/v1/ingest/{weight|steps|sleep|sessions}` take one record each. Together
they let an Android automation app push data from Health Connect (or any other tracker) into
this server without a companion app. A dedicated Kotlin companion app stays deferred: these
apps cover the same ground with no extra code to maintain.

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

## Recipe: Galaxy Watch / Samsung Health via HC Webhook (recommended)

This is the supported path for sleep, steps and exercise sessions. Samsung Health writes the
watch's data into Health Connect on the phone; the
[HC Webhook](https://github.com/mcnaveen/health-connect-webhook) app reads Health Connect and
POSTs it here. `POST /api/v1/ingest/health-connect` takes that app's JSON body as-is.

On the phone:

1. Samsung Health → Settings → Health Connect: allow Samsung Health to **write** steps, sleep
   and exercise to Health Connect.
2. In this app, Settings → Tokens: create a token with the **`log`** scope only.
3. Install HC Webhook (Google Play, "Health Connect Webhook" by Naveen MC). Grant it Health
   Connect **read** access to Steps, Sleep and Exercise only. Leave every other type off: the
   endpoint ignores them and they only make each request larger.
4. Add a webhook:
   - URL: `https://your-host/api/v1/ingest/health-connect?timezone=Europe/Prague`
     (your IANA zone; it decides which local day steps and workouts land on).
   - Delivery format: JSON.
   - Custom header: `X-API-Key: wl_...` (the token from step 2).
5. Set the steps **sample resolution to daily**. Raw and N-minute buckets are sent
   incrementally, so this endpoint cannot rebuild a day's total from them.
6. Turn on interval or scheduled sync and tap **Test**. The response body counts what was
   created, updated, unchanged, merged into a hand-logged entry, or skipped, per type.

What the endpoint does with each record:

| Payload key | Stored as | Matching |
|---|---|---|
| `steps` | one `step_counts` row per local day | A record starting at local midnight sets the day's total; a later partial-day record only raises it. |
| `sleep` | a sleep entry (time in bed, asleep and awake seconds from the stages) | Same start time: no-op or update. Otherwise an entry overlapping the session absorbs it: the watch's times and stage totals replace the entry's, and its quality rating and notes stay. |
| `exercise` | a finished workout or activity | Same start time: no-op or update. Otherwise a log of the same kind on the same local day (hockey, swim, ride, strength...) is treated as the same session and keeps everything a person entered; only a missing distance is filled in. A new log gets feeling 3 ("OK"), the in-app form's default, because the watch has no rating. |

Exercise types map ice hockey → `ice_hockey`, pool and open-water swimming → `swimming`,
biking → `cycling`, hiking → `hiking`, running → `running`, strength training, weightlifting
and calisthenics → a strength workout, and anything else → `other`. Walks (auto-detected all
day, already in the step total), guided breathing and sessions under a minute are skipped.

The whole request is one transaction: a record that fails validation rejects the batch with
`422` and nothing is written, so the app retries it on its next sync.

## Health Sync

[Health Sync](https://healthsync.app/about/) copies data between health apps (Samsung Health,
Health Connect, Google Fit, Strava, ...) and can export Health Connect data to CSV files on
Google Drive. Its published destination list has no custom HTTP or webhook target, so it
cannot post to this server by itself. It is useful only upstream, for example to copy data into
Health Connect from an app that does not write there itself.

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
