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
2. Create a D1 database and R2 bucket, then update [`wrangler.jsonc`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/wrangler.jsonc).
3. Add secrets:
   - `APP_ENCRYPTION_KEY`
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_APP_ID`
   - `FIREBASE_MESSAGING_SENDER_ID`
4. Apply the schema from [`schema.sql`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/schema.sql) to D1.
5. Run `npm run dev`.

## Notes

- The app verifies Firebase ID tokens on the Worker before any protected API call.
- Cloudflare Email Routing rules preserve forwarding and optionally add a generated ingest address for the in-app inbox.
- The inbound email handler expects the Worker to be configured on the ingest domain named by `INGEST_DOMAIN`.
