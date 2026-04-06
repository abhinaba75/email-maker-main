# Alias Forge 2000

Cloudflare Worker mail console with:

- Google sign-in
- per-user encrypted Cloudflare and Resend credentials
- multi-domain mailbox management
- alias + catch-all routing with forwarding
- inbound storage in D1/R2
- outbound sending via Resend
- Windows 2000 / Outlook Express style UI

## Local setup

1. Install dependencies: `npm install`
2. Copy [`.dev.vars.example`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/.dev.vars.example) to `.dev.vars` and fill the Firebase runtime values plus `ALLOWED_ORIGINS` for local development.
3. Review [`wrangler.jsonc`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/wrangler.jsonc) and replace the account-specific bindings if you are deploying to a different Cloudflare account.
4. Add the Worker secret `APP_ENCRYPTION_KEY` with `npx wrangler secret put APP_ENCRYPTION_KEY`.
5. Apply the schema from [`schema.sql`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/schema.sql) to D1.
6. Run `npm run dev` or `npx wrangler deploy`.

## Notes

- The app verifies Firebase ID tokens on the Worker before any protected API call.
- Firebase web config is delivered through Worker environment vars and is intentionally exposed to the browser. All protected API routes still verify Firebase ID tokens on the Worker.
- Cloudflare Email Routing rules preserve forwarding and route inbox delivery directly into the Email Worker.
- Configure `ALLOWED_ORIGINS` so only your Cloudflare production origin and local development origins can call the Worker API cross-origin.
