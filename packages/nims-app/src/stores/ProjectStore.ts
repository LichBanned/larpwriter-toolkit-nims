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
    let result: {
      slug: string;
      role: string;
      projectId?: number | string;
      isServerAdmin?: boolean;
      name?: string;
    } | undefined;
    try {
      result = await this.root.api.call<{
        slug: string;
        role: string;
        projectId?: number | string;
        isServerAdmin?: boolean;
        name?: string;
      }>('setCurrentProject', { slug });
    } catch (e) {
      // Still try hard reload if session may have changed server-side.
      if (reloadPage && typeof window !== 'undefined') {
        window.location.href = `/?project=${encodeURIComponent(slug)}&_=${Date.now()}`;
      }
      throw e;
    }
    runInAction(() => {
      if (this.root.auth.user && result) {
        this.root.auth.user = {
          ...this.root.auth.user,
          role: result.role || this.root.auth.user.role,
          projectSlug: result.slug || slug,
          projectId: result.projectId ?? this.root.auth.user.projectId,
          isServerAdmin: result.isServerAdmin ?? this.root.auth.user.isServerAdmin,
        };
      } else if (this.root.auth.user) {
        this.root.auth.user = {
          ...this.root.auth.user,
          projectSlug: slug,
        };
      }
    });
    this.root.permissions.clear();
    // Force a real navigation even when already on "/".
    if (reloadPage && typeof window !== 'undefined') {
      window.location.href = `/?project=${encodeURIComponent(slug)}&_=${Date.now()}`;
      return result as NonNullable<typeof result>;
    }
    await this.root.permissions.load();
    await this.root.meta.load();
    return result as NonNullable<typeof result>;
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
