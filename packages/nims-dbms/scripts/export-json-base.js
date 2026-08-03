#!/usr/bin/env node
/**
 * Export project from PostgreSQL to NIMS JSON Database file.
 * Usage:
 *   DATABASE_URL=... node scripts/export-json-base.js --slug main --out out.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadDatabaseFromProject, stripCredentialsFromManagementInfo } = require('../pg/storage');

function parseArgs(argv) {
  const out = { slug: 'main', out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--slug') out.slug = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.out) {
    console.error('Required: --out <path>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const loaded = await loadDatabaseFromProject(client, args.slug);
    if (!loaded) {
      console.error(`Project not found: ${args.slug}`);
      process.exit(1);
    }
    const outPath = path.resolve(args.out);
    stripCredentialsFromManagementInfo(loaded.database.ManagementInfo);
    fs.writeFileSync(outPath, JSON.stringify(loaded.database, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ ok: true, slug: args.slug, out: outPath, projectId: loaded.projectId }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
