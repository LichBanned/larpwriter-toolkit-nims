'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { roleFromMembership } = require('../../pg/projectsApi');

describe('roleFromMembership', () => {
  it('returns organizer for server-admin without membership', () => {
    assert.equal(roleFromMembership(null, true), 'organizer');
  });

  it('returns null for non-admin without membership', () => {
    assert.equal(roleFromMembership(null, false), null);
    assert.equal(roleFromMembership(undefined, false), null);
  });

  it('returns player when member_role is player', () => {
    assert.equal(roleFromMembership({ member_role: 'player' }, false), 'player');
    assert.equal(roleFromMembership({ member_role: 'player' }, true), 'player');
  });

  it('returns organizer for other membership roles', () => {
    assert.equal(roleFromMembership({ member_role: 'organizer' }, false), 'organizer');
    assert.equal(roleFromMembership({ member_role: null }, false), 'organizer');
    assert.equal(roleFromMembership({}, false), 'organizer');
  });
});
