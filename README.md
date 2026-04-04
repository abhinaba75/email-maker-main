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
2. Review [`wrangler.jsonc`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/wrangler.jsonc) and replace the account-specific bindings if you are deploying to a different Cloudflare account.
3. Add the Worker secret `APP_ENCRYPTION_KEY`.
4. Apply the schema from [`schema.sql`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/schema.sql) to D1.
5. Run `npm run dev` or `npx wrangler deploy`.

## Notes

- The app verifies Firebase ID tokens on the Worker before any protected API call.
- Firebase web config is delivered through Worker environment vars and is safe to expose to the browser.
- Cloudflare Email Routing rules preserve forwarding and optionally add a generated ingest address for the in-app inbox.
- The inbound email handler expects the Worker to be configured on the ingest domain named by `INGEST_DOMAIN`.
