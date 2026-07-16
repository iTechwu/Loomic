# Runtime And Data Plane

## Scope

This document describes the implementation currently assembled by
`apps/server/src/app.ts`, `apps/server/src/worker.ts`, and the server-owned
PostgreSQL migrations. It is the reference for local setup and production
operations.

## Components

| Component | Responsibility | Backing service |
| --- | --- | --- |
| Next.js web app | Browser UI, OIDC callback handoff, REST and WebSocket client | `apps/web` |
| Fastify API | Authentication, workspace APIs, agent runs, uploads, and model discovery | `apps/server/src/app.ts` |
| PostgreSQL | Product metadata, chat, skills, brand kits, job records, and LangGraph state | `DATABASE_URL` |
| TOS | Original and generated binary objects | `TOS_*` |
| RabbitMQ worker | Image and video job consumption | `RABBITMQ_URL` |
| SSO | OIDC authorization, token exchange, refresh, and bearer token verification | `SSO_*`, `JWKS_URI` |

The API refuses to start without `DATABASE_URL` and a complete TOS
configuration. The worker additionally requires `RABBITMQ_URL`.

## Identity And Access

1. `GET /api/auth/oidc/start` creates PKCE state and nonce, stores them in a
   short-lived HttpOnly cookie, then redirects to the configured SSO issuer.
2. `POST /api/auth/oidc/exchange` validates the state, exchanges the code,
   verifies the ID token with JWKS, and returns the short-lived access token.
3. A refresh token, when issued, stays in an HttpOnly cookie scoped to the OIDC
   endpoints. Browser JavaScript never receives it.
4. Protected REST and WebSocket handlers validate bearer JWTs against the SSO
   issuer, audience, and JWKS.
5. `sso_user_mappings` binds the SSO subject to the product profile ID. A
   one-time unique email match preserves existing profile ownership; later
   requests use the durable subject mapping.

`ensureViewer` creates the personal workspace and membership on the first
authenticated request. Authorization queries use `workspace_members`, rather
than trusting browser-supplied workspace identifiers.

## Persistent Data

The ordered migrations in `apps/server/migrations/` are applied with:

```bash
pnpm --filter @lovart.dofe/server db:migrate
```

The migrator creates `app_schema_migrations`, hashes each file, and rejects a
changed migration that has already been applied. Add a new numbered migration
for every schema change; do not edit an applied migration.

Core product tables include `profiles`, `workspaces`, `workspace_members`,
`projects`, `canvases`, and `asset_objects`. Brand-kit data lives in
`brand_kits` and `brand_kit_assets`; marketplace and installed skills live in
`skills`, `skill_files`, and `workspace_skills`. LangGraph checkpointers and
stores share the same PostgreSQL connection string.

TOS objects are represented by metadata rows and are accessed through the
server-only adapter. Browser downloads use short-lived signed read URLs; object
credentials and internal endpoints must not be exposed through `NEXT_PUBLIC_*`.

## Asynchronous Generation

The API creates durable job records in PostgreSQL and publishes image or video
work to RabbitMQ when `RABBITMQ_URL` is configured. Workers consume
`image_generation_jobs` and `video_generation_jobs`, update job state, retry
retryable failures, and move exhausted or non-retryable work to a dead-letter
state. RabbitMQ delivery is at-least-once, so an executor must treat a job ID as
an idempotency key.

## Operational Checks

```bash
pnpm --filter @lovart.dofe/server db:migrate
pnpm --filter @lovart.dofe/server dev:server
pnpm --filter @lovart.dofe/server dev:worker
pnpm typecheck
pnpm test
```

Use the server logs for `oidc_*`, `sso-identity`, `database-migrate`, and
worker events when diagnosing authentication, persistence, or job failures.
