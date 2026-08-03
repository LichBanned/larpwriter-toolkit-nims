import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectStore } from './ProjectStore';

function makeRoot(overrides: any = {}) {
  const root: any = {
    auth: {
      user: { name: 'admin', role: 'organizer', projectSlug: null, isServerAdmin: true },
      isLoggedIn: true,
      isServerAdmin: true,
      ...(overrides.auth || {}),
    },
    api: {
      get: vi.fn(),
      call: vi.fn(),
    },
    permissions: {
      clear: vi.fn(),
      load: vi.fn().mockResolvedValue(undefined),
    },
    meta: {
      load: vi.fn().mockResolvedValue(undefined),
    },
  };
  return root;
}

describe('ProjectStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('needsProjectSelection when logged in without slug', () => {
    const root = makeRoot({
      auth: {
        isServerAdmin: false,
        user: { name: 'u', role: 'organizer', projectSlug: null },
      },
    });
    root.auth.isLoggedIn = true;
    root.auth.isServerAdmin = false;
    const store = new ProjectStore(root);
    expect(store.needsProjectSelection).toBe(true);
  });

  it('needsProjectSelection false for server-admin with slug', () => {
    const root = makeRoot();
    root.auth.user.projectSlug = 'main';
    root.auth.isServerAdmin = true;
    const store = new ProjectStore(root);
    expect(store.needsProjectSelection).toBe(false);
    expect(store.currentSlug).toBe('main');
  });

  it('load sets projects and handles errors', async () => {
    const root = makeRoot();
    root.api.get.mockResolvedValueOnce([{ slug: 'a', name: 'A', id: 1 }]);
    const store = new ProjectStore(root);
    await store.load(true);
    expect(store.projects).toHaveLength(1);

    root.api.get.mockRejectedValueOnce(new Error('fail'));
    await store.load(true);
    expect(store.projects).toEqual([]);
    expect(store.lastError).toMatch(/fail/);
  });

  it('beginSwitch replaces location with ?project=', () => {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });
    const store = new ProjectStore(makeRoot());
    store.beginSwitch('alpha');
    expect(replace).toHaveBeenCalled();
    expect(String(replace.mock.calls[0][0])).toContain('project=alpha');
  });

  it('select with reloadPage false patches user and loads permissions/meta', async () => {
    const root = makeRoot();
    root.auth.user = {
      name: 'admin', role: 'organizer', projectSlug: null, isServerAdmin: true,
    };
    root.api.call.mockImplementation(async () => ({
      slug: 'beta', role: 'organizer', projectId: 2, isServerAdmin: true,
    }));
    const store = new ProjectStore(root);
    const result = await store.select('beta', { reloadPage: false });
    expect(result.slug).toBe('beta');
    expect(root.auth.user.projectSlug).toBe('beta');
    expect(root.permissions.clear).toHaveBeenCalled();
    expect(root.permissions.load).toHaveBeenCalled();
    expect(root.meta.load).toHaveBeenCalled();
  });

  it('select with reload triggers beginSwitch', async () => {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });
    const root = makeRoot();
    root.api.call.mockResolvedValue({ slug: 'g', role: 'organizer' });
    const store = new ProjectStore(root);
    await store.select('g');
    expect(replace).toHaveBeenCalled();
  });

  it('select failure with reload still beginSwitch then rethrows', async () => {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });
    const root = makeRoot();
    root.api.call.mockRejectedValue(new Error('nope'));
    const store = new ProjectStore(root);
    await expect(store.select('x')).rejects.toThrow(/nope/);
    expect(replace).toHaveBeenCalled();
  });

  it('join and create and archive', async () => {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });
    const root = makeRoot();
    root.api.call.mockResolvedValue({ slug: 'j', role: 'player' });
    root.api.get.mockResolvedValue([{ slug: 'j', id: 1, name: 'J' }]);
    const store = new ProjectStore(root);
    await store.join('j');
    expect(root.api.call).toHaveBeenCalledWith('requestProjectJoin', { slug: 'j' });

    root.api.call.mockResolvedValue({ slug: 'c', role: 'organizer' });
    await store.create('c', 'C');
    expect(root.api.call).toHaveBeenCalledWith('createProject', { slug: 'c', name: 'C' });

    await store.archive('c');
    expect(root.api.call).toHaveBeenCalledWith('archiveProject', { slug: 'c' });
  });
});
