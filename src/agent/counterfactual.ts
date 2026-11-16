import type { PolicyCheck } from './policy.js';
import type { Decision, GatekeeperTask } from '../shared/protocol.js';

/**
 * The counterfactual of one decision: what an incorrect approval would have
 * released, and which single check stopped it.
 *
 * It is derived from the task envelope and the evaluated checks only, so it
 * can be recomputed by a third party from the receipt.
 */
export interface Counterfactual {
  decision: Decision;
  failingCheck: {
    key: string;
    label: string;
    expected: string;
    observed: string;
  } | null;
  wouldHaveApprovedIf: string | null;
  valueAtRisk: {
    amount: string;
    recipient: string;
    maxTransfer: string;
  } | null;
  note: string;
}

/**
 * A human-readable condition that would have turned a rejection into an
 * approval. It names the observed value and the value the rule required.
 */function approvalCondition(check: PolicyCheck): string {
  switch (check.key) {
    case 'vk_match':
      return `the proof verification key had been the registered key (${check.expected})`;
    case 'threshold':
      return `the public balance had been at least ${check.expected.replace('>= ', '')} (observed ${check.observed})`;
    case 'expiry':
      return `the current block had been below ${check.expected.replace('< ', '')} (observed ${check.observed})`;
    case 'recipient':
      return `the recipient had matched the condition recipient (observed ${check.observed})`;
    case 'amount':
      return `the amount had not exceeded ${check.expected.replace('<= ', '')} (observed ${check.observed})`;
    case 'replay':
      return 'the proof reference had not already been claimed by another task';
    default:
      return `${check.label.toLowerCase()} had passed (observed ${check.observed})`;
  }
}

export function buildCounterfactual(
  task: GatekeeperTask,
  decision: Decision,
  checks: PolicyCheck[],
): Counterfactual {
  const input = task.input;
  const valueAtRisk = {
    amount: input.amount,
    recipient: input.recipient,
    maxTransfer: input.max_transfer,
  };

  if (decision === 'APPROVE') {
    return {
      decision,
      failingCheck: null,
      wouldHaveApprovedIf: null,
      valueAtRisk,
      note: `Approved: ${input.amount} was released against the condition for ${input.recipient}.`,
    };
  }

  const failing = checks.find((check) => check.passed === false) ?? null;

  return {
    decision,
    failingCheck: failing
      ? {
          key: failing.key,
          label: failing.label,
          expected: failing.expected,
          observed: failing.observed,
        }
      : null,
    wouldHaveApprovedIf: failing ? approvalCondition(failing) : null,
    valueAtRisk,
    note: failing
      ? `Rejected: ${input.amount} was not released to ${input.recipient} because ${
          failing.label.toLowerCase()
        }.`
      : `Rejected: ${input.amount} was not released to ${input.recipient}.`,
  };
}
