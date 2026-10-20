import { afterEach, describe, expect, it, vi } from 'vitest';

const { openedPaths } = vi.hoisted(() => ({ openedPaths: [] as string[] }));
vi.mock('better-sqlite3', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import('better-sqlite3') }>();
  return {
    default: function (filename: string) {
      openedPaths.push(filename);
      return new actual.default(filename);
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  openedPaths.length = 0;
});

describe('SQLite initialization and test isolation', () => {
  it('does not open a database when importing clients, repositories or handlers', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '/must-not-open/production.db');
    await import('./client');
    await import('@/services/sqlite-trip-repository');
    await import('@/services/cached-routing');
    await import('@/pages/api/trips/[id]');
    await import('@/pages/api/trips/index');
    await import('@/pages/api/routes/index');
    await import('@/pages/api/routes/estimate');
    await import('@/pages/api/ai/planning-intent');
    expect(openedPaths).toEqual([]);
  });

  it('uses a working in-memory SQLite database despite an inherited database URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '/must-not-open/production.db');
    const { getDb } = await import('./client');
    const db = getDb();
    try {
      expect(openedPaths).toEqual([':memory:']);
      expect(getDb()).toBe(db);
      db.$client.exec('CREATE TABLE isolation_probe (value TEXT)');
      db.$client.prepare('INSERT INTO isolation_probe VALUES (?)').run('test only');
      expect(db.$client.prepare('SELECT value FROM isolation_probe').get()).toEqual({ value: 'test only' });
      expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.$client.pragma('database_list')).toMatchObject([{ file: '' }]);
    } finally {
      db.$client.close();
    }
  });
});
