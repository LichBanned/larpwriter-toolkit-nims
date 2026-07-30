#!/usr/bin/env node
/**
 * Cleanup old entity_revisions (keeps import baselines).
 * Usage: DATABASE_URL=... node scripts/cleanup-revisions.js [--slug main] [--keep 50]
 */
'use strict';

const { Client } = require('pg');
const { cleanupOldRevisions } = require('../pg/revisions');

function parseArgs(argv) {
  const out = { slug: 'main', keep: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--slug') out.slug = argv[++i];
    else if (argv[i] === '--keep') out.keep = Number(argv[++i]);
  }
  return out;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const args = parseArgs(process.argv);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await cleanupOldRevisions(client, {
      slug: args.slug,
      keepLast: args.keep,
    });
    console.log(JSON.stringify({ ok: true, ...result, slug: args.slug }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
