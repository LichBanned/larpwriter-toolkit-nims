'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const requestProcessing = require('../middlewares/requestProcessing');

function mockRes() {
  const res = {
    headers: {},
    body: null,
    set(k, v) { this.headers[k] = v; },
    end(data) { this.body = data === undefined ? '' : data; },
  };
  return res;
}

describe('requestProcessing setCurrentProject PUT', () => {
  it('returns non-empty JSON and patches session via logIn', async () => {
    const result = {
      slug: 'alpha',
      role: 'organizer',
      projectId: 7,
      isServerAdmin: true,
    };
    let loginUser = null;
    const preparedDb = {
      setCurrentProject: async () => result,
      otherPut: async () => ({ ok: true }),
    };
    const mw = requestProcessing({ db: {}, preparedDb });
    const req = {
      method: 'PUT',
      url: '/setCurrentProject',
      body: [{ slug: 'alpha' }],
      user: { name: 'admin', role: 'player', projectSlug: null },
      logIn(user, cb) {
        loginUser = { ...user };
        cb(null);
      },
    };
    const res = mockRes();
    await new Promise((resolve, reject) => {
      mw(req, res, (err) => (err ? reject(err) : resolve()));
      // middleware is async via promise — wait a tick
      setTimeout(resolve, 50);
    });
    assert.ok(res.body);
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.slug, 'alpha');
    assert.equal(loginUser.projectSlug, 'alpha');
    assert.equal(loginUser.role, 'organizer');
    assert.equal(loginUser.isServerAdmin, true);
  });

  it('other PUT ends with empty body', async () => {
    const preparedDb = {
      createStory: async () => ({ ok: true }),
    };
    const mw = requestProcessing({ db: {}, preparedDb });
    const req = {
      method: 'PUT',
      url: '/createStory',
      body: [{ storyName: 'S' }],
      user: { name: 'admin', role: 'organizer' },
    };
    const res = mockRes();
    await new Promise((resolve) => {
      mw(req, res, () => resolve());
      setTimeout(resolve, 50);
    });
    assert.equal(res.body, '');
  });
});
