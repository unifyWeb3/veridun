import { Pool } from 'pg';

export function createDatabasePool(databaseUrl: string, maxConnections = 10): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });

  // `pg` reports failures on idle clients (a managed provider closing an idle
  // connection, a network reset, a server-side termination) as an `error`
  // event on the pool. Node treats an unhandled `error` event on an
  // EventEmitter as an uncaught exception, so without this listener a
  // transient database fault would kill the whole function process instead of
  // surfacing as one failed request. The message is logged without the
  // connection string so credentials never reach the logs.
  pool.on('error', (error: Error & { code?: string }) => {
    const code = error.code ? ` (${error.code})` : '';
    console.error(`database pool error${code}: ${error.message}`);
  });

  return pool;
}
