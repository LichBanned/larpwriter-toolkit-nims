import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiStore } from './ApiStore';

describe('ApiStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('PUT body is [args]', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new ApiStore();
    await api.call('createStory', { storyName: 'S' });
    expect(fetchMock).toHaveBeenCalledWith('/api/createStory', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify([{ storyName: 'S' }]),
    }));
  });

  it('empty body returns undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => '',
    }));
    const api = new ApiStore();
    const result = await api.call('noop');
    expect(result).toBeUndefined();
  });

  it('401 clears session', async () => {
    const clearSession = vi.fn();
    const root = { auth: { clearSession } } as any;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      text: async () => 'nope',
    }));
    const api = new ApiStore(root);
    await expect(api.call('x')).rejects.toThrow(/вход/);
    expect(clearSession).toHaveBeenCalled();
  });

  it('non-ok PUT throws with status text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      text: async () => 'boom',
    }));
    const api = new ApiStore();
    await expect(api.call('x')).rejects.toThrow(/API x: 500/);
  });

  it('get with params and 401', async () => {
    const clearSession = vi.fn();
    const root = { auth: { clearSession } } as any;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ a: 1 }),
      })
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
        text: async () => '',
      });
    vi.stubGlobal('fetch', fetchMock);
    const api = new ApiStore(root);
    await expect(api.get('listProjects', { includeJoinable: true })).resolves.toEqual({ a: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('params=');
    await expect(api.get('x')).rejects.toThrow(/вход/);
    expect(clearSession).toHaveBeenCalled();
  });

  it('get non-ok throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      text: async () => 'missing',
    }));
    const api = new ApiStore();
    await expect(api.get('nope')).rejects.toThrow(/404/);
  });
});
