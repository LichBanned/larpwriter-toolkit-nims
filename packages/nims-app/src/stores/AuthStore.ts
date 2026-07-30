import { makeAutoObservable, runInAction } from 'mobx';
import type { RootStore } from './RootStore';

export interface User {
  name: string;
  role: string;
  projectId?: number | string | null;
  projectSlug?: string | null;
  isServerAdmin?: boolean;
}

function mapUser(raw: any): User | null {
  if (!raw?.name) return null;
  return {
    name: raw.name,
    role: raw.role || 'organizer',
    projectId: raw.projectId ?? null,
    projectSlug: raw.projectSlug ?? null,
    isServerAdmin: !!raw.isServerAdmin,
  };
}

export class AuthStore {
  user: User | null = null;
  loading = false;
  /** Initial /me check in progress */
  bootstrapping = true;
  lastError: string | null = null;

  constructor(private root: RootStore) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get isLoggedIn() {
    return this.user !== null;
  }

  get isOrganizer() {
    return this.user?.role === 'organizer';
  }

  get isServerAdmin() {
    return !!this.user?.isServerAdmin;
  }

  async bootstrap() {
    this.bootstrapping = true;
    try {
      const ok = await this.fetchMe();
      if (ok) {
        await this.root.projects.load(true);
        if (this.user?.projectSlug) await this.root.permissions.load();
        else this.root.permissions.clear();
      } else {
        this.root.permissions.clear();
      }
    } finally {
      runInAction(() => { this.bootstrapping = false; });
    }
  }

  async fetchMe(): Promise<boolean> {
    try {
      const res = await fetch('/me', { credentials: 'include' });
      if (!res.ok) {
        runInAction(() => { this.user = null; });
        return false;
      }
      const data = await res.json();
      runInAction(() => {
        this.user = mapUser(data.user);
      });
      return !!this.user;
    } catch {
      runInAction(() => { this.user = null; });
      return false;
    }
  }

  async signUp(username: string, password: string, confirmPassword: string) {
    this.loading = true;
    this.lastError = null;
    try {
      const res = await fetch('/signUp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: JSON.stringify({
          userName: username,
          password,
          confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        runInAction(() => {
          this.user = null;
          this.lastError = data.message || data.error || 'Не удалось зарегистрироваться';
        });
        return false;
      }
      runInAction(() => {
        this.user = mapUser(data.user) || { name: username, role: 'player' };
      });
      await this.root.projects.load(true);
      if (this.user?.projectSlug) await this.root.permissions.load();
      return true;
    } catch (e: any) {
      runInAction(() => {
        this.lastError = e.message || 'Не удалось связаться с сервером';
        this.user = null;
      });
      this.root.permissions.clear();
      return false;
    } finally {
      runInAction(() => { this.loading = false; });
    }
  }

  async login(username: string, password: string) {
    this.loading = true;
    this.lastError = null;
    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: new URLSearchParams({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        runInAction(() => {
          this.user = null;
          this.lastError = data.message || data.error || 'Неверный логин или пароль';
        });
        return false;
      }
      const data = await res.json().catch(() => ({}));
      if (!data.user?.name || !data.user?.role) {
        runInAction(() => {
          this.user = null;
          this.lastError = 'Некорректный ответ сервера при входе';
        });
        this.root.permissions.clear();
        return false;
      }
      runInAction(() => {
        this.user = mapUser(data.user);
      });
      await this.root.projects.load(true);
      if (!this.user?.projectSlug) {
        const mine = this.root.projects.projects.filter((p) => !p.joinable && !p.archived_at);
        if (mine.length === 1) {
          try {
            await this.root.projects.select(mine[0].slug);
          } catch {
            /* stay on picker */
          }
        }
      }
      if (this.user?.projectSlug) await this.root.permissions.load();
      else this.root.permissions.clear();
      return true;
    } catch (e: any) {
      runInAction(() => {
        this.lastError = e.message || 'Не удалось связаться с сервером';
        this.user = null;
      });
      this.root.permissions.clear();
      return false;
    } finally {
      runInAction(() => { this.loading = false; });
    }
  }

  async logout() {
    try {
      await fetch('/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
    } finally {
      runInAction(() => { this.user = null; });
      this.root.permissions.clear();
      this.root.projects.projects = [];
    }
  }

  /** Called when API returns 401 */
  clearSession() {
    this.user = null;
    this.root.permissions.clear();
  }
}
