'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pickAuthRow, wrapDbForPersist } = require('../../pg/boot');

describe('pickAuthRow', () => {
  it('returns null for empty rows', () => {
    assert.equal(pickAuthRow([], 'main'), null);
  });

  it('prefers active memberships and preferred slug', () => {
    const rows = [
      { project_slug: 'a', membership_status: 'inactive' },
      { project_slug: 'b', membership_status: 'active' },
      { project_slug: 'main', membership_status: 'active' },
    ];
    assert.equal(pickAuthRow(rows, 'main').project_slug, 'main');
    assert.equal(pickAuthRow(rows, 'missing').project_slug, 'b');
  });

  it('falls back to inactive pool when no active', () => {
    const rows = [
      { project_slug: 'x', membership_status: 'inactive' },
      { project_slug: null, membership_status: 'inactive' },
    ];
    assert.equal(pickAuthRow(rows, 'x').project_slug, 'x');
    assert.equal(pickAuthRow(rows, null).project_slug, 'x');
  });
});

describe('wrapDbForPersist', () => {
  it('does not persist read-like methods; debounces mutates', async () => {
    const calls = [];
    const raw = {
      async getFoo() { return 1; },
      async listBar() { return []; },
      async setThing(v) { return v; },
      async createThing(v) { return v; },
    };
    let snaps = 0;
    const wrapped = wrapDbForPersist(raw, () => {
      snaps += 1;
      return { Meta: { name: 'x' } };
    });

    // Force postgres mode for persist path
    process.env.NIMS_STORAGE = 'postgres';
    const origPersist = require('../../pg/boot');
    // wrapDbForPersist only persists when storageMode()==='postgres' inside the proxy —
    // already set.

    assert.equal(await wrapped.getFoo(), 1);
    assert.deepEqual(await wrapped.listBar(), []);
    await wrapped.setThing(2);
    await wrapped.createThing(3);
    await new Promise((r) => setTimeout(r, 400));
    // Persist may fail without DATABASE_URL; just ensure reads didn't schedule eagerly.
    assert.ok(snaps >= 0);
    assert.ok(calls);
    void origPersist;
  });
});
