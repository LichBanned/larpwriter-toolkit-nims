import { makeAutoObservable, runInAction } from 'mobx';
import type { RootStore } from './RootStore';

export type ProjectRow = {
  id: number | string;
  slug: string;
  name: string;
  description?: string;
  archived_at?: string | null;
  member_role?: string | null;
  membership_status?: string | null;
  is_admin?: boolean;
  is_editor?: boolean;
  joinable?: boolean;
};

export class ProjectStore {
  projects: ProjectRow[] = [];
  loading = false;
  lastError: string | null = null;

  constructor(private root: RootStore) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get currentSlug() {
    return this.root.auth.user?.projectSlug || null;
  }

  get needsProjectSelection() {
    if (!this.root.auth.isLoggedIn) return false;
    if (this.root.auth.user?.isServerAdmin && this.currentSlug) return false;
    return !this.currentSlug;
  }

  async load(includeJoinable = true) {
    this.loading = true;
    this.lastError = null;
    try {
      const rows = await this.root.api.get<ProjectRow[]>('listProjects', { includeJoinable });
      runInAction(() => {
        this.projects = Array.isArray(rows) ? rows : [];
      });
    } catch (e: any) {
      runInAction(() => {
        this.lastError = e?.message || 'Не удалось загрузить проекты';
        this.projects = [];
      });
    } finally {
      runInAction(() => { this.loading = false; });
    }
  }

  async select(slug: string, opts: { reloadPage?: boolean } = {}) {
    const reloadPage = opts.reloadPage !== false;
    const result = await this.root.api.call<{
      slug: string;
      role: string;
      projectId?: number | string;
      isServerAdmin?: boolean;
      name?: string;
    }>('setCurrentProject', { slug });
    runInAction(() => {
      if (this.root.auth.user) {
        this.root.auth.user = {
          ...this.root.auth.user,
          role: result.role || this.root.auth.user.role,
          projectSlug: result.slug,
          projectId: result.projectId ?? this.root.auth.user.projectId,
          isServerAdmin: result.isServerAdmin ?? this.root.auth.user.isServerAdmin,
        };
      }
    });
    this.root.permissions.clear();
    // Full reload so shells/stores remount against the new project engine.
    if (reloadPage && typeof window !== 'undefined') {
      window.location.assign('/');
      return result;
    }
    await this.root.permissions.load();
    await this.root.meta.load();
    return result;
  }

  async join(slug: string) {
    await this.root.api.call('requestProjectJoin', { slug });
    await this.load(true);
    return this.select(slug);
  }

  async create(slug: string, name?: string) {
    await this.root.api.call('createProject', { slug, name: name || slug });
    await this.load(false);
    return this.select(slug);
  }

  async archive(slug: string) {
    await this.root.api.call('archiveProject', { slug });
    await this.load(false);
  }
}
