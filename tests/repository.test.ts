import type { Pool } from 'pg';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it } from 'vitest';
import { PostgresTaskRepository } from '../src/db/repository.js';
import { testTask } from './fixtures.js';

const pools: Pool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

async function createRepository(): Promise<PostgresTaskRepository> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  pools.push(pool);
  const repository = new PostgresTaskRepository(pool);
  await repository.ensureSchema();
  return repository;
}

describe('PostgreSQL task ledger', () => {
  it('claims a task and returns the exact stored response on retry', async () => {
    const repository = await createRepository();
    const task = testTask();
    const digest = 'a'.repeat(64);

    const first = await repository.claimTask(task, digest);
    expect(first.kind).toBe('claimed');
    expect(first.proofAlreadySeen).toBe(false);

    const responseBody = Buffer.from('{"decision":"APPROVE"}');
    await repository.completeTask({
      taskId: task.task_id,
      decision: 'APPROVE',
      reasonCode: 'VALID_CONDITION',
      responseBody,
      responseSignature: 'b'.repeat(64),
      proof: null,
      policyChecks: [],
      inboundVerification: null,
      kurier: null,
      durationMs: 12,
    });

    const retry = await repository.claimTask(task, digest);
    expect(retry.kind).toBe('duplicate');
    expect(retry.responseBody?.equals(responseBody)).toBe(true);
    expect(retry.responseSignature).toBe('b'.repeat(64));
  });

  it('rejects reuse of a task ID with a different request digest', async () => {
    const repository = await createRepository();
    const task = testTask();

    expect((await repository.claimTask(task, 'a'.repeat(64))).kind).toBe('claimed');
    const conflict = await repository.claimTask(task, 'c'.repeat(64));
    expect(conflict.kind).toBe('conflict');
  });

  it('detects a proof reference reused by another task', async () => {
    const repository = await createRepository();
    const firstTask = testTask({ task_id: 'gk_first' });
    const secondTask = testTask({ task_id: 'gk_second' });

    const first = await repository.claimTask(firstTask, 'a'.repeat(64));
    const second = await repository.claimTask(secondTask, 'b'.repeat(64));

    expect(first.proofAlreadySeen).toBe(false);
    expect(second.proofAlreadySeen).toBe(true);
  });

  it('persists decision evidence and exposes it in the task detail', async () => {
    const repository = await createRepository();
    const task = testTask();
    await repository.claimTask(task, 'a'.repeat(64));
    await repository.completeTask({
      taskId: task.task_id,
      decision: 'REJECT',
      reasonCode: 'THRESHOLD_MISMATCH',
      responseBody: Buffer.from('{}'),
      responseSignature: 'c'.repeat(64),
      proof: null,
      policyChecks: [
        {
          key: 'threshold',
          label: 'Public balance meets minimum',
          passed: false,
          expected: '>= 1000',
          observed: '999',
        },
      ],
      inboundVerification: null,
      kurier: null,
      durationMs: 20,
    });

    const detail = await repository.getTask(task.task_id);
    expect(detail?.decision).toBe('REJECT');
    expect(detail?.reasonCode).toBe('THRESHOLD_MISMATCH');
    expect(detail?.policyChecks).toHaveLength(1);
    expect(detail?.requestDigest).toBe('a'.repeat(64));
  });
});
