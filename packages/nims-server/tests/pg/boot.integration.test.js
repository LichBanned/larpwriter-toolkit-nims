'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const fixturePath = path.resolve(__dirname, '../../../nims-dbms/tests/helpers/pgFixture');
const {
  requireDatabaseUrl,
  uniqueSlug,
  minimalDatabase,
  truncateAll,
  ensureAccount,
  afterAllCleanup,
  withClient,
} = require(fixturePath);
const { saveDatabaseToProject } = require('../../../nims-dbms/pg/storage');
const pgBoot = require('../../pg/boot');

function verifyScrypt(salt, hashedPassword, password) {
  if (!String(salt).startsWith('scrypt$')) return false;
  const saltHex = String(salt).slice('scrypt$'.length);
  const hash = crypto.scryptSync(password, saltHex, 64).toString('hex');
  return hash === hashedPassword;
}

describe('boot.integration', () => {
  before(() => {
    requireDatabaseUrl();
    process.env.NIMS_STORAGE = 'postgres';
  });
  beforeEach(async () => {
    await truncateAll();
    pgBoot.setActiveProjectSlug('main');
  });
  after(async () => { await afterAllCleanup(); });

  it('verifyAccountPassword + getMembershipFlags + ownsEntity', async () => {
    await ensureAccount('org', 'Secret1!');
    const slug = uniqueSlug('boot');
    const db = minimalDatabase({
      Characters: { Hero: { name: 'Hero' } },
      ManagementInfo: {
        UsersInfo: {
          org: {
            name: 'org', characters: ['Hero'], stories: [], players: [], groups: [],
          },
        },
        PlayersInfo: {},
        admins: ['org'],
        editors: [],
        adaptationRights: 'ByStory',
        WelcomeText: '',
        PlayersOptions: {},
      },
    });
    await withClient((c) => saveDatabaseToProject(c, db, slug));
    pgBoot.setActiveProjectSlug(slug);

    const auth = await pgBoot.verifyAccountPassword('org', 'Secret1!', verifyScrypt);
    assert.ok(auth);
    assert.equal(auth.username, 'org');
    assert.equal(auth.projectSlug, slug);

    const bad = await pgBoot.verifyAccountPassword('org', 'wrong', verifyScrypt);
    assert.equal(bad, null);

    const flags = await pgBoot.getMembershipFlags('org', slug);
    assert.ok(flags);
    assert.equal(flags.projectSlug, slug);

    // ownsEntity uses membership ownership tables
    const owns = await pgBoot.ownsEntity('org', 'character', 'Hero');
    assert.equal(typeof owns, 'boolean');
  });

  it('auditMutate records without throwing', async () => {
    await ensureAccount('org', 'Secret1!');
    const slug = uniqueSlug('aud');
    const db = minimalDatabase({
      Characters: { Hero: { name: 'Hero' } },
      ManagementInfo: {
        UsersInfo: {
          org: { name: 'org', characters: ['Hero'], stories: [], players: [], groups: [] },
        },
        PlayersInfo: {},
        admins: ['org'],
        editors: [],
        adaptationRights: 'ByStory',
        WelcomeText: '',
        PlayersOptions: {},
      },
    });
    await withClient((c) => saveDatabaseToProject(c, db, slug));
    pgBoot.setActiveProjectSlug(slug);
    await pgBoot.auditMutate({
      command: 'updateProfileField',
      args: { type: 'character', characterName: 'Hero' },
      username: 'org',
      ok: true,
      getDatabase: async () => db,
    });
  });
});
