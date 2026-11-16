import { Pool } from 'pg';

export function createDatabasePool(databaseUrl: string, maxConnections = 10): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });
}
