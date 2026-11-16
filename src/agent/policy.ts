import type { Decision, GatekeeperTask, ReasonCode } from '../shared/protocol.js';

export interface PolicyCheck {
  key: string;
  label: string;
  passed: boolean;
  expected: string;
  observed: string;
}

export interface PolicyResult {
  decision: Decision;
  reasonCode: ReasonCode;
  provable: boolean;
  checks: PolicyCheck[];
}

function normalizedHex(value: string): string {
  return value.trim().toLowerCase();
}

export function evaluatePolicy(task: GatekeeperTask, proofAlreadySeen: boolean): PolicyResult {
  const input = task.input;
  const checks: PolicyCheck[] = [];

  const vkMatches = normalizedHex(input.registered_vk) === normalizedHex(input.proof_vk);
  checks.push({
    key: 'vk_match',
    label: 'Verification key matches condition',
    passed: vkMatches,
    expected: input.registered_vk,
    observed: input.proof_vk,
  });

  const thresholdMet = BigInt(input.public_balance) >= BigInt(input.minimum);
  checks.push({
    key: 'threshold',
    label: 'Public balance meets minimum',
    passed: thresholdMet,
    expected: `>= ${input.minimum}`,
    observed: input.public_balance,
  });

  const notExpired = BigInt(input.current_block) < BigInt(input.expiry_block);
  checks.push({
    key: 'expiry',
    label: 'Condition has not expired',
    passed: notExpired,
    expected: `< ${input.expiry_block}`,
    observed: input.current_block,
  });

  const recipientMatches =
    normalizedHex(input.recipient) === normalizedHex(input.condition_recipient);
  checks.push({
    key: 'recipient',
    label: 'Recipient matches condition',
    passed: recipientMatches,
    expected: input.condition_recipient,
    observed: input.recipient,
  });

  const amountWithinCap = BigInt(input.amount) <= BigInt(input.max_transfer);
  checks.push({
    key: 'amount',
    label: 'Amount is within transfer cap',
    passed: amountWithinCap,
    expected: `<= ${input.max_transfer}`,
    observed: input.amount,
  });

  checks.push({
    key: 'replay',
    label: 'Proof reference has not been used',
    passed: !proofAlreadySeen,
    expected: 'first use',
    observed: proofAlreadySeen ? 'previously claimed' : 'first use',
  });

  let reasonCode: ReasonCode = 'VALID_CONDITION';
  if (!vkMatches) reasonCode = 'VK_SUBSTITUTION';
  else if (!thresholdMet) reasonCode = 'THRESHOLD_MISMATCH';
  else if (proofAlreadySeen) reasonCode = 'PROOF_REUSED';
  else if (!notExpired) reasonCode = 'EXPIRED_CONDITION';
  else if (!recipientMatches) reasonCode = 'RECIPIENT_MISMATCH';
  else if (!amountWithinCap) reasonCode = 'AMOUNT_OVERFLOW';

  const decision: Decision = reasonCode === 'VALID_CONDITION' ? 'APPROVE' : 'REJECT';
  const provable =
    decision === 'APPROVE' ||
    reasonCode === 'VK_SUBSTITUTION' ||
    reasonCode === 'THRESHOLD_MISMATCH' ||
    reasonCode === 'EXPIRED_CONDITION' ||
    reasonCode === 'RECIPIENT_MISMATCH' ||
    reasonCode === 'AMOUNT_OVERFLOW';

  return { decision, reasonCode, provable, checks };
}
