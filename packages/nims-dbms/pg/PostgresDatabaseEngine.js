'use strict';

/**
 * Transitional PostgresDatabaseEngine: full API parity via in-memory DatabaseEngine
 * + caller-supplied write-through persist (see ADR_POSTGRES.md).
 *
 * Product cutover uses createServerDbms() on the server; this module documents the
 * contract and provides attachWriteThrough() for tests and alternate hosts.
 */

const { createServerDbms } = require('../dist');

/**
 * @param {object} emptyDatabase
 * @param {{ adminLogin?: string, adminPass?: string }} [ensureAdmin]
 * @param {(database: object) => Promise<void>} [onPersist]
 */
function createPostgresDatabaseEngine(emptyDatabase, ensureAdmin, onPersist) {
  const db = createServerDbms(emptyDatabase, ensureAdmin);
  if (typeof onPersist === 'function') {
    attachWriteThrough(db, onPersist);
  }
  return db;
}

/**
 * After setDatabase, persist full project snapshot.
 * Mutating API commands update memory; autosave/host should also call onPersist periodically.
 */
function attachWriteThrough(db, onPersist) {
  const origSetDatabase = db.setDatabase.bind(db);
  db.setDatabase = async (args) => {
    const result = await origSetDatabase(args);
    await onPersist(await db.getDatabase());
    return result;
  };
  return db;
}

module.exports = {
  createPostgresDatabaseEngine,
  attachWriteThrough,
};
