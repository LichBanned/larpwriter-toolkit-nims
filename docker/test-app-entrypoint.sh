#!/bin/sh
set -e
cd /app
export DATABASE_URL="${DATABASE_URL:-postgres://nims:nims@postgres:5432/nims_test}"
echo "[app] migrate..."
node packages/nims-dbms/scripts/migrate.js

# Ensure server-admin account exists before boot (so login gets isServerAdmin).
# Run from nims-dbms so `pg` resolves from that package.
(cd packages/nims-dbms && node <<'NODE'
const { Client } = require('pg');
const crypto = require('crypto');
(async () => {
  const login = process.env.NIMS_ADMIN_LOGIN || 'admin';
  const pass = process.env.NIMS_ADMIN_PASS || 'TestAdmin1!';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const saltHex = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pass, saltHex, 64).toString('hex');
  const salt = `scrypt$${saltHex}`;
  await client.query(
    `INSERT INTO accounts (username, salt, password_hash, kind, is_server_admin)
     VALUES ($1,$2,$3,'organizer',true)
     ON CONFLICT (username) DO UPDATE SET
       is_server_admin = true,
       salt = COALESCE(accounts.salt, EXCLUDED.salt),
       password_hash = COALESCE(accounts.password_hash, EXCLUDED.password_hash),
       updated_at = now()`,
    [login, salt, hash],
  );
  await client.query(
    `UPDATE accounts SET salt=$2, password_hash=$3, updated_at=now()
     WHERE username=$1 AND (salt IS NULL OR password_hash IS NULL)`,
    [login, salt, hash],
  );
  console.log('[app] server-admin account ensured:', login);
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
NODE
)

echo "[app] start server..."
cd packages/nims-server
exec node ./bin/www \
  --configFile config/nims-frontend-prod.json \
  --globalConfigFile config/nims-frontend-global.json
