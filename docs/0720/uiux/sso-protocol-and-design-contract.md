# Lovart x DoFe SSO Protocol and Design Contract

**Status:** implemented baseline with explicitly tracked provider work  
**Owner:** `sso.dofe.ai` owns identity, login, account security and shared tokens; `lovart.dofe.ai` owns the relying-party callback, local session and product workspace.

This is the implementation contract for Lovart. It supersedes the earlier assumption that a local `/login` page or unverified CSS copy could represent the identity experience.

## 1. Authoritative OIDC Contract

| Item | Contract |
| --- | --- |
| Issuer / API base | `https://sso.ixicai.cn/api` in the deployed environment; resolve endpoints from `/.well-known/openid-configuration`. |
| Browser entry | Lovart sends the browser to same-origin `GET /api/auth/oidc/start`; Fastify creates `state`, nonce and S256 PKCE, then redirects to SSO `/oauth/authorize`. |
| Grant | Authorization Code with mandatory S256 PKCE. `state` is mandatory and unpredictable. |
| Scopes | Lovart requests only `openid profile email offline_access`. Tenant scope is not requested because tenant/team context comes from the authenticated internal SSO endpoint. |
| Token exchange | Lovart server uses `client_secret_basic`; no secret, refresh token or ID token reaches browser-readable storage. |
| Token validation | JWKS signature, issuer, audience and time claims are verified; initial ID Token validation includes the nonce. |
| Return path | Only a same-origin relative path passes both client and server validation. PKCE transaction stores it in an HttpOnly cookie; the callback uses `router.replace`. |
| Failure | Callback remains on `/auth/callback`, displays a support-safe request ID, and never redirects into a local login form. |

### Logout is two deliberate modes

| Mode | Trigger and result |
| --- | --- |
| Global SSO logout | Lovart stores the verified ID Token in `lovart_oidc_id`, an HttpOnly, Secure-in-production cookie scoped to `/api/auth/oidc/logout` for at most ten minutes, matching the SSO ID Token lifetime. Logout sends it as `id_token_hint` to SSO `/oauth/logout`, then returns to `/?signed_out=1`. |
| Local-only logout | Sessions established before that cookie exists still revoke their refresh token and clear Lovart state. Lovart does **not** navigate them to SSO's GET endpoint because SSO correctly refuses cookie-only global logout. |

`post_logout_redirect_uri` is an exact client registration, never an arbitrary destination. SSO only accepts the GET global logout request with a valid ID Token hint; the cookie-based SSO POST logout is first-party-only and must not be called by Lovart.

## 2. Client Registration

The SSO seed configuration now contains confidential client `lovart-dofe-ai-local` with only:

- `https://lovart.local.dofe.ai/auth/callback`
- `http://localhost:3005/auth/callback`
- `https://lovart.local.dofe.ai/?signed_out=1`
- `http://localhost:3005/?signed_out=1`

It needs `SSO_CLIENT_SECRET_LOVART_LOCAL` in the SSO seed environment. Production and staging must have their own client IDs, secrets, callback URI and signed-out URI; local credentials must not be reused outside local development.

## 3. UI/UX Ownership

| Surface | Owner | Rule |
| --- | --- | --- |
| Sign in, password, MFA, recovery and account security | SSO | SSO is the only account UI. Current policy permits login only and disables self-service registration. Lovart exposes its explicitly configured `/settings/security` entry and does not duplicate those controls. |
| Auth transition and callback error | Lovart | Neutral transfer status, no identity fields, accessible error/retry state and support request ID. |
| Workspace, canvas, projects and billing | Lovart | Product-specific density and interaction remain independent from SSO account screens. |
| Theme primitives and control semantics | SSO design system | Consumer applications consume a released, versioned token artifact rather than copying production CSS. |

### Existing SSO baseline

The provider's published `@dofe/design-tokens@0.1.0` package defines the semantic baseline: Geist Sans/Mono, `0.65rem` base radius, semantic `background`/`foreground`/`card`/`border`/`ring`, and teal primary tokens (`oklch(0.55 0.14 162)` light, `oklch(0.68 0.15 155)` dark). SSO UI and Lovart consume its CSS entry directly; neither uses a relative filesystem import.

### Required shared design artifact

`@dofe/design-tokens@0.1.0` provides a CSS entry and machine-readable manifest with semantic color roles, font families, control radius, light/dark values and a token version. Lovart maps its shadcn variables to those roles; canvas/media rendering remains exempt from product-chrome tokens.

The acceptance gate is a CI snapshot of the exported manifest used by both repositories, plus visual checks of SSO login, Lovart callback error and core workspace controls in light/dark and reduced-motion modes.

## 4. Locale and Theme

SSO now carries the space-delimited `ui_locales` request through its shared Zod contract and login route. It supports `zh-CN` and `en`, selecting the first supported candidate, and advertises that set from Discovery. Lovart may send only this allowlisted preference; theme remains a separate protocol and must not be invented as a query parameter.

## 5. Completion Matrix

| Item | State | Evidence |
| --- | --- | --- |
| Local login/register UI removed from normal flow | Done | Lovart route compatibility redirects to same-origin OIDC start. |
| PKCE, state, nonce and exact return path | Done | `apps/server/src/http/oidc-auth.ts` and unit tests. |
| Recoverable callback flows | Done | Public CTA cancellations retain their safe return path; a viewer bootstrap retry reuses the exchanged in-memory session instead of repeating SSO. |
| Expired workspace session feedback | Done | Refresh distinguishes an initial anonymous visit from expiry of an established session, and announces the SSO redirect state. |
| SSO refresh outage recovery | Done | Network, configuration and upstream failures are distinct from `401`; Lovart preserves an existing in-memory session or renders a retryable, support-safe service-unavailable state without an authorization loop. |
| Standards-compliant global logout | Done | Verified ID Token is HttpOnly; SSO receives `id_token_hint`. |
| Browser logout URL validation | Done | Lovart only follows an uncredentialed `/oauth/logout` URL whose registered post-logout redirect is the current origin's `/?signed_out=1`. |
| Lovart local SSO client source of truth | Done | `sso.dofe.ai/apps/api/scripts/oauth-clients.config.ts`. |
| Public SSO endpoint documentation | Done | SSO `api-reference/oidc.mdx` now uses `/oauth/*`. |
| Production/staging client registrations | Pending release operation | Register separate confidential clients and put their secrets in deployment secret stores. |
| Shared token package | Done | Lovart locks `@dofe/design-tokens@0.1.0`, imports its CSS entry, and its production build passes without local base-token overrides. |
| Locale handoff | Done | Lovart selects the first supported browser language and Fastify forwards only `zh-CN` or `en`; SSO e2e and Web regression tests cover both sides. |
| SSO account centre entry | Done | `NEXT_PUBLIC_SSO_ACCOUNT_URL` is validated before Lovart renders the Profile link. |
| Same-origin Fastify runtime | Done | `verify:same-origin-runtime` checks HTTPS health, legacy `/login` same-origin redirect and the configured provider origin with Node explicitly trusting the mkcert root. |
| Production visual and accessibility gate | Done | Playwright runs axe and committed visual baselines for Landing and callback service-unavailable state on Chromium desktop and Pixel 5 against the static export. |
| Auth-transfer measurement | Done in application code | Browser beacon emits only random flow ID, state, entry point and duration bucket; Fastify rejects unknown fields and logs `auth_transfer_viewed`. Dashboard retention and alerts remain an observability operation. |
| Cross-origin Lovart E2E | Pending trusted-browser validation | The credentialed test is versioned and requires explicit non-production account/selector variables. A real SSO login, local SAN certificate, Fastify and Nginx routes are ready, but the isolated test browser does not inherit the system mkcert trust root; validate login, refresh, global logout and invalid callback in a browser that trusts the local CA. |
| Lovart theme first frame | Done | ThemeProvider defaults to `system`, disables transition flashes, and preserves reduced-motion behavior. |
| Authorization log minimization | Done | SSO authorization logs retain only session source and outcome category, never a raw user ID or lookup error text. |
| Published token upgrade gate | Done | Web build validates the installed package version, manifest version and CSS entry before Next compiles. |
| PKCE return path budget | Done | Both browser and Fastify reject `returnTo` values over 2048 characters before writing the transaction cookie. |
| Callback loading accessibility | Done | Loading and error headings receive focus; a native `<output>` supplies the implicit named status live region. |
| Self-service registration | Intentionally unavailable | Lovart never passes a registration hint; SSO redirects its disabled registration route to login. |

## 6. Operational Checks

1. Confirm `GET /api/auth/oidc/start?returnTo=%2Fprojects` results in a provider authorization request with `state`, `nonce` and `code_challenge_method=S256`.
2. Verify the registered redirect URI exactly matches `SSO_REDIRECT_URI`, including scheme, host and path.
3. After signing in, verify the browser cannot read `lovart_oidc_refresh` or `lovart_oidc_id`.
4. On logout, confirm the SSO request has `id_token_hint` and returns to the registered `/?signed_out=1` URL.
5. On a legacy/no-ID-token session, confirm logout remains at Lovart public home and does not present the SSO login page.
6. For local browser E2E, ensure the certificate SAN covers `lovart.local.dofe.ai`, start Fastify, enable the Lovart Nginx virtual host and use a browser that trusts the local mkcert CA before opening the local OIDC start endpoint; do not disable TLS verification to compensate for a hostname mismatch.
7. Before credentialed E2E, set `E2E_SAME_ORIGIN=1` plus the explicit non-production account and selector variables; never put credentials in Playwright source, snapshots or logs.
8. Send `auth_transfer_viewed` to the approved log pipeline, then establish a seven-day baseline for callback failure and duration buckets before setting alert thresholds.
