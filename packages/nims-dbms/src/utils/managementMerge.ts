import type { ManagementInfo } from '../domain/types';

/** Remove login secrets from ManagementInfo user maps (mutate in place). */
export function stripUserCredentials(mi: ManagementInfo | undefined | null): boolean {
  if (!mi || typeof mi !== 'object') return false;
  let changed = false;
  for (const info of Object.values((mi.UsersInfo || {}) as Record<string, Record<string, unknown>>)) {
    if (!info || typeof info !== 'object') continue;
    if ('salt' in info || 'hashedPassword' in info) {
      delete info.salt;
      delete info.hashedPassword;
      changed = true;
    }
  }
  for (const info of Object.values((mi.PlayersInfo || {}) as Record<string, Record<string, unknown>>)) {
    if (!info || typeof info !== 'object') continue;
    if ('salt' in info || 'hashedPassword' in info) {
      delete info.salt;
      delete info.hashedPassword;
      changed = true;
    }
  }
  return changed;
}

/**
 * Content-only import: drop organizers/players from a JSON dump so accounts are never
 * created/updated from the file. Keeps WelcomeText / PlayersOptions / adaptationRights.
 */
export function scrubUsersFromImportedDatabase<T extends { ManagementInfo?: ManagementInfo }>(
  database: T,
): T {
  const mi = database.ManagementInfo;
  if (!mi || typeof mi !== 'object') return database;
  mi.UsersInfo = {} as ManagementInfo['UsersInfo'];
  mi.PlayersInfo = {} as ManagementInfo['PlayersInfo'];
  (mi as Record<string, unknown>).admins = [];
  (mi as Record<string, unknown>).editors = [];
  (mi as Record<string, unknown>).admin = '';
  (mi as Record<string, unknown>).editor = '';
  stripUserCredentials(mi);
  return database;
}

/**
 * When importing game JSON with preserveManagementInfo: keep current users/roles as-is.
 * Do not merge organizers/players/admins from the uploaded file (accounts live elsewhere).
 */
export function mergeManagementInfo(
  existing: ManagementInfo | undefined,
  incoming: ManagementInfo | undefined,
): ManagementInfo {
  if (existing && typeof existing === 'object') {
    return structuredClone(existing);
  }
  const next = structuredClone(incoming || {}) as ManagementInfo;
  stripUserCredentials(next);
  return next;
}
