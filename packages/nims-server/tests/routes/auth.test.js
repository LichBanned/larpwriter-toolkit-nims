'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const bodyParser = require('body-parser');
const http = require('http');
const emptyBase = require('nims-resources/emptyBase');
const { createServerDbms } = require('nims-dbms');
const authRoutes = require('../../routes/auth');

describe('routes/auth', () => {
  let server;
  let baseUrl;
  let cookie = '';
  let rawDb;

  before(async () => {
    process.env.NIMS_STORAGE = 'json';
    rawDb = createServerDbms(structuredClone(emptyBase.data), {
      adminLogin: 'admin',
      adminPass: 'Secret1!',
    });
    const dbms = { db: rawDb, rawDb, preparedDb: rawDb };

    const app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(session({
      secret: 'test',
      resave: false,
      saveUninitialized: false,
    }));
    app.use(passport.initialize());
    app.use(passport.session());
    require('../../boot')(app, dbms);
    authRoutes(app, dbms);

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function request(method, path, body, useCookie = true) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const url = new URL(path, baseUrl);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(useCookie && cookie ? { Cookie: cookie } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const sc = res.headers['set-cookie'];
          if (sc) {
            cookie = (Array.isArray(sc) ? sc : [sc]).map((s) => s.split(';')[0]).join('; ');
          }
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = text; }
          resolve({ status: res.statusCode, json, text });
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  it('/me is 401 when anonymous', async () => {
    cookie = '';
    const res = await request('GET', '/me', null, false);
    assert.equal(res.status, 401);
  });

  it('login returns user shape; /me includes fields', async () => {
    cookie = '';
    const login = await request('POST', '/login', {
      username: 'admin',
      password: 'Secret1!',
    });
    assert.equal(login.status, 200);
    assert.ok(login.json.user);
    assert.equal(login.json.user.name, 'admin');
    assert.ok('projectSlug' in login.json.user || login.json.user.projectSlug === null
      || login.json.user.projectSlug === undefined);

    const me = await request('GET', '/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.name, 'admin');
    assert.ok(typeof me.json.user.isServerAdmin === 'boolean');
  });

  it('login 401 on bad password; signup-status; logout', async () => {
    cookie = '';
    const bad = await request('POST', '/login', {
      username: 'admin',
      password: 'wrong-password',
    });
    assert.equal(bad.status, 401);

    const status = await request('GET', '/signup-status', null, false);
    assert.equal(status.status, 200);
    assert.equal(typeof status.json.allowPlayerCreation, 'boolean');

    cookie = '';
    const login = await request('POST', '/login', {
      username: 'admin',
      password: 'Secret1!',
    });
    assert.equal(login.status, 200);
    const out = await request('POST', '/logout', {});
    assert.ok(out.status === 200 || out.status === 302);
    cookie = '';
    const me = await request('GET', '/me', null, false);
    assert.equal(me.status, 401);
  });

  it('signUp returns 403 when player creation disabled', async () => {
    cookie = '';
    const mi = rawDb.database.ManagementInfo;
    mi.PlayersOptions = { ...(mi.PlayersOptions || {}), allowPlayerCreation: false };
    const res = await request('POST', '/signUp', {
      userName: `newbie_${Date.now().toString(36)}`,
      password: 'Pass1!',
      confirmPassword: 'Pass1!',
    });
    assert.equal(res.status, 403);
  });
});
