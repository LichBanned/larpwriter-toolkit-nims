#!/usr/bin/env node
/**
 * History: mutate → list revisions → restore against Postgres app.
 * Usage: node api-history-test.mjs [baseUrl]
 */
const BASE = process.argv[2] || process.env.NIMS_BASE_URL || 'http://localhost:3001';
const ADMIN_USER = process.env.NIMS_USER || 'admin';
const ADMIN_PASS = process.env.NIMS_PASS || 'TestAdmin1!';

let passed = 0;
let failed = 0;

function record(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}: ${detail}`);
  }
}

async function login(username, password) {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ username, password }),
    redirect: 'manual',
  });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ')
    || (res.headers.get('set-cookie') || '').split(',').map((c) => c.split(';')[0].trim()).join('; ');
  return { status: res.status, cookie };
}

async function api(cookie, method, cmd, args) {
  const opts = {
    method,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookie,
    },
  };
  let url = `${BASE}/api/${cmd}`;
  if (method === 'GET') {
    if (args !== undefined) url += `?params=${encodeURIComponent(JSON.stringify([args]))}`;
  } else {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(args !== undefined ? [args] : []);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}

async function main() {
  console.log(`history against ${BASE}`);
  const { cookie } = await login(ADMIN_USER, ADMIN_PASS);
  if (!cookie) {
    console.error('login failed');
    process.exit(1);
  }

  const charName = `HistChar_${Date.now().toString(36)}`;
  // Ensure editor mode off for create
  await api(cookie, 'PUT', 'removeEditor', {});
  const created = await api(cookie, 'PUT', 'createProfile', {
    type: 'character',
    characterName: charName,
  });
  record('create character', created.status < 400, created.text?.slice(0, 120));

  await api(cookie, 'PUT', 'updateProfileField', {
    type: 'character',
    characterName: charName,
    itemName: 'Биография',
    value: 'v1',
  });
  await api(cookie, 'PUT', 'updateProfileField', {
    type: 'character',
    characterName: charName,
    itemName: 'Биография',
    value: 'v2',
  });

  // wait write-through debounce + audit
  await new Promise((r) => setTimeout(r, 600));

  const revs = await api(cookie, 'GET', 'listEntityRevisions', {
    entityType: 'character',
    entityId: charName,
  });
  const list = Array.isArray(revs.json) ? revs.json : [];
  record('listEntityRevisions', revs.status === 200 && list.length >= 1, `count=${list.length}`);

  if (list.length) {
    const target = list[list.length - 1];
    const restored = await api(cookie, 'PUT', 'restoreEntityRevision', {
      entityType: 'character',
      entityId: charName,
      revision: target.revision,
    });
    record('restoreEntityRevision', restored.status < 400, restored.text?.slice(0, 120));
  } else {
    record('restoreEntityRevision', false, 'no revisions');
  }

  console.log(`\nhistory: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
