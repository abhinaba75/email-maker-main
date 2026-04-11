import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';

function createD1Stub({ onFirst, onAll, onRun } = {}) {
  return {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async first() {
          return onFirst ? onFirst(sql, statement.values) : null;
        },
        async all() {
          if (onAll) return onAll(sql, statement.values);
          return { results: [] };
        },
        async run() {
          return onRun ? onRun(sql, statement.values) : { success: true };
        },
      };
      return statement;
    },
  };
}

test('runtime-config derives apiBaseUrl from forwarded origin', async () => {
  const response = await worker.fetch(
    new Request('https://alias-forge-2000.abhinaba.workers.dev/api/runtime-config', {
      headers: {
        Origin: 'https://email.itsabhinaba.in',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'email.itsabhinaba.in',
      },
    }),
    {
      PUBLIC_FIREBASE_API_KEY: 'key',
      PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
      PUBLIC_FIREBASE_PROJECT_ID: 'demo',
      PUBLIC_FIREBASE_APP_ID: 'app',
      PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123',
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.apiBaseUrl, 'https://email.itsabhinaba.in');
  assert.equal(payload.firebase.projectId, 'demo');
});

test('asset responses receive a content security policy header', async () => {
  const response = await worker.fetch(
    new Request('https://email.itsabhinaba.in/', {
      headers: { Origin: 'https://email.itsabhinaba.in' },
    }),
    {
      ASSETS: {
        fetch: async () =>
          new Response('<!doctype html><html><body>Hello</body></html>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Security-Policy') || '', /default-src 'self'/);
});

test('email handler quarantines unknown aliases instead of queueing mail', async () => {
  let storedRawKey = null;
  let queuedPayload = null;

  const env = {
    DB: createD1Stub({
      onFirst(sql) {
        if (sql.includes('FROM alias_rules')) return null;
        if (sql.includes('FROM ingest_failures')) return null;
        return null;
      },
      onAll(sql) {
        if (sql.startsWith('PRAGMA table_info(')) return { results: [] };
        return { results: [] };
      },
      onRun(sql, values) {
        if (sql.includes('INSERT INTO ingest_failures')) {
          storedRawKey = values[5];
        }
        return { success: true };
      },
    }),
    MAIL_BUCKET: {
      async put(key) {
        storedRawKey = key;
      },
    },
    MAIL_INGEST_QUEUE: {
      async send(payload) {
        queuedPayload = payload;
      },
    },
  };

  await worker.email(
    {
      to: 'missing@example.com',
      from: 'sender@example.net',
      raw: new Uint8Array([65, 66, 67]),
      headers: {
        get(name) {
          return name.toLowerCase() === 'message-id' ? '<msg@example.net>' : null;
        },
      },
      async forward() {
        throw new Error('forward should not run for unknown alias');
      },
    },
    env,
    { waitUntil() {} },
  );

  assert.match(storedRawKey || '', /^raw\/.+\.eml$/);
  assert.equal(queuedPayload, null);
});

test('scheduled handler runs cleanly when there are no users to refresh', async () => {
  const queries = [];
  const env = {
    DB: createD1Stub({
      onAll(sql) {
        queries.push(sql);
        if (sql.startsWith('PRAGMA table_info(')) return { results: [] };
        if (sql.includes('SELECT id FROM users')) return { results: [] };
        if (sql.includes('FROM ingest_failures')) return { results: [] };
        return { results: [] };
      },
      onRun() {
        return { success: true };
      },
    }),
  };

  await worker.scheduled({}, env);

  assert.ok(queries.some((sql) => sql.includes('SELECT id FROM users')));
});
