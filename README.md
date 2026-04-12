# Email By Abhinaba Das

Cloudflare Worker mail console with:

- Google sign-in
- per-user encrypted Cloudflare and Resend credentials
- multi-domain mailbox management
- alias + catch-all routing with forwarding
- inbound storage in D1/R2
- outbound sending via Resend
- React + TypeScript frontend built with Vite
- modern dark email app UI with glass surfaces, icon navigation, and animated compose flows

## Local setup

1. Install dependencies: `npm install`
2. Copy [`.dev.vars.example`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/.dev.vars.example) to `.dev.vars` and fill the Firebase runtime values plus `ALLOWED_ORIGINS` for local development.
3. Review [`wrangler.jsonc`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/wrangler.jsonc) and replace the account-specific bindings if you are deploying to a different Cloudflare account.
4. Add the Worker secret `APP_ENCRYPTION_KEY` with `npx wrangler secret put APP_ENCRYPTION_KEY`.
5. Apply the schema from [`schema.sql`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/schema.sql) to D1.
6. Run the frontend with `npm run dev`.
7. Run the Worker locally with `npm run dev:worker`.
8. Build static assets with `npm run build`.
9. Deploy with `npm run deploy`.

## Notes

- The app verifies Firebase ID tokens on the Worker before any protected API call.
- Firebase is used for Google authentication only. This repo is not configured for `firebase deploy`; the Worker remains the deploy target.
- Firebase web config is delivered through Worker environment vars and is intentionally exposed to the browser. All protected API routes still verify Firebase ID tokens on the Worker.
- Cloudflare Email Routing rules preserve forwarding and route inbox delivery directly into the Email Worker.
- Cloudflare is the only declared hosting target for the app. The production origin is the Worker custom domain `https://email.itsabhinaba.in`.
- If `email.itsabhinaba.in` was previously attached to a Vercel project, remove that domain from Vercel so Cloudflare remains the sole origin.
- Configure `ALLOWED_ORIGINS` so only your Cloudflare production origin and local development origins can call the Worker API cross-origin.
- Wrangler now serves the built frontend from `dist`, while Vite owns the React client source under [`src`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/src).
- Raw `.eml` retention should be enforced with an R2 lifecycle rule at the bucket level, not inside Worker code.

## GitHub auto-deploy

- Pull requests run [`.github/workflows/ci.yml`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/.github/workflows/ci.yml).
- Pushes to `main` run [`.github/workflows/deploy.yml`](C:/Users/abhin/Downloads/Programming/email-maker/email-maker/.github/workflows/deploy.yml), which builds the frontend, runs tests, and deploys `alias-forge-2000` with Wrangler.
- Add these GitHub repository secrets before relying on automatic deploys:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- The API token must have permission to deploy the Worker and update its linked resources in your Cloudflare account. Create it from Cloudflare, then store it in the GitHub repository secrets UI.
