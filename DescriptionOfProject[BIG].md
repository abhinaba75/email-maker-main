# DescriptionOfProject[BIG]

This document is intentionally written in parts so it can grow without turning into an unreadable dump.

The goal of this file is simple:

1. Explain what this project is.
2. Explain how it is deployed and what external services it depends on.
3. Explain where the important logic lives in the codebase.
4. Explain the data model and request flow in a way that a new engineer can follow.
5. Serve as a durable project map for future maintenance.

This is **Part 1**, focused on the system overview, runtime topology, configuration, deployment, and top-level module structure.

---

## 1. What This Project Is

`Email By Abhinaba Das` is a full-stack email workspace built on **Cloudflare Workers**.

At a high level, it gives a signed-in user a single interface for:

- receiving mail for custom domains
- creating inboxes and mailboxes
- managing aliases and catch-all routing
- forwarding mail to destination addresses
- reading stored inbound mail
- composing outbound mail
- saving drafts
- saving reusable HTML templates
- generating or rewriting content with AI providers

This is not a simple static dashboard. It is a complete hosted application made of:

- a **React + TypeScript frontend**
- a **Cloudflare Worker backend**
- **D1** for relational application data
- **R2** for raw message and attachment storage
- **Cloudflare Queues** for mail ingest processing
- a **Durable Object** for realtime state / live updates
- **Firebase** for browser authentication
- **Cloudflare Email Routing** for inbound domain routing
- **Resend** for outbound email sending
- **Gemini** and **Groq/Llama** for AI-assisted composition

Primary references:

- `package.json`
- `wrangler.jsonc`
- `README.md`
- `src/worker.js`
- `src/App.tsx`
- `src/hooks/useAppController.tsx`
- `schema.sql`

---

## 2. Product Intent

The project is trying to behave like a private email operations console rather than a generic consumer mailbox.

The user experience revolves around these capabilities:

- connect infrastructure providers once
- provision a sending/receiving domain
- create mailboxes under that domain
- route inbound mail into the application
- inspect and manage the resulting threads
- forward selected traffic elsewhere
- compose and send branded or templated HTML mail
- use AI to draft or rewrite email content

This explains why the application mixes several concerns in one place:

- mailbox operations
- routing management
- domain verification
- credential storage
- content generation
- outbound delivery

The backend is therefore both:

- an application API
- and an orchestration layer across external providers

---

## 3. Runtime Topology

The production runtime is centered on a single Cloudflare Worker:

- Worker name: `alias-forge-2000`
- primary custom domain: `https://email.itsabhinaba.in`
- fallback Workers.dev domain: `https://alias-forge-2000.abhinaba.workers.dev`

Source reference:

- `wrangler.jsonc`

The Worker performs several jobs at once:

- serves the frontend assets from `dist`
- exposes the JSON API under `/api/*`
- verifies Firebase identity tokens
- stores and retrieves mail data from D1/R2
- processes inbound email events
- manages provider integrations
- signs temporary attachment URLs
- handles scheduled maintenance
- coordinates realtime client updates through a Durable Object

This design matters because it means the app is not split into separate frontend hosting and backend hosting systems. The Worker is the entire application boundary.

---

## 4. Main External Services and Why They Exist

### 4.1 Cloudflare Workers

Cloudflare Workers is the primary execution environment.

It is used for:

- request routing
- API endpoints
- asset serving
- auth token verification
- mail ingest
- provider orchestration
- scheduled jobs

The main backend entrypoint is:

- `src/worker.js`

### 4.2 Cloudflare D1

D1 is the application database.

It stores structured records such as:

- users
- provider connections
- domains
- mailboxes
- forward destinations
- alias rules
- threads
- messages
- attachments
- drafts
- HTML templates
- ingest failures

Bindings reference:

- `wrangler.jsonc` -> `d1_databases`
- `schema.sql`
- `src/lib/db.js`

### 4.3 Cloudflare R2

R2 is the object storage layer.

It stores binary or raw content that does not belong directly in D1 rows, especially:

- raw inbound `.eml` files
- uploaded attachments
- inline images and message-related binary assets

Bindings reference:

- `wrangler.jsonc` -> `r2_buckets`
- `src/worker.js`

### 4.4 Cloudflare Queues

Queues decouple inbound email ingestion from final persistence.

This gives the app a safer asynchronous path for:

- receiving raw mail events
- parsing them
- matching aliases
- deciding mailbox delivery or forwarding
- storing the final thread/message records

Bindings reference:

- `wrangler.jsonc` -> `queues`
- `src/worker.js`

### 4.5 Durable Objects

The app uses a Durable Object named `RealtimeHub`.

Its purpose is realtime coordination. In practice this is used so the frontend can reflect updates without a full page refresh, especially after:

- new mail arrival
- thread updates
- workspace bootstrap changes

Bindings reference:

- `wrangler.jsonc` -> `durable_objects`
- `src/worker.js`

### 4.6 Firebase Authentication

Firebase is used as the identity provider and token issuer for browser login.

Important boundary:

- Firebase is **not** the deployment target
- Firebase is **not** the data store
- Firebase is used for **authentication only**

The browser signs in through Google and receives a Firebase-authenticated session. The frontend then sends the Firebase ID token to the Worker, and the Worker verifies that token itself.

Code references:

- `src/hooks/useAppController.tsx`
- `src/lib/auth.js`
- `.dev.vars.example`
- `src/lib/constants.ts`

### 4.7 Cloudflare Email Routing

Cloudflare Email Routing is the inbound mail system for managed domains.

It is used for:

- enabling mail handling for a domain
- creating destination addresses
- creating alias / catch-all routing rules
- routing traffic into the Email Worker

Provider integration reference:

- `src/lib/providers/cloudflare.js`

### 4.8 Resend

Resend is the outbound email provider.

It is used for:

- domain-level sending status
- domain verification
- actual outbound message submission

Provider integration reference:

- `src/lib/providers/resend.js`
- `src/lib/sending.js`

### 4.9 AI Providers

The app supports at least two AI backends:

- Google Gemini
- Groq-hosted Llama

They are used for:

- AI compose
- rewrite
- shorten
- expand
- formalize
- casualize
- proofread
- summarize

References:

- `src/lib/ai.js`
- `src/lib/providers/gemini.js`
- `src/lib/providers/groq.js`

---

## 5. Deployment Configuration

The authoritative deployment configuration is `wrangler.jsonc`.

Key fields and what they mean:

### 5.1 Worker identity

```json
"name": "alias-forge-2000"
```

This is the Worker name used in Cloudflare.

### 5.2 Main entrypoint

```json
"main": "src/worker.js"
```

This tells Wrangler that the server runtime starts in `src/worker.js`.

### 5.3 Worker assets

```json
"assets": {
  "directory": "./dist",
  "binding": "ASSETS"
}
```

This means the React frontend is built by Vite into `dist`, then served by the Worker via the `ASSETS` binding.

This is an important architectural detail:

- Vite builds the frontend
- Wrangler deploys the frontend as Worker assets
- Cloudflare serves both UI and API

### 5.4 Custom domain

```json
"routes": [
  {
    "pattern": "email.itsabhinaba.in",
    "custom_domain": true
  }
]
```

This makes the custom domain point directly to the Worker.

### 5.5 D1 binding

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "alias-forge-2000",
    "database_id": "9dff9f33-59b9-40ca-a76f-0d6a09704b52"
  }
]
```

The Worker code can refer to `env.DB` to read and write the application database.

### 5.6 R2 binding

```json
"r2_buckets": [
  {
    "binding": "MAIL_BUCKET",
    "bucket_name": "alias-forge-mail"
  }
]
```

The Worker code can refer to `env.MAIL_BUCKET` for object storage.

### 5.7 Queue binding

```json
"queues": {
  "producers": [
    {
      "binding": "MAIL_INGEST_QUEUE",
      "queue": "alias-forge-mail-ingest"
    }
  ],
  "consumers": [
    {
      "queue": "alias-forge-mail-ingest",
      "max_batch_size": 8,
      "max_batch_timeout": 5
    }
  ]
}
```

This tells the Worker two things:

- it can enqueue mail ingest tasks through `env.MAIL_INGEST_QUEUE`
- it also consumes that queue as a worker consumer

### 5.8 Durable Object binding

```json
"durable_objects": {
  "bindings": [
    {
      "name": "REALTIME_HUB",
      "class_name": "RealtimeHub"
    }
  ]
}
```

This provides realtime synchronization support to the app.

### 5.9 Scheduled trigger

```json
"triggers": {
  "crons": [
    "*/20 * * * *"
  ]
}
```

The Worker has a scheduled job that runs every 20 minutes.

This is used for background maintenance such as:

- provider synchronization
- ingest failure retry work

### 5.10 Public environment variables

```json
"vars": {
  "APP_NAME": "Email By Abhinaba Das",
  "PUBLIC_APP_ORIGIN": "https://email.itsabhinaba.in",
  "PUBLIC_GOOGLE_CLIENT_ID": "150955610279-rv9ukdq7ruih96q7vlqmi67uh1jsr50d.apps.googleusercontent.com"
}
```

These are not secrets. They are runtime configuration values intentionally available to the Worker or the frontend runtime config endpoint.

---

## 6. Local Development Configuration

The local development example file is:

- `.dev.vars.example`

It documents the important non-checked-in runtime values:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_APP_ID`
- `FIREBASE_MESSAGING_SENDER_ID`
- `PUBLIC_GOOGLE_CLIENT_ID`
- `ALLOWED_ORIGINS`
- `APP_ENCRYPTION_KEY`

Important distinction:

- values prefixed with `PUBLIC_` are expected to be visible to the frontend runtime config
- values like `APP_ENCRYPTION_KEY` are server-side operational secrets

This project also depends on Cloudflare resource bindings which are **not** represented in `.dev.vars.example`, because those come from `wrangler.jsonc`.

---

## 7. Frontend Architecture

The frontend is a Vite-built React application.

Minimal entry chain:

- `index.html`
- `src/main.tsx`
- `src/App.tsx`

### 7.1 `src/main.tsx`

This is the browser bootstrap file.

Responsibilities:

- import React
- import the global CSS
- mount the React application into `#root`

This file is intentionally thin.

### 7.2 `src/App.tsx`

This is the UI shell coordinator.

It decides which major surface to render based on controller state:

- boot screen
- login screen
- signed-in application shell
- compose modal
- action notifications

Core observations:

- all meaningful state comes from `useAppController()`
- the UI is status-driven
- the app has one persistent controller, many render surfaces

Main render branches:

- booting -> show boot splash
- no user -> show login
- authenticated -> show `AppShell` and active workspace view

### 7.3 `src/hooks/useAppController.tsx`

This is the single most important frontend file.

It is the client-side application controller.

It manages:

- runtime config boot
- Firebase initialization
- Google sign-in flow
- token refresh
- API calls
- workspace bootstrap loading
- thread selection and pagination
- compose state launching
- domain and provider actions
- realtime connection state
- action status messages

In other words, this hook is the bridge between:

- browser UI components
- Firebase auth
- Worker JSON APIs
- realtime messaging

If a future engineer wants to understand the frontend’s behavior, this is the first serious file to read.

---

## 8. Backend Architecture

The Worker backend is concentrated in `src/worker.js`.

This file is large because it acts as the application’s unified server.

Its responsibilities include:

- runtime config delivery
- CORS handling
- security headers
- Firebase helper compatibility endpoints
- authenticated API routing
- attachment signing
- inline image serving
- database-backed workspace bootstrap
- inbound mail ingest
- provider orchestration
- scheduled maintenance
- realtime support

The architecture inside `src/worker.js` can be thought of as several layers:

### 8.1 Runtime/config layer

Examples:

- `resolveApiBaseUrl()`
- `buildRuntimeConfig()`
- `buildFirebaseInitConfig()`

These functions produce the frontend-facing configuration that the React app downloads at startup.

### 8.2 Security / request envelope layer

Examples:

- `createCorsHeaders()`
- `withCors()`
- `withSecurityHeaders()`
- signed attachment helpers

These functions enforce the boundary around the application.

### 8.3 Authenticated context layer

Examples:

- `getAuthenticatedContext()`
- `getRealtimeContext()`

These use the Firebase ID token to identify the current user and create a durable app-level user record.

### 8.4 Provider orchestration layer

Examples:

- Cloudflare routing provisioning
- Resend send capability status
- AI provider validation and usage

### 8.5 Data / application layer

Examples:

- bootstrap payload generation
- thread and draft actions
- domain and mailbox persistence
- ingest failure tracking

### 8.6 Event / maintenance layer

Examples:

- queue consumer handling
- scheduled retries / sync work

---

## 9. Security Model at a High Level

The security model is straightforward but important:

1. The browser authenticates with Google/Firebase.
2. Firebase provides an ID token.
3. The browser sends that token in the `Authorization` header.
4. The Worker verifies the Firebase signature and claims.
5. The Worker maps the Firebase identity to an app `users` row.
6. Every protected query is scoped through that user.

Relevant references:

- `src/lib/auth.js`
- `src/worker.js`

Additional protection layers exist for files:

- public attachment URLs are short-lived
- signatures are HMAC-based
- payloads include user identity and attachment identity

That logic lives in:

- `src/worker.js`

---

## 10. Directory Map

This is the practical “where do I look?” map for the repository.

### Root-level files

- `package.json`  
  Tooling, dependencies, scripts.

- `wrangler.jsonc`  
  Worker deployment, bindings, custom domain, cron, D1/R2/Queue/DO resources.

- `schema.sql`  
  Authoritative D1 schema definition.

- `.dev.vars.example`  
  Local environment variable template.

- `README.md`  
  Operational setup summary.

### Frontend

- `src/main.tsx`  
  React bootstrap.

- `src/App.tsx`  
  Top-level app rendering and notification orchestration.

- `src/hooks/useAppController.tsx`  
  Main client-side controller and runtime bridge.

- `src/components/*`  
  Shared UI primitives and app shell surfaces.

- `src/views/*`  
  Page-level workspace views such as domains, aliases, destinations, and drafts.

- `src/styles/global.css`  
  Global UI styling for the application.

### Backend

- `src/worker.js`  
  Main Worker entrypoint and API router.

- `src/lib/auth.js`  
  Firebase token verification.

- `src/lib/db.js`  
  D1 read/write logic and query helpers.

- `src/lib/providers/cloudflare.js`  
  Cloudflare Email Routing provider calls.

- `src/lib/providers/resend.js`  
  Resend integration.

- `src/lib/providers/gemini.js`  
  Gemini integration.

- `src/lib/providers/groq.js`  
  Groq/Llama integration.

- `src/lib/ai.js`  
  AI request building and response normalization.

- `src/lib/sending.js`  
  Sending domain eligibility and sending-state logic.

### Tests and CI

- `tests/*`  
  Focused Node test coverage for auth, database behavior, worker behavior, sending logic, and AI utilities.

- `.github/workflows/ci.yml`  
  Pull request validation.

- `.github/workflows/deploy.yml`  
  Auto-deploy to Cloudflare on `main`.

---

## 11. How To Read This Project As A New Engineer

A practical reading order for someone new:

1. `README.md`
2. `wrangler.jsonc`
3. `schema.sql`
4. `src/worker.js`
5. `src/lib/auth.js`
6. `src/lib/db.js`
7. `src/hooks/useAppController.tsx`
8. `src/App.tsx`
9. `src/views/*`
10. `tests/*`

Why this order works:

- first understand deployment
- then understand storage
- then understand server routing and auth
- then understand frontend orchestration
- then read the actual UI surfaces

---

## 12. What This Document Will Cover Next

The next parts should cover:

- Part 2: detailed database schema and each table’s role
- Part 3: request/response flow and API route map
- Part 4: mail ingest flow from inbound message to stored thread
- Part 5: outbound sending flow and sending-domain logic
- Part 6: frontend view-by-view explanation
- Part 7: AI provider flow, prompt shaping, and compose behavior
- Part 8: deployment, secrets, CI/CD, operations, and maintenance notes

This file is intentionally growing in stages so the explanation remains accurate and reviewable.

---

## Part 2: Database Schema and Data Model

Part 2 explains the D1 schema in detail.

The database is the canonical state of the product. Even though Cloudflare, Firebase, Resend, and R2 all participate in the system, D1 is the place where the application decides:

- who the user is inside the app
- which providers are connected
- which domains are managed
- where mail should go
- how threads and messages are organized
- what drafts and templates exist
- which failures still need repair or retry

Authoritative references for this section:

- `schema.sql`
- `src/lib/db.js`
- `src/lib/mail.js`

---

## 13. Database Philosophy

The schema is intentionally application-centric.

That means external provider data is not treated as the final truth. Instead, provider state is imported, normalized, and persisted into the app’s own model.

Examples:

- a Cloudflare routing rule becomes an `alias_rules` row plus a stored external `cloudflare_rule_id`
- a Resend domain becomes a `domains` row with `resend_domain_id`, `resend_status`, and `send_capability`
- an inbound raw email becomes a `messages` row plus an R2 object key

This pattern makes the system more maintainable because the frontend can render from one database model instead of hitting every provider directly.

---

## 14. Schema Conventions

Several conventions appear throughout the schema.

### 14.1 Every major entity has a text primary key

Examples:

- `usr_...`
- `dom_...`
- `drf_...`
- `tpl_...`

The code typically uses `createId()` from `src/lib/mail.js` to generate these.

### 14.2 Most rows are user-scoped

Almost every major table contains `user_id`.

This is the security boundary inside the app. Even if two users both connect Cloudflare or Resend, their domains, mailboxes, drafts, and messages remain isolated by user-scoped queries.

### 14.3 Timestamps are stored as integers

The schema generally stores timestamps as integer epoch values in milliseconds.

Examples:

- `created_at`
- `updated_at`
- `routing_checked_at`
- `first_seen_at`
- `last_seen_at`
- `resolved_at`

### 14.4 Some fields are JSON blobs

The app deliberately uses JSON columns in D1 where nested list-like structures are practical.

Examples:

- `metadata_json`
- `participants_json`
- `to_json`
- `cc_json`
- `bcc_json`
- `references_json`
- `attachment_json`
- `payload_json`

In `src/lib/db.js`, `JSON_FIELDS` defines which columns must be parsed and serialized automatically.

This matters because D1 stores them as text, but the application expects arrays or objects at runtime.

### 14.5 Foreign keys are used, but not everywhere

The schema enables `PRAGMA foreign_keys = ON`.

This provides relational integrity for many important links:

- user -> domain
- domain -> mailbox
- thread -> message
- message -> attachment

At the same time, some external-provider identifiers remain plain scalar fields because they represent remote system state rather than internal relational entities.

---

## 15. Table-by-Table Explanation

This section covers each table, what it means, and how it is used.

---

## 16. `users`

Schema:

- `id`
- `email`
- `display_name`
- `photo_url`
- `selected_sending_domain_id`
- `created_at`
- `updated_at`

Purpose:

This is the app’s internal user table.

Even though authentication comes from Firebase, the application still needs its own row so it can attach app state to a stable user identity.

Important behavior:

- `id` matches the Firebase user identity that the Worker verifies
- `selected_sending_domain_id` stores the user’s preferred sending domain for compose and outbound mail
- `photo_url` is used for the signed-in avatar in the UI

Main DB functions:

- `upsertUser()`
- `getUser()`
- `updateUserSelectedSendingDomain()`

Why this table exists:

Without it, the app would have to compute user state only from provider data or session claims. That would make preferences, domain selection, and UI personalization harder to persist.

---

## 17. `provider_connections`

Schema:

- `id`
- `user_id`
- `provider`
- `label`
- `secret_ciphertext`
- `metadata_json`
- `status`
- `created_at`
- `updated_at`

Purpose:

This table stores connected providers per user.

Examples of `provider` values in the codebase:

- `cloudflare`
- `resend`
- `gemini`
- `groq`

Important fields:

- `secret_ciphertext` contains encrypted provider credentials
- `metadata_json` stores provider-specific non-secret metadata
- `status` tracks whether the connection is usable

Security note:

Secrets are not stored in plaintext. They are encrypted through logic in:

- `src/lib/crypto.js`

Important constraint:

```sql
UNIQUE(user_id, provider)
```

This means one user gets one active connection record per provider type.

Main DB functions:

- `listConnections()`
- `getConnection()`
- `saveConnection()`

Why this table exists:

The application needs to store provider credentials per signed-in user so domain provisioning, routing management, sending, and AI generation can happen in the context of that user’s account.

---

## 18. `domains`

Schema:

- `id`
- `user_id`
- `zone_id`
- `account_id`
- `hostname`
- `label`
- `resend_domain_id`
- `resend_status`
- `send_capability`
- `routing_status`
- `routing_error`
- `routing_checked_at`
- `catch_all_mode`
- `catch_all_mailbox_id`
- `catch_all_forward_json`
- `ingest_destination_id`
- `created_at`
- `updated_at`

Purpose:

This is one of the most central tables in the entire product.

A `domains` row represents a user-managed email domain inside the app.

Key concepts encoded here:

- Cloudflare zone identity
- sending capability through Resend
- inbound routing health
- catch-all behavior
- routing destination state

Important fields:

### `zone_id` and `account_id`

These tie the row back to Cloudflare.

### `hostname`

The actual domain name, for example `pay.itsabhinaba.in`.

### `resend_domain_id`

The external identifier returned by Resend for sending-domain management.

### `resend_status`

Tracks the domain’s sending/verification state from Resend.

### `send_capability`

Normalized application-level sending state.

The DB helper layer explicitly normalizes this through `normalizeSendCapability()`.

Known values:

- `send_enabled`
- `receive_only`
- `send_unavailable`

### `routing_status`

Tracks inbound mail readiness.

Examples:

- `pending`
- `enabled`
- `degraded`

### `routing_error`

Human-readable routing failure text when the domain is not healthy.

### `catch_all_mode`

Controls what happens to mail that does not match a more specific alias rule.

### `catch_all_mailbox_id`

If the catch-all delivers into a mailbox, this links the domain to that mailbox.

### `catch_all_forward_json`

If the catch-all forwards instead of or in addition to inbox delivery, this field stores the selected destination identifiers.

### `ingest_destination_id`

Used to remember the Cloudflare email routing destination that points back into the Worker.

Main DB functions:

- `listDomains()`
- `getDomain()`
- `createDomain()`
- `updateDomain()`

Key helper behavior:

- `decorateDomain()` enriches rows with:
  - `sendCapability`
  - `canSend`
  - normalized routing fields

Why this table exists:

It is the bridge between provider-level domain state and the app’s user-facing operational model.

---

## 19. `mailboxes`

Schema:

- `id`
- `user_id`
- `domain_id`
- `local_part`
- `email_address`
- `display_name`
- `signature_html`
- `signature_text`
- `is_default_sender`
- `created_at`
- `updated_at`

Purpose:

A mailbox is a concrete inbox/sender identity under a domain.

Examples:

- `admin@itsabhinaba.in`
- `e075@itsabhinaba.in`

Important fields:

### `local_part`

The mailbox name before `@`.

### `email_address`

The fully materialized address.

### `signature_html` and `signature_text`

Per-mailbox signature content used during compose.

### `is_default_sender`

Indicates which mailbox should be preferred for outbound compose under that domain.

Constraint:

```sql
UNIQUE(domain_id, local_part)
```

This prevents duplicate mailbox local parts within the same domain.

Main DB functions:

- `listMailboxes()`
- `listMailboxesPage()`
- `getMailbox()`
- `createMailbox()`
- `updateMailbox()`
- `deleteMailbox()`

Why this table exists:

The app needs mailbox-level identity, signatures, and sender preferences independent of alias rules.

---

## 20. `forward_destinations`

Schema:

- `id`
- `user_id`
- `email`
- `display_name`
- `cloudflare_destination_id`
- `verification_state`
- `created_at`
- `updated_at`

Purpose:

This table represents target email addresses that can receive forwarded messages.

These are not inboxes hosted by the app. They are external destinations.

Important fields:

### `cloudflare_destination_id`

The external identifier from Cloudflare Email Routing.

### `verification_state`

Tracks whether Cloudflare has verified that forwarding to this destination is allowed.

Constraint:

```sql
UNIQUE(user_id, email)
```

This prevents duplicate destination rows per user.

Main DB functions:

- `listForwardDestinations()`
- `listForwardDestinationsPage()`
- `upsertForwardDestination()`

Why this table exists:

Alias and catch-all routing can forward to verified external recipients, so those destinations need to be modeled separately from local mailboxes.

---

## 21. `alias_rules`

Schema:

- `id`
- `user_id`
- `domain_id`
- `mailbox_id`
- `local_part`
- `is_catch_all`
- `mode`
- `ingress_address`
- `forward_destination_json`
- `cloudflare_rule_id`
- `enabled`
- `created_at`
- `updated_at`

Purpose:

This table defines how inbound mail is matched and delivered.

It is one of the most important operational tables in the product.

A rule can do things like:

- deliver mail for `sales@domain.com` to a mailbox
- forward matching mail to one or more external destinations
- represent the catch-all rule for `*@domain.com`

Important fields:

### `mailbox_id`

If delivery mode includes inbox delivery, this points to the mailbox that receives the message.

### `local_part`

The alias address prefix, such as `sales`.

### `is_catch_all`

Marks a wildcard rule.

### `mode`

Describes how the rule behaves.

The exact mode semantics are interpreted by the mail/routing layer, but conceptually this distinguishes:

- inbox delivery
- forwarding
- hybrid combinations

### `ingress_address`

The actual email address that Cloudflare will match.

### `forward_destination_json`

Stores the selected forwarding destinations.

### `cloudflare_rule_id`

The remote Cloudflare routing rule identifier.

### `enabled`

Boolean-like field controlling whether the rule is active.

Indexes:

```sql
CREATE UNIQUE INDEX idx_alias_rules_domain_local
ON alias_rules(domain_id, local_part, is_catch_all);
```

This is critical. It prevents duplicate overlap such as two identical alias rules under the same domain.

Main DB functions:

- `listAliasRules()`
- `listAliasRulesPage()`
- `getAliasRule()`
- `getAliasRuleByRecipient()`
- `createAliasRule()`
- `updateAliasRule()`
- `deleteAliasRule()`

Why this table exists:

It is the app-side routing model that mirrors Cloudflare Email Routing and allows the frontend to reason about alias behavior without talking directly to Cloudflare for every render.

---

## 22. `threads`

Schema:

- `id`
- `user_id`
- `domain_id`
- `mailbox_id`
- `folder`
- `subject`
- `subject_normalized`
- `participants_json`
- `snippet`
- `latest_message_at`
- `message_count`
- `unread_count`
- `starred`
- `created_at`
- `updated_at`

Purpose:

This table stores thread-level mailbox state.

This is what powers the left-hand thread list in the UI.

Important fields:

### `folder`

The folder the thread currently belongs to:

- `inbox`
- `sent`
- `archive`
- `trash`

### `subject` and `subject_normalized`

The normalized subject is used for conversation grouping logic and reply-prefix cleanup.

### `participants_json`

Cached participant summary for the thread.

### `snippet`

Short preview text shown in thread lists.

### `latest_message_at`

Primary ordering field for thread list views.

### `message_count`

Count of messages in the conversation.

### `unread_count`

Unread count for inbox display and sidebar badges.

### `starred`

Stores whether the thread is starred or pinned at the app level.

Index:

```sql
CREATE INDEX idx_threads_user_folder_latest
ON threads(user_id, folder, latest_message_at DESC);
```

This is essential for inbox-like pagination performance.

Main DB functions:

- `listThreads()`
- `listThreadsPage()`
- `getThread()`
- `applyThreadAction()`

Why this table exists:

Even though messages are stored individually, a mail UI fundamentally needs a thread summary model for fast list rendering, unread counts, and folder operations.

---

## 23. `messages`

Schema:

- `id`
- `user_id`
- `thread_id`
- `domain_id`
- `mailbox_id`
- `alias_rule_id`
- `direction`
- `folder`
- `internet_message_id`
- `provider_message_id`
- `from_json`
- `to_json`
- `cc_json`
- `bcc_json`
- `subject`
- `subject_normalized`
- `snippet`
- `text_body`
- `html_body`
- `raw_r2_key`
- `references_json`
- `in_reply_to`
- `is_read`
- `starred`
- `has_attachments`
- `sent_at`
- `received_at`
- `created_at`
- `updated_at`

Purpose:

This table stores individual email messages.

It is the most granular mail-content table in the app.

Important fields:

### `direction`

Distinguishes inbound vs outbound messages.

### `folder`

Mirrors folder placement at message level.

### `internet_message_id`

The email-standard message identifier. Useful for threading and deduplication.

### `provider_message_id`

The outbound provider identifier where relevant.

### `from_json`, `to_json`, `cc_json`, `bcc_json`

Structured address data.

### `text_body` and `html_body`

The core readable message content.

### `raw_r2_key`

Points to the raw `.eml` object in R2.

This is a major storage boundary:

- D1 stores searchable and renderable metadata/body
- R2 stores original raw content

### `references_json` and `in_reply_to`

Used for threading and reply chain tracking.

### `is_read`

Per-message read state.

### `has_attachments`

Fast boolean for UI behavior.

Indexes:

```sql
CREATE INDEX idx_messages_thread_created
ON messages(thread_id, created_at ASC);
```

Used to fetch a thread’s full message history in order.

```sql
CREATE INDEX idx_messages_message_id
ON messages(internet_message_id);
```

Useful for message matching and deduplication.

```sql
CREATE UNIQUE INDEX idx_messages_raw_r2_key
ON messages(raw_r2_key)
WHERE raw_r2_key IS NOT NULL;
```

This ensures the same raw stored email is not ingested twice under the same raw key.

Main DB functions:

- `saveInboundMessage()`
- `saveOutgoingMessage()`
- `getThread()`
- `applyThreadAction()`

Why this table exists:

Threads are summaries. Messages are the actual content-bearing records.

---

## 24. `attachments`

Schema:

- `id`
- `user_id`
- `message_id`
- `draft_id`
- `file_name`
- `mime_type`
- `byte_size`
- `content_id`
- `disposition`
- `r2_key`
- `created_at`

Purpose:

This table tracks stored files associated with either:

- persisted messages
- drafts

Important fields:

### `message_id`

Used when the attachment belongs to a finalized message.

### `draft_id`

Used when the attachment belongs to a draft-in-progress.

### `content_id`

Supports inline content references in HTML mail.

### `disposition`

Indicates whether the file is inline content or a normal attachment.

### `r2_key`

Actual object location in R2.

Why this table exists:

The app needs a structured record for attachments so it can:

- sign download URLs
- display attachment chips
- preserve draft attachments
- associate R2 objects with message/draft rows

---

## 25. `drafts`

Schema:

- `id`
- `user_id`
- `domain_id`
- `mailbox_id`
- `thread_id`
- `from_address`
- `to_json`
- `cc_json`
- `bcc_json`
- `subject`
- `text_body`
- `html_body`
- `attachment_json`
- `created_at`
- `updated_at`

Purpose:

This table stores unfinished outbound composition work.

It is distinct from `messages` because drafts are not yet delivered mail.

Important fields:

### `domain_id` and `mailbox_id`

These preserve which domain/mailbox the draft intends to send from.

### `thread_id`

Allows draft continuation inside an existing conversation.

### `attachment_json`

Stores attachment descriptors directly inside the draft row.

This is one of the places where the application chooses convenience over strict normalization.

Main DB functions:

- `listDrafts()`
- `listDraftsPage()`
- `getDraft()`
- `saveDraft()`
- `deleteDraft()`
- `purgeDrafts()`

Why this table exists:

Drafts need different lifecycle rules than sent messages:

- they can be overwritten frequently
- they can exist with incomplete recipients/content
- they may reference temporary attachments

---

## 26. `html_templates`

Schema:

- `id`
- `user_id`
- `domain_id`
- `name`
- `subject`
- `html_content`
- `created_at`
- `updated_at`

Purpose:

This table stores reusable HTML templates for composing email.

These are not full messages and not drafts. They are reusable HTML building blocks.

Important fields:

### `domain_id`

Optional domain scoping. A template may either be:

- associated with a specific domain
- or usable across any sending domain

### `html_content`

The actual reusable HTML markup.

Main DB functions:

- `listHtmlTemplatesPage()`
- `getHtmlTemplate()`
- `createHtmlTemplate()`
- `updateHtmlTemplate()`
- `deleteHtmlTemplate()`

Why this table exists:

The app wants to support repeated branded outbound mail without forcing users to re-author HTML from scratch.

---

## 27. `ingest_failures`

Schema:

- `id`
- `user_id`
- `domain_id`
- `recipient`
- `message_id`
- `raw_r2_key`
- `reason`
- `payload_json`
- `first_seen_at`
- `last_seen_at`
- `retry_count`
- `resolved_at`

Purpose:

This table is the operational repair queue for inbound email failures.

If inbound processing cannot complete cleanly, the system records the failure instead of losing the event silently.

Important fields:

### `recipient`

Which address the inbound email was trying to reach.

### `raw_r2_key`

The raw email object in R2 associated with the failure.

### `reason`

Human-readable cause of failure.

### `payload_json`

Failure context used for debugging or retry logic.

### `retry_count`

Tracks how many retry attempts have happened.

### `resolved_at`

Marks a failure as no longer active.

Indexes:

```sql
CREATE UNIQUE INDEX idx_ingest_failures_raw_key_reason
ON ingest_failures(raw_r2_key, reason);
```

This avoids duplicate failure rows for the same raw message and same failure reason.

```sql
CREATE INDEX idx_ingest_failures_user_open
ON ingest_failures(user_id, resolved_at, last_seen_at DESC);
```

This supports operational UI views showing open failures ordered by recency.

Main DB functions:

- `recordIngestFailure()`
- `getIngestFailure()`
- `listIngestFailuresPage()`

Why this table exists:

Production email systems need a recovery path. This table is that path.

---

## 28. Key Relationships Across Tables

The schema is easiest to understand as a graph.

### 28.1 User-centered graph

One `users` row can have many:

- `provider_connections`
- `domains`
- `mailboxes`
- `forward_destinations`
- `alias_rules`
- `threads`
- `messages`
- `attachments`
- `drafts`
- `html_templates`
- `ingest_failures`

This is why almost every query in `src/lib/db.js` starts with `WHERE user_id = ?`.

### 28.2 Domain-centered graph

One `domains` row can have many:

- `mailboxes`
- `alias_rules`
- `threads`
- `messages`
- `drafts`
- `html_templates`
- `ingest_failures`

### 28.3 Thread-centered graph

One `threads` row can have many:

- `messages`

This is the heart of mailbox browsing.

### 28.4 Draft/attachment relationship

Drafts and messages both relate to attachments, but not in exactly the same way:

- finalized messages use `attachments` rows linked by `message_id`
- drafts additionally store `attachment_json` directly inside the draft row

This hybrid design is a convenience tradeoff that simplifies draft restoration in the compose UI.

---

## 29. Folder Semantics

The mail model uses folder state at both thread and message levels.

Recognized folders include:

- `inbox`
- `sent`
- `archive`
- `trash`

This matters because the app supports actions like:

- archive
- trash
- restore
- mark read
- mark unread
- delete forever

The main action handler is:

- `applyThreadAction()` in `src/lib/db.js`

That function updates thread/message state depending on the requested action.

---

## 30. Pagination Model

The app supports cursor-based pagination in multiple areas.

The helper layer uses:

- `encodeCursor()`
- `decodeCursor()`
- `clampLimit()`

Paginated DB functions include:

- `listMailboxesPage()`
- `listHtmlTemplatesPage()`
- `listForwardDestinationsPage()`
- `listAliasRulesPage()`
- `listIngestFailuresPage()`
- `listThreadsPage()`
- `listDraftsPage()`

This is important because the application intentionally avoids unlimited result sets in the live UI.

Instead, the API returns:

- current page items
- a `nextCursor` when more data is available

The frontend then uses explicit “load more” interactions.

---

## 31. Derived and Summary Data

Not all mailbox UI information comes from raw message rows.

The database layer includes summary helpers that compute higher-level state:

### `getAlertCounts()`

Returns counts for:

- degraded routing
- unresolved ingest failures

### `getFolderCounts()`

Returns global thread counts per folder plus draft count.

### `getMailboxUnreadCounts()`

Returns unread inbox counts grouped by mailbox.

These functions are important because the UI would be far less efficient if it recomputed all of this client-side.

---

## 32. Schema Evolution

The project does not assume the database is always born in its latest state.

`ensureSchema()` in `src/lib/db.js`:

- runs all SQL statements from `SCHEMA_SQL`
- then applies additional safe column checks
- adds missing columns if they are not present yet

Examples:

- `selected_sending_domain_id` on `users`
- `send_capability` on `domains`
- `routing_error` on `domains`
- `routing_checked_at` on `domains`

This means the application includes a small amount of migration safety at runtime.

That is practical for a Worker app where deploys may need to tolerate already-existing data.

---

## 33. Why The Schema Looks The Way It Does

The schema is designed around operations, not abstract purity.

That is why it mixes:

- normalized entities for core relationships
- JSON blobs for flexible address/attachment/provider payloads
- cached thread summaries for fast inbox rendering
- raw-object references for lossless recovery/debugging

This combination is appropriate for an email application because email data is naturally semi-structured:

- bodies are large and variable
- addresses are array-like
- provider metadata is heterogeneous
- original MIME content must sometimes be preserved

Trying to model every single email substructure in fully normalized relational tables would make the product harder to build and maintain.

---

## 34. Practical Mental Model For The Data Layer

A simple way to think about the data model is:

- `users` = who is signed in
- `provider_connections` = which external systems they connected
- `domains` = which mail domains they manage
- `mailboxes` = which inbox identities exist under those domains
- `forward_destinations` = where mail can be forwarded externally
- `alias_rules` = how inbound routing decisions are made
- `threads` = mailbox conversation summaries
- `messages` = actual email contents
- `attachments` = stored file artifacts
- `drafts` = unsent work in progress
- `html_templates` = reusable HTML mail building blocks
- `ingest_failures` = repair queue for broken inbound processing

That is the relational backbone of the entire app.

---

## 35. What Part 3 Should Cover Next

The next useful section is the API and request flow layer:

- runtime config boot
- sign-in and token verification
- bootstrap payload generation
- thread listing and selection
- draft save/send flow
- domain provisioning and routing sync
- inbound email ingest path
- scheduled maintenance and retry flow

That next section will connect this schema to actual request/response behavior.
