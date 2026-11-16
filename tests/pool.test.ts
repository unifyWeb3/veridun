import { describe, expect, it } from 'vitest';
import { createDatabasePool } from '../src/db/pool.js';

describe('database pool', () => {
  it('observes pool-level errors instead of letting them kill the process', async () => {
    const pool = createDatabasePool('postgres://postgres:postgres@127.0.0.1:1/none', 1);

    // An idle-client failure is reported as an `error` event on the pool. Node
    // turns an unhandled `error` event into an uncaught exception, so the
    // service would die instead of failing one request.
    expect(pool.listenerCount('error')).toBeGreaterThan(0);

    const observed = new Promise<Error>((resolve) => {
      pool.once('error', resolve);
    });
    pool.emit('error', new Error('simulated connection fault'));
    const error = await observed;
    expect(error.message).toBe('simulated connection fault');

    await pool.end();
  });
});
