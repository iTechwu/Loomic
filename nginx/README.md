# Local HTTPS

This production-like local configuration serves the built Next static export at
`https://lovart.local.dofe.ai` and proxies Fastify, including WebSocket upgrades,
to `127.0.0.1:3105`. Browser requests to `/api/*` therefore remain same-origin.

1. Add this hostname to `/etc/hosts`:

   ```bash
   printf '127.0.0.1 lovart.local.dofe.ai\n' | sudo tee -a /etc/hosts
   ```

2. Create a trusted local certificate:

   ```bash
   mkcert -install
   mkcert -cert-file nginx/certs/lovart.local.dofe.ai.pem -key-file nginx/certs/lovart.local.dofe.ai-key.pem lovart.local.dofe.ai
   ```

3. Set the application origins, build Web, and start Fastify:

   ```bash
   pnpm --filter @lovart.dofe/web build
   pnpm --filter @lovart.dofe/server dev:server
   ```

   ```dotenv
   # apps/web/.env.local
   NEXT_PUBLIC_SERVER_BASE_URL=https://lovart.local.dofe.ai

   # .env.local
   LOVART_DOFE_SERVER_PORT=3105
   LOVART_DOFE_WEB_ORIGIN=https://lovart.local.dofe.ai
   ```

4. Link `nginx/lovart.local.dofe.ai.conf` into the Nginx servers directory, then validate and reload Nginx:

   ```bash
   sudo ln -sf "$PWD/nginx/lovart.local.dofe.ai.conf" /opt/homebrew/etc/nginx/servers/lovart.local.dofe.ai.conf
   sudo nginx -t
   sudo nginx -s reload
   ```

5. Verify the trusted, same-origin browser entry without disabling TLS checks:

   ```bash
   E2E_SSO_ORIGIN=https://sso.ixicai.cn pnpm run verify:same-origin-runtime
   ```

For visual/axe gates, install the Playwright Chromium binary once, then run
`pnpm --filter @lovart.dofe/web exec playwright install chromium` and
`pnpm --filter @lovart.dofe/web test:e2e`. The HTTPS OIDC browser checks need
a browser that trusts the local CA, so enable them explicitly with
`E2E_BASE_URL=https://lovart.local.dofe.ai E2E_SAME_ORIGIN=1 pnpm --filter @lovart.dofe/web test:e2e`.
The credentialed test remains skipped until explicitly configured non-production
SSO test-account selectors and credentials are supplied through the environment.

The site configuration uses this workspace's absolute path. Update its `root`, `ssl_certificate`, and `ssl_certificate_key` directives if the repository moves.

## Container deployment

`deploy/docker-compose.yml` versions the deployable same-origin topology: the
Web Nginx service is the only browser-facing service and proxies `/api` and
`/api/ws` to private Fastify; the worker has no browser port. Copy
`deploy/.env.production.example` to an untracked secret file containing the
required values from `.env.example`, then run:

```bash
LOVART_ENV_FILE=.env.production docker compose -f deploy/docker-compose.yml up -d --build
```

Terminate TLS at the platform ingress in front of port `8080`, preserve the
public host, and never publish Fastify port `3105`. The bundled runtime config
sets CSP, HSTS, frame, referrer, permission and MIME-sniffing protections.
