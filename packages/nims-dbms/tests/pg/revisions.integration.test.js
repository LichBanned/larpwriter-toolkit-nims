'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  requireDatabaseUrl,
  uniqueSlug,
  minimalDatabase,
  truncateAll,
  ensureAccount,
  afterAllCleanup,
  withClient,
} = require('../helpers/pgFixture');
const { saveDatabaseToProject } = require('../../pg/storage');
const {
  recordMutateAudit,
  listEntityRevisions,
  getEntityRevision,
  cleanupOldRevisions,
  insertEntityRevision,
  resolveProjectId,
} = require('../../pg/revisions');

describe('revisions.integration', () => {
  before(() => requireDatabaseUrl());
  beforeEach(async () => { await truncateAll(); });
  after(async () => { await afterAllCleanup(); });

  it('recordMutateAudit lists and gets revisions; import retained by cleanup', async () => {
    const slug = uniqueSlug('rev');
    await ensureAccount('ed', 'Pass1!');
    const db = minimalDatabase({
      Characters: { Hero: { name: 'Hero' } },
      ManagementInfo: {
        UsersInfo: { ed: { name: 'ed', stories: [], characters: ['Hero'], players: [], groups: [] } },
        PlayersInfo: {},
        admins: ['ed'],
        editors: [],
        adaptationRights: 'ByStory',
        WelcomeText: '',
        PlayersOptions: {},
      },
    });

    await withClient(async (client) => {
      await saveDatabaseToProject(client, db, slug, { baselineRevision: true });
      const projectId = await resolveProjectId(client, slug);
      assert.ok(projectId);

      await recordMutateAudit(client, {
        slug,
        database: db,
        command: 'updateProfileField',
        args: { type: 'character', characterName: 'Hero' },
        username: 'ed',
        ok: true,
      });
      await recordMutateAudit(client, {
        slug,
        database: db,
        command: 'setWriterStory',
        args: { storyName: 'Missing' },
        username: 'ed',
        ok: false,
        errorText: 'nope',
      });

      for (let i = 0; i < 5; i += 1) {
        await insertEntityRevision(client, {
          projectId,
          entityType: 'character',
          entityId: 'Hero',
          snapshot: { name: 'Hero', fields: { n: i } },
          accountId: null,
          command: 'updateProfileField',
          reason: 'mutate',
        });
      }

      const listed = await listEntityRevisions(client, {
        slug, entityType: 'character', entityId: 'Hero', limit: 50,
      });
      assert.ok(listed.length >= 5);
      const one = await getEntityRevision(client, {
        slug, entityType: 'character', entityId: 'Hero', revision: listed[0].revision,
      });
      assert.ok(one);

      const cleaned = await cleanupOldRevisions(client, { slug, keepLast: 2 });
      assert.ok(cleaned.deleted >= 1);
      const after = await listEntityRevisions(client, {
        slug, entityType: 'character', entityId: 'Hero', limit: 50,
      });
      assert.ok(after.length <= 2);

      const importLeft = await client.query(
        `SELECT count(*)::int AS c FROM entity_revisions
         WHERE project_id = $1 AND reason = 'import'`,
        [projectId],
      );
      assert.equal(importLeft.rows[0].c, 1);
    });
  });
});
