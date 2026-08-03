import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionsStore } from './PermissionsStore';

describe('PermissionsStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('load as organizer fills admins/editors', async () => {
    const root: any = {
      auth: {
        isLoggedIn: true,
        user: { name: 'admin', role: 'organizer' },
        isServerAdmin: false,
      },
      api: {
        get: vi.fn().mockResolvedValue({
          admins: ['admin'],
          editors: ['ed'],
          usersInfo: { admin: { characters: [] } },
        }),
      },
    };
    const store = new PermissionsStore(root);
    await store.load();
    expect(store.admins).toEqual(['admin']);
    expect(store.editors).toEqual(['ed']);
    expect(store.isProjectAdmin).toBe(true);
    expect(store.isEditor).toBe(false);
    expect(store.editorModeActive).toBe(true);
    expect(store.canCreateEntities).toBe(false);
    expect(store.canAdminOps).toBe(true);
  });

  it('load as player short-circuits', async () => {
    const root: any = {
      auth: {
        isLoggedIn: true,
        user: { name: 'p', role: 'player' },
        isServerAdmin: false,
      },
      api: { get: vi.fn() },
    };
    const store = new PermissionsStore(root);
    await store.load();
    expect(store.loaded).toBe(true);
    expect(root.api.get).not.toHaveBeenCalled();
    expect(store.isPlayer).toBe(true);
    expect(store.canEditEntity('p')).toBe(false);
    expect(store.contentEditBlockedReason('x')).toMatch(/прав/);
  });

  it('server-admin can edit anything', () => {
    const root: any = {
      auth: {
        isLoggedIn: true,
        user: { name: 'sa', role: 'organizer' },
        isServerAdmin: true,
      },
      api: { get: vi.fn() },
    };
    const store = new PermissionsStore(root);
    expect(store.canEditEntity('other')).toBe(true);
    expect(store.canCreateEntities).toBe(true);
    expect(store.contentEditBlockedReason('other')).toBeNull();
  });

  it('owner can edit when editor mode off', () => {
    const root: any = {
      auth: {
        isLoggedIn: true,
        user: { name: 'me', role: 'organizer' },
        isServerAdmin: false,
      },
      api: { get: vi.fn() },
    };
    const store = new PermissionsStore(root);
    store.admins = [];
    store.editors = [];
    expect(store.canEditEntity('me')).toBe(true);
    expect(store.canEditEntity('them')).toBe(false);
    expect(store.contentEditBlockedReason('them')).toMatch(/назначена/);
  });

  it('editor mode blocks non-editors', () => {
    const root: any = {
      auth: {
        isLoggedIn: true,
        user: { name: 'me', role: 'organizer' },
        isServerAdmin: false,
      },
      api: { get: vi.fn() },
    };
    const store = new PermissionsStore(root);
    store.editors = ['ed'];
    expect(store.canEditEntity('me')).toBe(false);
    expect(store.contentEditBlockedReason('me')).toMatch(/редактор/);
  });

  it('clear resets state', () => {
    const root: any = {
      auth: { isLoggedIn: true, user: { name: 'admin', role: 'organizer' }, isServerAdmin: false },
      api: { get: vi.fn() },
    };
    const store = new PermissionsStore(root);
    store.admins = ['a'];
    store.editors = ['e'];
    store.loaded = true;
    store.clear();
    expect(store.admins).toEqual([]);
    expect(store.loaded).toBe(false);
  });

  it('keeps previous admins on load error', async () => {
    const root: any = {
      auth: {
        isLoggedIn: true,
        user: { name: 'admin', role: 'organizer' },
        isServerAdmin: false,
      },
      api: {
        get: vi.fn().mockRejectedValue(new Error('boom')),
      },
    };
    const store = new PermissionsStore(root);
    store.admins = ['keep'];
    await store.load();
    expect(store.admins).toEqual(['keep']);
    expect(store.loadError).toMatch(/boom/);
  });

  it('load accepts singular admin/editor fields', async () => {
    const root: any = {
      auth: {
        isLoggedIn: true,
        user: { name: 'admin', role: 'organizer' },
        isServerAdmin: false,
      },
      api: {
        get: vi.fn().mockResolvedValue({ admin: 'admin', editor: 'ed' }),
      },
    };
    const store = new PermissionsStore(root);
    await store.load();
    expect(store.admins).toEqual(['admin']);
    expect(store.editors).toEqual(['ed']);
  });
});
