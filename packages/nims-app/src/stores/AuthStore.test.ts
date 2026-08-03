import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthStore } from './AuthStore';

function makeRoot() {
  return {
    projects: {
      select: vi.fn().mockResolvedValue({}),
      load: vi.fn().mockResolvedValue(undefined),
      projects: [] as any[],
    },
    permissions: {
      load: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn(),
    },
  } as any;
}

describe('AuthStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('bootstrap with ?project= calls select reloadPage false', async () => {
    const root = makeRoot();
    vi.stubGlobal('window', {
      location: { search: '?project=gamma', pathname: '/' },
      history: { replaceState: vi.fn() },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { name: 'admin', role: 'organizer', projectSlug: 'main', isServerAdmin: true },
      }),
    }));
    const auth = new AuthStore(root);
    await auth.bootstrap();
    expect(root.projects.select).toHaveBeenCalledWith('gamma', { reloadPage: false });
    expect(root.projects.load).toHaveBeenCalled();
    expect(auth.isLoggedIn).toBe(true);
    expect(auth.isOrganizer).toBe(true);
    expect(auth.isServerAdmin).toBe(true);
    expect(auth.bootstrapping).toBe(false);
  });

  it('bootstrap when anonymous clears permissions', async () => {
    const root = makeRoot();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const auth = new AuthStore(root);
    await auth.bootstrap();
    expect(auth.user).toBeNull();
    expect(root.permissions.clear).toHaveBeenCalled();
  });

  it('fetchMe catch path', async () => {
    const root = makeRoot();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    const auth = new AuthStore(root);
    expect(await auth.fetchMe()).toBe(false);
    expect(auth.user).toBeNull();
  });

  it('login auto-selects single project without reload', async () => {
    const root = makeRoot();
    root.projects.projects = [{ slug: 'only', joinable: false }];
    const auth = new AuthStore(root);
    (root as any).auth = auth;
    root.projects.select.mockImplementation(async (slug: string) => {
      if (auth.user) auth.user.projectSlug = slug;
      return { slug };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { name: 'u', role: 'organizer', projectSlug: null, isServerAdmin: false },
      }),
    }));
    const ok = await auth.login('u', 'p');
    expect(ok).toBe(true);
    expect(root.projects.select).toHaveBeenCalledWith('only', { reloadPage: false });
    expect(auth.user?.projectSlug).toBe('only');
    expect(root.permissions.load).toHaveBeenCalled();
  });

  it('login failure sets lastError', async () => {
    const root = makeRoot();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'bad' }),
    }));
    const auth = new AuthStore(root);
    expect(await auth.login('u', 'p')).toBe(false);
    expect(auth.lastError).toBe('bad');
  });

  it('login rejects malformed user payload', async () => {
    const root = makeRoot();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: {} }),
    }));
    const auth = new AuthStore(root);
    expect(await auth.login('u', 'p')).toBe(false);
    expect(root.permissions.clear).toHaveBeenCalled();
  });

  it('login network error', async () => {
    const root = makeRoot();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const auth = new AuthStore(root);
    expect(await auth.login('u', 'p')).toBe(false);
    expect(auth.lastError).toMatch(/down/);
  });

  it('signUp success and failure', async () => {
    const root = makeRoot();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { name: 'n', role: 'player', projectSlug: 'p1' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'closed' }),
      }));
    const auth = new AuthStore(root);
    expect(await auth.signUp('n', 'p', 'p')).toBe(true);
    expect(auth.user?.name).toBe('n');
    expect(await auth.signUp('n', 'p', 'p')).toBe(false);
    expect(auth.lastError).toBe('closed');
  });

  it('signUp network error', async () => {
    const root = makeRoot();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')));
    const auth = new AuthStore(root);
    expect(await auth.signUp('n', 'p', 'p')).toBe(false);
    expect(root.permissions.clear).toHaveBeenCalled();
  });

  it('logout clears user and projects', async () => {
    const root = makeRoot();
    const projectsBag = root.projects;
    projectsBag.projects = [{ slug: 'a' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const auth = new AuthStore(root);
    auth.user = { name: 'a', role: 'organizer' };
    await auth.logout();
    expect(auth.user).toBeNull();
    expect(projectsBag.projects).toEqual([]);
    expect(root.permissions.clear).toHaveBeenCalled();
  });

  it('clearSession nulls user', () => {
    const root = makeRoot();
    const auth = new AuthStore(root);
    auth.user = { name: 'a', role: 'organizer' };
    auth.clearSession();
    expect(auth.user).toBeNull();
  });
});
