import { describe, expect, it } from 'vitest';
import { buildCounterfactual } from '../src/agent/counterfactual.js';
import { evaluatePolicy } from '../src/agent/policy.js';
import { testTask } from './fixtures.js';

describe('decision counterfactual', () => {
  it('states the released value for an approval', () => {
    const task = testTask();
    const policy = evaluatePolicy(task, false);
    const counterfactual = buildCounterfactual(task, policy.decision, policy.checks);

    expect(counterfactual.decision).toBe('APPROVE');
    expect(counterfactual.failingCheck).toBeNull();
    expect(counterfactual.valueAtRisk).toEqual({
      amount: task.input.amount,
      recipient: task.input.recipient,
      maxTransfer: task.input.max_transfer,
    });
    expect(counterfactual.note).toContain(task.input.amount);
  });

  it('names the check that stopped a rejection and the value withheld', () => {
    const task = testTask({
      input: {
        ...testTask().input,
        amount: '5000',
        max_transfer: '1000',
      },
    });
    const policy = evaluatePolicy(task, false);
    const counterfactual = buildCounterfactual(task, policy.decision, policy.checks);

    expect(counterfactual.decision).toBe('REJECT');
    expect(counterfactual.failingCheck?.key).toBe('amount');
    expect(counterfactual.wouldHaveApprovedIf).toContain('1000');
    expect(counterfactual.valueAtRisk?.amount).toBe('5000');
    expect(counterfactual.note).toContain('not released');
  });

  it('explains a replay rejection as external state', () => {
    const task = testTask();
    const policy = evaluatePolicy(task, true);
    const counterfactual = buildCounterfactual(task, policy.decision, policy.checks);

    expect(counterfactual.decision).toBe('REJECT');
    expect(counterfactual.failingCheck?.key).toBe('replay');
    expect(counterfactual.wouldHaveApprovedIf).toContain('not already been claimed');
  });
});
