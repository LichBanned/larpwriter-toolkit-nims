'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { snapshotEntity, MUTATE_ENTITY_MAP } = require('../../pg/revisions');

describe('snapshotEntity', () => {
  it('returns null without database or entityId', () => {
    assert.equal(snapshotEntity(null, 'character', 'A'), null);
    assert.equal(snapshotEntity({}, 'character', ''), null);
    assert.equal(snapshotEntity({}, 'character', null), null);
  });

  it('snapshots live character/player/story/group', () => {
    const db = {
      Characters: { Hero: { name: 'Hero' } },
      Players: { P1: { name: 'P1' } },
      Stories: { S1: { name: 'S1', events: [] } },
      Groups: { G1: { name: 'G1', members: [] } },
    };
    assert.deepEqual(snapshotEntity(db, 'character', 'Hero'), {
      name: 'Hero', fields: { name: 'Hero' },
    });
    assert.deepEqual(snapshotEntity(db, 'player', 'P1'), {
      name: 'P1', fields: { name: 'P1' },
    });
    assert.equal(snapshotEntity(db, 'story', 'S1').story.name, 'S1');
    assert.equal(snapshotEntity(db, 'group', 'G1').group.name, 'G1');
  });

  it('marks missing entities as deleted', () => {
    const db = { Characters: {}, Players: {}, Stories: {}, Groups: {}, Relations: [] };
    assert.deepEqual(snapshotEntity(db, 'character', 'X'), { name: 'X', deleted: true });
    assert.deepEqual(snapshotEntity(db, 'player', 'Y'), { name: 'Y', deleted: true });
    assert.deepEqual(snapshotEntity(db, 'story', 'Z'), { name: 'Z', deleted: true });
    assert.deepEqual(snapshotEntity(db, 'group', 'W'), { name: 'W', deleted: true });
    assert.deepEqual(snapshotEntity(db, 'relation', 'A|B'), { id: 'A|B', deleted: true });
  });

  it('finds bidirectional relations', () => {
    const rel = { starter: 'A', ender: 'B', starterText: 'hi' };
    const db = { Relations: [rel] };
    assert.equal(snapshotEntity(db, 'relation', 'A|B').relation, rel);
    assert.equal(snapshotEntity(db, 'relation', 'B|A').relation, rel);
  });

  it('returns generic object for unknown type', () => {
    assert.deepEqual(snapshotEntity({}, 'widget', '1'), { entityType: 'widget', entityId: '1' });
  });
});

describe('MUTATE_ENTITY_MAP', () => {
  it('maps profile commands by type', () => {
    assert.deepEqual(
      MUTATE_ENTITY_MAP.createProfile({ type: 'player', characterName: 'P' }),
      { entityType: 'player', entityId: 'P' },
    );
    assert.deepEqual(
      MUTATE_ENTITY_MAP.createProfile({ type: 'character', characterName: 'C' }),
      { entityType: 'character', entityId: 'C' },
    );
    assert.deepEqual(
      MUTATE_ENTITY_MAP.renameProfile({ type: 'character', fromName: 'A', toName: 'B' }),
      { entityType: 'character', entityId: 'B' },
    );
  });

  it('maps story/group/relation commands', () => {
    assert.deepEqual(
      MUTATE_ENTITY_MAP.setWriterStory({ storyName: 'S' }),
      { entityType: 'story', entityId: 'S' },
    );
    assert.deepEqual(
      MUTATE_ENTITY_MAP.createGroup({ groupName: 'G' }),
      { entityType: 'group', entityId: 'G' },
    );
    assert.deepEqual(
      MUTATE_ENTITY_MAP.createCharacterRelation({ fromCharacter: 'A', toCharacter: 'B' }),
      { entityType: 'relation', entityId: 'A|B' },
    );
    assert.deepEqual(
      MUTATE_ENTITY_MAP.setCharacterRelationText({ starter: 'X', ender: 'Y' }),
      { entityType: 'relation', entityId: 'X|Y' },
    );
  });
});
