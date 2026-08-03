#!/usr/bin/env node
/**
 * Multiproject HTTP checks against Postgres app.
 * Usage: node api-multiproject-test.mjs [baseUrl]
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
  const json = await res.json().catch(() => ({}));
  return { status: res.status, cookie, json };
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
  console.log(`multiproject against ${BASE}`);
  const { status, cookie, json } = await login(ADMIN_USER, ADMIN_PASS);
  record('login admin', status === 200 && !!cookie, JSON.stringify(json));
  if (!cookie) process.exit(1);

  const me = await api(cookie, 'GET', 'getMetaInfo');
  // /me endpoint
  const meRes = await fetch(`${BASE}/me`, {
    headers: { Accept: 'application/json', Cookie: cookie },
  });
  const meJson = await meRes.json();
  record('/me 200', meRes.status === 200 && meJson.user?.name === ADMIN_USER, JSON.stringify(meJson));

  const listed = await api(cookie, 'GET', 'listProjects', { includeJoinable: false });
  record('listProjects', listed.status === 200 && Array.isArray(listed.json), String(listed.status));

  const slug = `mp_${Date.now().toString(36)}`;
  const created = await api(cookie, 'PUT', 'createProject', { slug, name: slug });
  record('createProject', created.status === 200 || created.status === 204
    || (created.json && created.json.id), created.text?.slice(0, 120));

  const switched = await api(cookie, 'PUT', 'setCurrentProject', { slug });
  record(
    'setCurrentProject JSON body',
    switched.status === 200 && switched.json && switched.json.slug === slug,
    switched.text?.slice(0, 200),
  );

  const me2 = await fetch(`${BASE}/me`, {
    headers: { Accept: 'application/json', Cookie: cookie },
  }).then((r) => r.json());
  record('session projectSlug after switch', me2.user?.projectSlug === slug, JSON.stringify(me2.user));

  // non-member forbidden switch
  const deny = await api(cookie, 'PUT', 'setCurrentProject', { slug: 'no-such-project-zzz' });
  record(
    'forbidden switch',
    deny.status >= 400 || (deny.text && /forbidden|not-found|no-membership|exist/i.test(deny.text)),
    deny.text?.slice(0, 120),
  );

  console.log(`\nmultiproject: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
