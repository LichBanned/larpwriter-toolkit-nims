'use strict';

/**
 * Multi-project helpers: list/create/archive/join + membership role.
 */

async function listProjectsForUser(client, { username, isServerAdmin, includeJoinable }) {
  if (isServerAdmin) {
    const r = await client.query(
      `SELECT p.id, p.slug, p.name, p.description, p.archived_at, p.updated_at,
              NULL::text AS member_role, NULL::text AS membership_status,
              true AS is_admin, false AS is_editor
       FROM projects p
       ORDER BY p.archived_at NULLS FIRST, p.id`,
    );
    return r.rows;
  }
  const mine = await client.query(
    `SELECT p.id, p.slug, p.name, p.description, p.archived_at, p.updated_at,
            m.member_role, m.status AS membership_status, m.is_admin, m.is_editor
     FROM projects p
     JOIN project_memberships m ON m.project_id = p.id
     JOIN accounts a ON a.id = m.account_id
     WHERE a.username = $1 AND m.status = 'active' AND p.archived_at IS NULL
     ORDER BY p.id`,
    [username],
  );
  const rows = [...mine.rows];
  if (includeJoinable) {
    const joinable = await client.query(
      `SELECT p.id, p.slug, p.name, p.description, p.archived_at, p.updated_at,
              NULL::text AS member_role, NULL::text AS membership_status,
              false AS is_admin, false AS is_editor
       FROM projects p
       WHERE p.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM project_memberships m
           JOIN accounts a ON a.id = m.account_id
           WHERE m.project_id = p.id AND a.username = $1 AND m.status = 'active'
         )
       ORDER BY p.id`,
      [username],
    );
    for (const row of joinable.rows) {
      rows.push({ ...row, joinable: true });
    }
  }
  return rows;
}

async function createProject(client, { slug, name, description, creatorUsername }) {
  const ins = await client.query(
    `INSERT INTO projects (slug, name, description)
     VALUES ($1,$2,$3)
     RETURNING id, slug, name, description, archived_at, updated_at`,
    [slug, name || slug, description || ''],
  );
  const project = ins.rows[0];
  if (creatorUsername) {
    const acc = await client.query(`SELECT id FROM accounts WHERE username = $1`, [creatorUsername]);
    if (acc.rows.length) {
      await client.query(
        `INSERT INTO project_memberships
          (project_id, account_id, is_admin, is_editor, status, member_role)
         VALUES ($1,$2,true,true,'active','organizer')
         ON CONFLICT (project_id, account_id) DO UPDATE SET
           is_admin = true, is_editor = true, status = 'active', member_role = 'organizer'`,
        [project.id, acc.rows[0].id],
      );
    }
  }
  await client.query(
    `INSERT INTO project_documents (project_id, document)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (project_id) DO NOTHING`,
    [project.id, JSON.stringify({
      Version: '0.8.0',
      Meta: { name: name || slug, description: description || '', date: '', preGameDate: '', saveTime: '' },
      Characters: {},
      Players: {},
      Stories: {},
      Groups: {},
      Relations: [],
      CharacterProfileStructure: [],
      PlayerProfileStructure: [],
      QuestionnaireStructure: [],
      ProfileBindings: {},
      ManagementInfo: {
        UsersInfo: {},
        PlayersInfo: {},
        admins: creatorUsername ? [creatorUsername] : [],
        editors: [],
        adaptationRights: 'ByStory',
        WelcomeText: '',
        PlayersOptions: { allowPlayerCreation: false, allowCharacterCreation: false, allowRoleGridView: true },
      },
      Settings: {},
      Gears: { nodes: [], edges: [], settings: {} },
      Sliders: [],
    })],
  );
  return project;
}

async function archiveProject(client, { slug }) {
  const r = await client.query(
    `UPDATE projects SET archived_at = now(), updated_at = now()
     WHERE slug = $1 AND archived_at IS NULL
     RETURNING id, slug, name, archived_at`,
    [slug],
  );
  return r.rows[0] || null;
}

async function getMembershipForUser(client, { username, slug }) {
  const r = await client.query(
    `SELECT a.id AS account_id, a.username, a.kind, a.is_server_admin,
            m.project_id, m.is_admin, m.is_editor, m.player_profile_name,
            m.status, m.member_role, p.slug AS project_slug, p.name AS project_name
     FROM accounts a
     LEFT JOIN project_memberships m ON m.account_id = a.id
     LEFT JOIN projects p ON p.id = m.project_id AND p.slug = $2 AND p.archived_at IS NULL
     WHERE a.username = $1
     ORDER BY (p.slug = $2) DESC NULLS LAST, m.id NULLS LAST`,
    [username, slug],
  );
  if (!r.rows.length) return null;
  const base = r.rows[0];
  const membership = r.rows.find((row) => row.project_slug === slug && row.status === 'active');
  return {
    accountId: base.account_id,
    username: base.username,
    kind: base.kind,
    isServerAdmin: !!base.is_server_admin,
    membership: membership || null,
  };
}

function roleFromMembership(membership, isServerAdmin) {
  if (!membership) {
    return isServerAdmin ? 'organizer' : null;
  }
  if (membership.member_role === 'player') return 'player';
  return 'organizer';
}

async function requestProjectJoin(client, { username, slug }) {
  const pr = await client.query(
    `SELECT id FROM projects WHERE slug = $1 AND archived_at IS NULL`,
    [slug],
  );
  if (!pr.rows.length) throw new Error('project-not-found');
  const projectId = pr.rows[0].id;
  let acc = await client.query(`SELECT id, kind FROM accounts WHERE username = $1`, [username]);
  if (!acc.rows.length) {
    const ins = await client.query(
      `INSERT INTO accounts (username, kind) VALUES ($1,'player') RETURNING id, kind`,
      [username],
    );
    acc = ins;
  }
  const accountId = acc.rows[0].id;
  await client.query(
    `INSERT INTO project_memberships
      (project_id, account_id, is_admin, is_editor, status, member_role, player_profile_name)
     VALUES ($1,$2,false,false,'active','player',$3)
     ON CONFLICT (project_id, account_id) DO UPDATE SET
       status = 'active',
       member_role = CASE
         WHEN project_memberships.member_role = 'organizer' THEN 'organizer'
         ELSE 'player'
       END,
       updated_at = now()`,
    [projectId, accountId, username],
  );
  return { projectId, slug, status: 'active', memberRole: 'player' };
}

async function setAccountServerAdmin(client, username, value) {
  const r = await client.query(
    `UPDATE accounts SET is_server_admin = $2, updated_at = now()
     WHERE username = $1 RETURNING id, username, is_server_admin`,
    [username, !!value],
  );
  if (r.rows[0]) return r.rows[0];
  const ins = await client.query(
    `INSERT INTO accounts (username, kind, is_server_admin)
     VALUES ($1, 'organizer', $2)
     RETURNING id, username, is_server_admin`,
    [username, !!value],
  );
  return ins.rows[0] || null;
}

async function mergeActivePlayerMemberships(client, slug, database) {
  const r = await client.query(
    `SELECT a.username, m.player_profile_name
     FROM project_memberships m
     JOIN accounts a ON a.id = m.account_id
     JOIN projects p ON p.id = m.project_id
     WHERE p.slug = $1 AND m.status = 'active' AND m.member_role = 'player'`,
    [slug],
  );
  database.ManagementInfo = database.ManagementInfo || {};
  database.ManagementInfo.PlayersInfo = database.ManagementInfo.PlayersInfo || {};
  for (const row of r.rows) {
    const uname = row.username;
    if (!database.ManagementInfo.PlayersInfo[uname]) {
      database.ManagementInfo.PlayersInfo[uname] = {
        name: uname,
        profileName: row.player_profile_name || '',
      };
    }
  }
  // Drop players without active membership (except those already in Players profiles created in-game)
  const allowed = new Set(r.rows.map((x) => x.username));
  for (const uname of Object.keys(database.ManagementInfo.PlayersInfo)) {
    if (!allowed.has(uname)) {
      // keep if they have a player profile entity owned in this base
      const hasProfile = database.Players && database.Players[uname];
      if (!hasProfile) delete database.ManagementInfo.PlayersInfo[uname];
    }
  }
}

module.exports = {
  listProjectsForUser,
  createProject,
  archiveProject,
  getMembershipForUser,
  roleFromMembership,
  requestProjectJoin,
  setAccountServerAdmin,
  mergeActivePlayerMemberships,
};
