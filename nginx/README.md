# Local HTTPS

This development configuration proxies Next.js at `https://lovart.local.dofe.ai` to
`127.0.0.1:3005` and Fastify, including WebSocket upgrades, to `127.0.0.1:3105`.

1. Add this hostname to `/etc/hosts`:

   ```bash
   printf '127.0.0.1 lovart.local.dofe.ai\n' | sudo tee -a /etc/hosts
   ```

2. Create a trusted local certificate:

   ```bash
   mkcert -install
   mkcert -cert-file nginx/certs/lovart.local.dofe.ai.pem -key-file nginx/certs/lovart.local.dofe.ai-key.pem lovart.local.dofe.ai
   ```

3. Set the application origins and start the development services:

   ```bash
   pnpm dev
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

The site configuration uses this workspace's absolute path. Update its `root`, `ssl_certificate`, and `ssl_certificate_key` directives if the repository moves.
