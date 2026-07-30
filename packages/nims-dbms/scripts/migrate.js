#!/usr/bin/env node
/**
 * Apply ordered SQL migrations from packages/nims-dbms/migrations.
 * Usage: DATABASE_URL=postgres://... node scripts/migrate.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const migrationsDir = path.resolve(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        filename    text NOT NULL UNIQUE,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip ${file}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`apply ${file}...`);
      await client.query('BEGIN');
      try {
        // 001_init.sql has its own BEGIN/COMMIT — strip outer transaction wrappers if present
        const body = sql
          .replace(/^\s*BEGIN\s*;/i, '')
          .replace(/\s*COMMIT\s*;\s*$/i, '');
        await client.query(body);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`ok ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('migrations complete');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
