import test from 'node:test';
import assert from 'node:assert/strict';

import { getFolderCounts, getMailboxUnreadCounts, listIngestFailuresPage } from '../src/lib/db.js';

function createMockDb({ allHandler = () => [], firstHandler = () => null } = {}) {
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...params) {
          this._params = params;
          return this;
        },
        async all() {
          return { results: await allHandler(this._sql, this._params) };
        },
        async first() {
          return firstHandler(this._sql, this._params);
        },
      };
    },
  };
}

test('getFolderCounts returns per-folder totals plus draft count', async () => {
  const db = createMockDb({
    allHandler: async (sql) => {
      if (sql.includes('FROM threads')) {
        return [
          { folder: 'inbox', count: 7 },
          { folder: 'sent', count: 3 },
          { folder: 'trash', count: 1 },
        ];
      }
      return [];
    },
    firstHandler: (sql) => {
      if (sql.includes('FROM drafts')) {
        return { count: 5 };
      }
      return null;
    },
  });

  const counts = await getFolderCounts(db, 'usr_1');
  assert.deepEqual(counts, {
    inbox: 7,
    sent: 3,
    archive: 0,
    trash: 1,
    drafts: 5,
  });
});

test('getMailboxUnreadCounts returns inbox unread counts keyed by mailbox id', async () => {
  const db = createMockDb({
    allHandler: async () => [
      { mailbox_id: 'mbx_1', unread_count: 9 },
      { mailbox_id: 'mbx_2', unread_count: 2 },
    ],
  });

  const counts = await getMailboxUnreadCounts(db, 'usr_1');
  assert.deepEqual(counts, {
    mbx_1: 9,
    mbx_2: 2,
  });
});

test('listIngestFailuresPage parses payload JSON and emits a next cursor when more rows exist', async () => {
  const now = Date.now();
  const db = createMockDb({
    allHandler: async () => [
      {
        id: 'ing_3',
        user_id: 'usr_1',
        recipient: 'alpha@example.com',
        message_id: '<a@example.com>',
        raw_r2_key: 'raw/a.eml',
        reason: 'alias_not_found',
        payload_json: '{"to":"alpha@example.com"}',
        last_seen_at: now,
        retry_count: 1,
        resolved_at: null,
      },
      {
        id: 'ing_2',
        user_id: 'usr_1',
        recipient: 'beta@example.com',
        message_id: '<b@example.com>',
        raw_r2_key: 'raw/b.eml',
        reason: 'raw_message_missing',
        payload_json: '{"to":"beta@example.com"}',
        last_seen_at: now - 1,
        retry_count: 2,
        resolved_at: null,
      },
      {
        id: 'ing_1',
        user_id: 'usr_1',
        recipient: 'gamma@example.com',
        message_id: '<c@example.com>',
        raw_r2_key: 'raw/c.eml',
        reason: 'raw_message_missing',
        payload_json: '{"to":"gamma@example.com"}',
        last_seen_at: now - 2,
        retry_count: 0,
        resolved_at: null,
      },
    ],
  });

  const page = await listIngestFailuresPage(db, 'usr_1', { limit: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].payload_json.to, 'alpha@example.com');
  assert.ok(page.nextCursor);
});
