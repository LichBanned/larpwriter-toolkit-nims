'use strict';

/**
 * entity_revisions + command_log helpers.
 */

const MUTATE_ENTITY_MAP = {
  createProfile: (args) => ({
    entityType: args.type === 'player' ? 'player' : 'character',
    entityId: args.characterName || args.toName,
  }),
  renameProfile: (args) => ({
    entityType: args.type === 'player' ? 'player' : 'character',
    entityId: args.toName || args.fromName,
  }),
  removeProfile: (args) => ({
    entityType: args.type === 'player' ? 'player' : 'character',
    entityId: args.characterName,
  }),
  updateProfileField: (args) => ({
    entityType: args.type === 'player' ? 'player' : 'character',
    entityId: args.characterName,
  }),
  createStory: (args) => ({ entityType: 'story', entityId: args.storyName }),
  renameStory: (args) => ({ entityType: 'story', entityId: args.toName || args.fromName }),
  removeStory: (args) => ({ entityType: 'story', entityId: args.storyName }),
  setWriterStory: (args) => ({ entityType: 'story', entityId: args.storyName }),
  createEvent: (args) => ({ entityType: 'story', entityId: args.storyName }),
  moveEvent: (args) => ({ entityType: 'story', entityId: args.storyName }),
  cloneEvent: (args) => ({ entityType: 'story', entityId: args.storyName }),
  mergeEvents: (args) => ({ entityType: 'story', entityId: args.storyName }),
  removeEvent: (args) => ({ entityType: 'story', entityId: args.storyName }),
  setEventOriginProperty: (args) => ({ entityType: 'story', entityId: args.storyName }),
  addStoryCharacter: (args) => ({ entityType: 'story', entityId: args.storyName }),
  removeStoryCharacter: (args) => ({ entityType: 'story', entityId: args.storyName }),
  switchStoryCharacters: (args) => ({ entityType: 'story', entityId: args.storyName }),
  updateCharacterInventory: (args) => ({ entityType: 'story', entityId: args.storyName }),
  onChangeCharacterActivity: (args) => ({ entityType: 'story', entityId: args.storyName }),
  addCharacterToEvent: (args) => ({ entityType: 'story', entityId: args.storyName }),
  removeCharacterFromEvent: (args) => ({ entityType: 'story', entityId: args.storyName }),
  setEventAdaptationProperty: (args) => ({ entityType: 'story', entityId: args.storyName }),
  createGroup: (args) => ({ entityType: 'group', entityId: args.groupName }),
  renameGroup: (args) => ({ entityType: 'group', entityId: args.toName || args.fromName }),
  removeGroup: (args) => ({ entityType: 'group', entityId: args.groupName }),
  saveFilterToGroup: (args) => ({ entityType: 'group', entityId: args.groupName }),
  updateGroupProfileField: (args) => ({ entityType: 'group', entityId: args.groupName }),
  createCharacterRelation: (args) => ({
    entityType: 'relation',
    entityId: `${args.fromCharacter || args.starter}|${args.toCharacter || args.ender}`,
  }),
  removeCharacterRelation: (args) => ({
    entityType: 'relation',
    entityId: `${args.fromCharacter || args.starter}|${args.toCharacter || args.ender}`,
  }),
  setCharacterRelationText: (args) => ({
    entityType: 'relation',
    entityId: `${args.fromCharacter || args.starter}|${args.toCharacter || args.ender}`,
  }),
  setRelationReadyStatus: (args) => ({
    entityType: 'relation',
    entityId: `${args.fromCharacter || args.starter}|${args.toCharacter || args.ender}`,
  }),
  setRelationEssence: (args) => ({
    entityType: 'relation',
    entityId: `${args.fromCharacter || args.starter}|${args.toCharacter || args.ender}`,
  }),
  setRelationOrigin: (args) => ({
    entityType: 'relation',
    entityId: `${args.fromCharacter || args.starter}|${args.toCharacter || args.ender}`,
  }),
};

function snapshotEntity(database, entityType, entityId) {
  if (!database || !entityId) return null;
  if (entityType === 'character') {
    const row = database.Characters && database.Characters[entityId];
    return row ? { name: entityId, fields: row } : { name: entityId, deleted: true };
  }
  if (entityType === 'player') {
    const row = database.Players && database.Players[entityId];
    return row ? { name: entityId, fields: row } : { name: entityId, deleted: true };
  }
  if (entityType === 'story') {
    const story = database.Stories && database.Stories[entityId];
    return story ? { name: entityId, story } : { name: entityId, deleted: true };
  }
  if (entityType === 'group') {
    const group = database.Groups && database.Groups[entityId];
    return group ? { name: entityId, group } : { name: entityId, deleted: true };
  }
  if (entityType === 'relation') {
    const [a, b] = String(entityId).split('|');
    const rel = (database.Relations || []).find(
      (r) => (r.starter === a && r.ender === b) || (r.starter === b && r.ender === a),
    );
    return rel ? { id: entityId, relation: rel } : { id: entityId, deleted: true };
  }
  return { entityType, entityId };
}

async function resolveProjectId(client, slug) {
  const r = await client.query(
    `SELECT id FROM projects WHERE slug = $1 AND archived_at IS NULL`,
    [slug],
  );
  return r.rows[0] ? r.rows[0].id : null;
}

async function resolveAccountId(client, username) {
  if (!username) return null;
  const r = await client.query(`SELECT id FROM accounts WHERE username = $1`, [username]);
  return r.rows[0] ? r.rows[0].id : null;
}

async function logCommand(client, {
  projectId, accountId, command, params, ok, errorText,
}) {
  await client.query(
    `INSERT INTO command_log (project_id, account_id, command, params, ok, error_text)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
    [
      projectId || null,
      accountId || null,
      command,
      JSON.stringify(params || {}),
      ok !== false,
      errorText || null,
    ],
  );
}

async function insertEntityRevision(client, {
  projectId, entityType, entityId, snapshot, accountId, command, reason,
}) {
  if (!projectId || !entityType || !entityId) return null;
  const next = await client.query(
    `SELECT COALESCE(MAX(revision), 0) + 1 AS rev
     FROM entity_revisions
     WHERE project_id = $1 AND entity_type = $2 AND entity_id = $3`,
    [projectId, entityType, String(entityId)],
  );
  const revision = next.rows[0].rev;
  const ins = await client.query(
    `INSERT INTO entity_revisions
      (project_id, entity_type, entity_id, revision, snapshot, actor_account_id, command, reason)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     RETURNING id, revision, created_at`,
    [
      projectId,
      entityType,
      String(entityId),
      revision,
      JSON.stringify(snapshot || {}),
      accountId || null,
      command || null,
      reason || null,
    ],
  );
  return ins.rows[0];
}

async function recordMutateAudit(client, {
  slug, database, command, args, username, ok, errorText,
}) {
  const projectId = await resolveProjectId(client, slug);
  const accountId = await resolveAccountId(client, username);
  await logCommand(client, {
    projectId,
    accountId,
    command,
    params: args || {},
    ok,
    errorText,
  });
  if (!ok || !projectId) return;
  const mapper = MUTATE_ENTITY_MAP[command];
  if (!mapper) return;
  const mapped = mapper(args || {});
  if (!mapped || !mapped.entityId) return;
  const snap = snapshotEntity(database, mapped.entityType, mapped.entityId);
  await insertEntityRevision(client, {
    projectId,
    entityType: mapped.entityType,
    entityId: mapped.entityId,
    snapshot: snap,
    accountId,
    command,
    reason: 'mutate',
  });
}

async function listEntityRevisions(client, {
  slug, entityType, entityId, limit = 50,
}) {
  const projectId = await resolveProjectId(client, slug);
  if (!projectId) return [];
  const r = await client.query(
    `SELECT er.id, er.entity_type, er.entity_id, er.revision, er.command, er.reason,
            er.created_at, a.username AS actor
     FROM entity_revisions er
     LEFT JOIN accounts a ON a.id = er.actor_account_id
     WHERE er.project_id = $1 AND er.entity_type = $2 AND er.entity_id = $3
     ORDER BY er.revision DESC
     LIMIT $4`,
    [projectId, entityType, String(entityId), Math.min(Number(limit) || 50, 200)],
  );
  return r.rows;
}

async function getEntityRevision(client, { slug, entityType, entityId, revision }) {
  const projectId = await resolveProjectId(client, slug);
  if (!projectId) return null;
  const r = await client.query(
    `SELECT er.id, er.entity_type, er.entity_id, er.revision, er.snapshot, er.command, er.reason,
            er.created_at, a.username AS actor
     FROM entity_revisions er
     LEFT JOIN accounts a ON a.id = er.actor_account_id
     WHERE er.project_id = $1 AND er.entity_type = $2 AND er.entity_id = $3 AND er.revision = $4`,
    [projectId, entityType, String(entityId), Number(revision)],
  );
  return r.rows[0] || null;
}

async function cleanupOldRevisions(client, { slug, keepLast }) {
  const projectId = await resolveProjectId(client, slug);
  if (!projectId) return { deleted: 0 };
  let keep = keepLast;
  if (keep == null) {
    const pr = await client.query(`SELECT settings FROM projects WHERE id = $1`, [projectId]);
    const settings = pr.rows[0] && pr.rows[0].settings ? pr.rows[0].settings : {};
    keep = Number(settings.revision_keep_last) || 50;
  }
  keep = Math.max(1, Number(keep) || 50);
  const r = await client.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (
         PARTITION BY entity_type, entity_id ORDER BY revision DESC
       ) AS rn, reason
       FROM entity_revisions WHERE project_id = $1
     )
     DELETE FROM entity_revisions
     WHERE id IN (
       SELECT id FROM ranked WHERE rn > $2 AND (reason IS DISTINCT FROM 'import')
     )
     RETURNING id`,
    [projectId, keep],
  );
  return { deleted: r.rowCount, keepLast: keep };
}

module.exports = {
  MUTATE_ENTITY_MAP,
  snapshotEntity,
  resolveProjectId,
  resolveAccountId,
  logCommand,
  insertEntityRevision,
  recordMutateAudit,
  listEntityRevisions,
  getEntityRevision,
  cleanupOldRevisions,
};
