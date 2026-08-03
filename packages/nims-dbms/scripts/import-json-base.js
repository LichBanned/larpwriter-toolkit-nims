#!/usr/bin/env node
/**
 * Import NIMS JSON base into PostgreSQL (content only — does not create/update accounts).
 * Usage:
 *   DATABASE_URL=... node scripts/import-json-base.js --file path.json --slug main
 *   DATABASE_URL=... node scripts/import-json-base.js --file path.json --slug main --sync-accounts
 *     (legacy one-shot: also create accounts/memberships from ManagementInfo)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { saveDatabaseToProject, stripCredentialsFromManagementInfo } = require('../pg/storage');

function parseArgs(argv) {
  const out = { file: null, slug: 'main', syncAccounts: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--file') out.file = argv[++i];
    else if (argv[i] === '--slug') out.slug = argv[++i];
    else if (argv[i] === '--sync-accounts') out.syncAccounts = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Required: --file <path-to-json>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(args.file), 'utf8');
  const database = JSON.parse(raw);
  if (!args.syncAccounts && database.ManagementInfo) {
    database.ManagementInfo.UsersInfo = {};
    database.ManagementInfo.PlayersInfo = {};
    database.ManagementInfo.admins = [];
    database.ManagementInfo.editors = [];
    database.ManagementInfo.admin = '';
    database.ManagementInfo.editor = '';
  }
  stripCredentialsFromManagementInfo(database.ManagementInfo);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const projectId = await saveDatabaseToProject(client, database, args.slug, {
      baselineRevision: true,
      syncAccounts: args.syncAccounts,
    });
    const counts = {
      characters: Object.keys(database.Characters || {}).length,
      players: Object.keys(database.Players || {}).length,
      stories: Object.keys(database.Stories || {}).length,
      relations: (database.Relations || []).length,
      groups: Object.keys(database.Groups || {}).length,
    };
    console.log(JSON.stringify({
      ok: true, projectId, slug: args.slug, syncAccounts: args.syncAccounts, counts,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
