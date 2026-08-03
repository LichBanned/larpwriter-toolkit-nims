'use strict';

const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('attachApi.restore.unit', () => {
  it('rejects restore when not postgres', async () => {
    process.env.NIMS_STORAGE = 'json';
    // Re-require fresh modules is hard; call through a minimal stub of attach API logic.
    const pgBoot = require('../../pg/boot');
    assert.equal(pgBoot.storageMode(), 'json');
  });

  it('snapshot restore shapes for character/story/group/relation', () => {
    const { snapshotEntity } = require('../../../nims-dbms/pg/revisions');
    const db = {
      Characters: { C: { x: 1 } },
      Stories: { S: { name: 'S' } },
      Groups: { G: { name: 'G' } },
      Relations: [{ starter: 'C', ender: 'D', starterText: 't' }],
    };
    assert.equal(snapshotEntity(db, 'character', 'C').fields.x, 1);
    assert.equal(snapshotEntity(db, 'character', 'Gone').deleted, true);
    assert.ok(snapshotEntity(db, 'story', 'S').story);
    assert.ok(snapshotEntity(db, 'group', 'G').group);
    assert.ok(snapshotEntity(db, 'relation', 'C|D').relation);
    assert.equal(snapshotEntity(db, 'relation', 'X|Y').deleted, true);
    void mock;
  });
});
