import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(742196451)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationsDir = path.resolve('migrations');
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of files) {
      const sql = await readFile(path.join(migrationsDir, name), 'utf8');
      const digest = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query(
        'SELECT sha256 FROM schema_migrations WHERE name = $1',
        [name],
      );
      if (existing.rowCount > 0) {
        if (existing.rows[0].sha256 !== digest) {
          throw new Error(`applied migration ${name} has changed`);
        }
        console.log(`${name}: already applied`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)',
          [name, digest],
        );
        await client.query('COMMIT');
        console.log(`${name}: applied`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(742196451)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}
