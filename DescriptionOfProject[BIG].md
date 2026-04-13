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
