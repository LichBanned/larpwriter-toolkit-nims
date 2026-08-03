import type { DatabaseEngine } from './DatabaseEngine';
import type { Database, GameMeta } from '../domain/types';
import { ensureString, ensureEnum } from '../utils/precondition';
import { META_INFO_STRINGS, META_INFO_DATES } from '../utils/constants';
import { ensureDatabaseDefaults } from '../utils/defaults';
import { mergeManagementInfo, stripUserCredentials } from '../utils/managementMerge';

export class MetaEngine {
  constructor(private engine: DatabaseEngine) {}

  async getDatabase(): Promise<Database> {
    if (this.engine.database.Meta) {
      this.engine.database.Meta.saveTime = new Date().toString();
    }
    const dump = structuredClone(this.engine.database);
    // Public dump / export: never include login secrets. In-memory MI stays intact
    // (json-mode auth + local autosave read db.database directly).
    stripUserCredentials(dump.ManagementInfo);
    return dump;
  }

  /**
   * Replace game content.
   * By default keeps current ManagementInfo users/roles untouched (no merge from file).
   * Pass preserveManagementInfo: false to take ManagementInfo from the file as-is (server boot).
   */
  async setDatabase({
    database,
    preserveManagementInfo = true,
  }: {
    database: Database;
    preserveManagementInfo?: boolean;
  }): Promise<void> {
    const currentMgmt = this.engine.database?.ManagementInfo;
    const next = ensureDatabaseDefaults(database);
    if (preserveManagementInfo) {
      next.ManagementInfo = mergeManagementInfo(currentMgmt, next.ManagementInfo);
    }
    this.engine.database = next;
    this.engine.ee.emit('setDatabase', [{ database: next }]);
  }

  async getMetaInfo(): Promise<GameMeta> {
    return structuredClone(this.engine.database.Meta);
  }

  async setMetaInfoString({ name, value }: { name: string; value: string }): Promise<void> {
    ensureString(name, 'name');
    ensureEnum(name, META_INFO_STRINGS, 'name');
    ensureString(value, 'value');
    (this.engine.database.Meta as unknown as Record<string, string>)[name] = value;
  }

  async setMetaInfoDate({ name, value }: { name: string; value: string }): Promise<void> {
    ensureString(name, 'name');
    ensureEnum(name, META_INFO_DATES, 'name');
    ensureString(value, 'value');
    (this.engine.database.Meta as unknown as Record<string, string>)[name] = value;
  }
}
