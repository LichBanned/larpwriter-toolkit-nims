'use strict';

/**
 * PostgreSQL-backed project storage: hydrate Database JSON + write-through persist.
 */

const { Client, Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

async function withClient(fn) {
  const p = getPool();
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {object} database — NIMS Database document
 * @param {string} slug
 * @param {{ baselineRevision?: boolean }} [opts]
 */
async function saveDatabaseToProject(client, database, slug, opts = {}) {
  const meta = database.Meta || {};
  const mi = database.ManagementInfo || {};

  await client.query('BEGIN');
  try {
    let projectId;
    const existing = await client.query('SELECT id FROM projects WHERE slug = $1', [slug]);
    if (existing.rows.length) {
      projectId = existing.rows[0].id;
      await client.query(
        `UPDATE projects SET
          name = $2, description = $3, game_date = $4, pre_game_date = $5,
          schema_version = $6, adaptation_rights = $7, welcome_text = $8,
          players_options = $9::jsonb, settings = $10::jsonb,
          legacy_blobs = $11::jsonb, updated_at = now()
         WHERE id = $1`,
        [
          projectId,
          meta.name || '',
          meta.description || '',
          meta.date || '',
          meta.preGameDate || '',
          database.Version || '0.8.0',
          mi.adaptationRights || 'ByStory',
          mi.WelcomeText || '',
          JSON.stringify(mi.PlayersOptions || { allowPlayerCreation: false, allowCharacterCreation: false }),
          JSON.stringify(database.Settings || {}),
          JSON.stringify({
            InvestigationBoard: database.InvestigationBoard || null,
            Log: database.Log || [],
            saveTime: meta.saveTime || '',
          }),
        ],
      );
      // wipe normalized content for rewrite (keep accounts by username merge)
      await client.query('DELETE FROM project_documents WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM entity_ownership WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM sliders WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM gears_edges WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM gears_nodes WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM gears_settings WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE project_id = $1)', [projectId]);
      await client.query('DELETE FROM groups WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM relation_texts WHERE relation_id IN (SELECT id FROM relations WHERE project_id = $1)', [projectId]);
      await client.query('DELETE FROM relations WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM event_adaptations WHERE event_id IN (SELECT e.id FROM story_events e JOIN stories s ON s.id = e.story_id WHERE s.project_id = $1)', [projectId]);
      await client.query('DELETE FROM story_events WHERE story_id IN (SELECT id FROM stories WHERE project_id = $1)', [projectId]);
      await client.query('DELETE FROM story_characters WHERE story_id IN (SELECT id FROM stories WHERE project_id = $1)', [projectId]);
      await client.query('DELETE FROM stories WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM profile_bindings WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM questionnaires WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM players WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM characters WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM profile_field_defs WHERE project_id = $1', [projectId]);
    } else {
      const ins = await client.query(
        `INSERT INTO projects (slug, name, description, game_date, pre_game_date, schema_version,
          adaptation_rights, welcome_text, players_options, settings, legacy_blobs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb) RETURNING id`,
        [
          slug,
          meta.name || slug,
          meta.description || '',
          meta.date || '',
          meta.preGameDate || '',
          database.Version || '0.8.0',
          mi.adaptationRights || 'ByStory',
          mi.WelcomeText || '',
          JSON.stringify(mi.PlayersOptions || { allowPlayerCreation: false, allowCharacterCreation: false }),
          JSON.stringify(database.Settings || {}),
          JSON.stringify({
            InvestigationBoard: database.InvestigationBoard || null,
            Log: database.Log || [],
            saveTime: meta.saveTime || '',
          }),
        ],
      );
      projectId = ins.rows[0].id;
    }

    await client.query(
      `INSERT INTO project_documents (project_id, document, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (project_id) DO UPDATE SET document = EXCLUDED.document, updated_at = now()`,
      [projectId, JSON.stringify(database)],
    );

    // profile defs
    const insertDefs = async (profileType, items) => {
      if (!Array.isArray(items)) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || item.name == null) continue;
        await client.query(
          `INSERT INTO profile_field_defs
            (project_id, profile_type, name, field_type, default_value, player_access, do_export, show_in_role_grid, sort_order)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
          [
            projectId,
            profileType,
            item.name,
            item.type,
            JSON.stringify(item.value ?? ''),
            item.playerAccess || 'write',
            !!item.doExport,
            !!item.showInRoleGrid,
            i,
          ],
        );
      }
    };
    await insertDefs('character', database.CharacterProfileStructure);
    await insertDefs('player', database.PlayerProfileStructure);
    await insertDefs('questionnaire', database.QuestionnaireStructure);

    const charIds = {};
    for (const [name, fields] of Object.entries(database.Characters || {})) {
      const { name: _n, ...rest } = fields || {};
      const r = await client.query(
        `INSERT INTO characters (project_id, name, fields) VALUES ($1,$2,$3::jsonb) RETURNING id`,
        [projectId, name, JSON.stringify({ ...rest, name })],
      );
      charIds[name] = r.rows[0].id;
    }

    const playerIds = {};
    for (const [name, fields] of Object.entries(database.Players || {})) {
      const { name: _n, ...rest } = fields || {};
      const r = await client.query(
        `INSERT INTO players (project_id, name, fields) VALUES ($1,$2,$3::jsonb) RETURNING id`,
        [projectId, name, JSON.stringify({ ...rest, name })],
      );
      playerIds[name] = r.rows[0].id;
    }

    for (const [name, fields] of Object.entries(database.Questionnaires || {})) {
      const { name: _n, ...rest } = fields || {};
      await client.query(
        `INSERT INTO questionnaires (project_id, name, fields) VALUES ($1,$2,$3::jsonb)`,
        [projectId, name, JSON.stringify({ ...rest, name })],
      );
    }

    for (const [charName, playerName] of Object.entries(database.ProfileBindings || {})) {
      if (charIds[charName] && playerIds[playerName]) {
        await client.query(
          `INSERT INTO profile_bindings (project_id, character_id, player_id) VALUES ($1,$2,$3)`,
          [projectId, charIds[charName], playerIds[playerName]],
        );
      }
    }

    for (const [storyName, story] of Object.entries(database.Stories || {})) {
      const sr = await client.query(
        `INSERT INTO stories (project_id, name, master_text) VALUES ($1,$2,$3) RETURNING id`,
        [projectId, storyName, story.story || ''],
      );
      const storyId = sr.rows[0].id;
      for (const [cName, sc] of Object.entries(story.characters || {})) {
        if (!charIds[cName]) continue;
        await client.query(
          `INSERT INTO story_characters (story_id, character_id, inventory, activity)
           VALUES ($1,$2,$3,$4::jsonb)`,
          [storyId, charIds[cName], sc.inventory || '', JSON.stringify(sc.activity || {})],
        );
      }
      const events = story.events || [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const er = await client.query(
          `INSERT INTO story_events (story_id, sort_order, name, text, time) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [storyId, i, ev.name || '', ev.text || '', ev.time || ''],
        );
        const eventId = er.rows[0].id;
        for (const [cName, ad] of Object.entries(ev.characters || {})) {
          if (!charIds[cName]) continue;
          await client.query(
            `INSERT INTO event_adaptations (event_id, character_id, text, time, ready)
             VALUES ($1,$2,$3,$4,$5)`,
            [eventId, charIds[cName], ad.text || '', ad.time || '', !!ad.ready],
          );
        }
      }
    }

    for (const rel of database.Relations || []) {
      if (!charIds[rel.starter] || !charIds[rel.ender]) continue;
      const rr = await client.query(
        `INSERT INTO relations (project_id, starter_id, ender_id, origin, essence, starter_text_ready, ender_text_ready)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          projectId,
          charIds[rel.starter],
          charIds[rel.ender],
          rel.origin || '',
          rel.essence || [],
          !!rel.starterTextReady,
          !!rel.enderTextReady,
        ],
      );
      const relationId = rr.rows[0].id;
      for (const cName of [rel.starter, rel.ender]) {
        const text = typeof rel[cName] === 'string' ? rel[cName] : '';
        if (charIds[cName]) {
          await client.query(
            `INSERT INTO relation_texts (relation_id, character_id, text) VALUES ($1,$2,$3)`,
            [relationId, charIds[cName], text],
          );
        }
      }
    }

    for (const [gName, g] of Object.entries(database.Groups || {})) {
      const gr = await client.query(
        `INSERT INTO groups (project_id, name, master_description, character_description, do_export, filter_model)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
        [
          projectId,
          gName,
          g.masterDescription || '',
          g.characterDescription || '',
          g.doExport !== false,
          JSON.stringify(g.filterModel || []),
        ],
      );
      const groupId = gr.rows[0].id;
      for (const m of g.members || []) {
        if (charIds[m]) {
          await client.query(
            `INSERT INTO group_members (group_id, character_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [groupId, charIds[m]],
          );
        }
      }
    }

    const gears = database.Gears || { nodes: [], edges: [], settings: {} };
    await client.query(
      `INSERT INTO gears_settings (project_id, settings) VALUES ($1,$2::jsonb)
       ON CONFLICT (project_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
      [projectId, JSON.stringify(gears.settings || {})],
    );
    for (const node of gears.nodes || []) {
      await client.query(
        `INSERT INTO gears_nodes (project_id, node_key, payload) VALUES ($1,$2,$3::jsonb)`,
        [projectId, String(node.id), JSON.stringify(node)],
      );
    }
    for (const edge of gears.edges || []) {
      await client.query(
        `INSERT INTO gears_edges (project_id, edge_key, payload) VALUES ($1,$2,$3::jsonb)`,
        [projectId, String(edge.id), JSON.stringify(edge)],
      );
    }

    const sliders = database.Sliders || [];
    for (let i = 0; i < sliders.length; i++) {
      const s = sliders[i];
      if (!s) continue;
      await client.query(
        `INSERT INTO sliders (project_id, sort_order, name, top, bottom, value) VALUES ($1,$2,$3,$4,$5,$6)`,
        [projectId, i, s.name || '', s.top || '', s.bottom || '', s.value ?? 0],
      );
    }

    // accounts + memberships + ownership
    const usersInfo = mi.UsersInfo || {};
    const playersInfo = mi.PlayersInfo || {};
    const admins = new Set([...(mi.admins || []), mi.admin].filter(Boolean));
    const editors = new Set([...(mi.editors || []), mi.editor].filter(Boolean));

    const ensureAccount = async (username, info, kind) => {
      const found = await client.query('SELECT id FROM accounts WHERE username = $1', [username]);
      let accountId;
      if (found.rows.length) {
        accountId = found.rows[0].id;
        if (info && (info.salt || info.hashedPassword)) {
          await client.query(
            `UPDATE accounts SET salt = COALESCE($2, salt), password_hash = COALESCE($3, password_hash),
              kind = $4, updated_at = now() WHERE id = $1`,
            [accountId, info.salt || null, info.hashedPassword || null, kind],
          );
        }
      } else {
        const ins = await client.query(
          `INSERT INTO accounts (username, salt, password_hash, kind) VALUES ($1,$2,$3,$4) RETURNING id`,
          [username, info?.salt || null, info?.hashedPassword || null, kind],
        );
        accountId = ins.rows[0].id;
      }
      await client.query(
        `INSERT INTO project_memberships (project_id, account_id, is_admin, is_editor, player_profile_name)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, account_id) DO UPDATE SET
           is_admin = EXCLUDED.is_admin, is_editor = EXCLUDED.is_editor,
           player_profile_name = COALESCE(EXCLUDED.player_profile_name, project_memberships.player_profile_name),
           updated_at = now()`,
        [
          projectId,
          accountId,
          admins.has(username),
          editors.has(username),
          kind === 'player' || kind === 'both' ? (info?.profileName || null) : null,
        ],
      );
      return accountId;
    };

    for (const [username, info] of Object.entries(usersInfo)) {
      if (!info) continue;
      const accountId = await ensureAccount(username, info, playersInfo[username] ? 'both' : 'organizer');
      const typeMap = { characters: 'character', stories: 'story', groups: 'group', players: 'player' };
      for (const entityType of ['characters', 'stories', 'groups', 'players']) {
        for (const entityName of info[entityType] || []) {
          await client.query(
            `INSERT INTO entity_ownership (project_id, entity_type, entity_name, account_id)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [projectId, typeMap[entityType], entityName, accountId],
          );
        }
      }
    }
    for (const [username, info] of Object.entries(playersInfo)) {
      if (usersInfo[username]) continue;
      await ensureAccount(username, info, 'player');
    }

    if (opts.baselineRevision) {
      const revCheck = await client.query(
        `SELECT 1 FROM entity_revisions WHERE project_id = $1 AND entity_type = 'project' AND entity_id = $2 AND reason = 'import' LIMIT 1`,
        [projectId, String(projectId)],
      );
      if (!revCheck.rows.length) {
        await client.query(
          `INSERT INTO entity_revisions (project_id, entity_type, entity_id, revision, snapshot, command, reason)
           VALUES ($1,'project',$2,1,$3::jsonb,'import','import')`,
          [projectId, String(projectId), JSON.stringify({ slug, meta })],
        );
      }
    }

    await client.query('COMMIT');
    return projectId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function loadDatabaseFromProject(client, slug) {
  const pr = await client.query('SELECT id FROM projects WHERE slug = $1 AND archived_at IS NULL', [slug]);
  if (!pr.rows.length) return null;
  const projectId = pr.rows[0].id;
  const doc = await client.query('SELECT document FROM project_documents WHERE project_id = $1', [projectId]);
  if (!doc.rows.length) return null;
  return { projectId, database: doc.rows[0].document };
}

async function listProjectSlugs(client) {
  const r = await client.query(
    `SELECT slug FROM projects WHERE archived_at IS NULL ORDER BY id`,
  );
  return r.rows.map((x) => x.slug);
}

async function getAccountAuth(client, username) {
  const r = await client.query(
    `SELECT a.id, a.username, a.salt, a.password_hash, a.kind,
            m.project_id, m.is_admin, m.is_editor, m.player_profile_name, p.slug AS project_slug
     FROM accounts a
     LEFT JOIN project_memberships m ON m.account_id = a.id
     LEFT JOIN projects p ON p.id = m.project_id AND p.archived_at IS NULL
     WHERE a.username = $1
     ORDER BY m.id NULLS LAST`,
    [username],
  );
  return r.rows;
}

module.exports = {
  getPool,
  withClient,
  saveDatabaseToProject,
  loadDatabaseFromProject,
  listProjectSlugs,
  getAccountAuth,
};
