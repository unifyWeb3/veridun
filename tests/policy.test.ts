import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/agent/policy.js';
import { testTask } from './fixtures.js';

describe('deterministic gatekeeper policy', () => {
  it('approves a condition that passes every check', () => {
    const result = evaluatePolicy(testTask(), false);
    expect(result.decision).toBe('APPROVE');
    expect(result.reasonCode).toBe('VALID_CONDITION');
    expect(result.provable).toBe(true);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it('rejects a substituted verification key', () => {
    const task = testTask();
    task.input.proof_vk = `0x${'ab'.repeat(32)}`;
    const result = evaluatePolicy(task, false);
    expect(result.decision).toBe('REJECT');
    expect(result.reasonCode).toBe('VK_SUBSTITUTION');
    expect(result.provable).toBe(true);
  });

  it('allows balance equal to the required minimum', () => {
    const task = testTask();
    task.input.public_balance = task.input.minimum;
    expect(evaluatePolicy(task, false).reasonCode).toBe('VALID_CONDITION');
  });

  it('rejects balance one unit below the minimum', () => {
    const task = testTask();
    task.input.public_balance = '999';
    expect(evaluatePolicy(task, false).reasonCode).toBe('THRESHOLD_MISMATCH');
  });

  it('treats expiry equality as expired', () => {
    const task = testTask();
    task.input.current_block = task.input.expiry_block;
    expect(evaluatePolicy(task, false).reasonCode).toBe('EXPIRED_CONDITION');
  });

  it('allows amount equal to the transfer cap', () => {
    const task = testTask();
    task.input.amount = task.input.max_transfer;
    expect(evaluatePolicy(task, false).reasonCode).toBe('VALID_CONDITION');
  });

  it('rejects amount one unit above the transfer cap', () => {
    const task = testTask();
    task.input.amount = '1001';
    expect(evaluatePolicy(task, false).reasonCode).toBe('AMOUNT_OVERFLOW');
  });

  it('rejects a recipient mismatch', () => {
    const task = testTask();
    task.input.condition_recipient = `0x${'12'.repeat(20)}`;
    expect(evaluatePolicy(task, false).reasonCode).toBe('RECIPIENT_MISMATCH');
  });

  it('marks replay as unprovable', () => {
    const result = evaluatePolicy(testTask(), true);
    expect(result.decision).toBe('REJECT');
    expect(result.reasonCode).toBe('PROOF_REUSED');
    expect(result.provable).toBe(false);
  });
});
