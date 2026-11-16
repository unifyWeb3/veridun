import { z } from 'zod';

const MAX_UINT_256 = (1n << 256n) - 1n;

export const uintString = z
  .union([z.string(), z.number().int().safe()])
  .transform((value) => String(value))
  .refine((value) => /^(0|[1-9]\d*)$/.test(value), 'must be an unsigned decimal integer')
  .refine((value) => BigInt(value) <= MAX_UINT_256, 'exceeds uint256');

const hexValue = (maxBytes: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-fA-F]{1,${maxBytes * 2}}$`), 'must be a 0x-prefixed hex value');

export const gatekeeperInputSchema = z
  .object({
    registered_vk: hexValue(32),
    proof_vk: hexValue(32),
    minimum: uintString,
    public_balance: uintString,
    expiry_block: uintString,
    current_block: uintString,
    recipient: hexValue(20),
    condition_recipient: hexValue(20),
    amount: uintString,
    max_transfer: uintString,
    proof_tx: hexValue(64),
  })
  .strict();

export const gatekeeperTaskSchema = z
  .object({
    type: z.literal('agent-games.proof-gatekeeper.v1'),
    task_id: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
    mode: z.enum(['practice', 'competition']),
    issued_at: z.string().datetime({ offset: true }),
    deadline_at: z.string().datetime({ offset: true }),
    input: gatekeeperInputSchema,
  })
  .strict();

export const preflightSchema = z
  .object({
    type: z.literal('agent-games.preflight.v1'),
    agent_id: z.string().min(1).max(200),
    issued_at: z.string().datetime({ offset: true }),
    nonce: z.string().min(1).max(256),
  })
  .strict();

export const decisionSchema = z.enum(['APPROVE', 'REJECT']);

export const reasonCodeSchema = z.enum([
  'VALID_CONDITION',
  'VK_SUBSTITUTION',
  'THRESHOLD_MISMATCH',
  'PROOF_REUSED',
  'EXPIRED_CONDITION',
  'RECIPIENT_MISMATCH',
  'AMOUNT_OVERFLOW',
  'PROOF_NOT_FINALIZED',
  'INVALID_TASK',
]);

export const groth16ProofSchema = z
  .object({
    pi_a: z.tuple([z.string(), z.string(), z.string()]),
    pi_b: z.tuple([
      z.tuple([z.string(), z.string()]),
      z.tuple([z.string(), z.string()]),
      z.tuple([z.string(), z.string()]),
    ]),
    pi_c: z.tuple([z.string(), z.string(), z.string()]),
    protocol: z.literal('groth16'),
    curve: z.literal('bn128'),
  })
  .strict();

export const agentResponseSchema = z
  .object({
    decision: decisionSchema,
    reason_code: reasonCodeSchema,
    proof_tx: z.string().optional(),
    proof: groth16ProofSchema.optional(),
    public_signals: z.array(z.string()).length(13).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasProof = value.proof !== undefined;
    const hasPublicSignals = value.public_signals !== undefined;
    if (hasProof !== hasPublicSignals) {
      context.addIssue({
        code: 'custom',
        message: 'proof and public_signals must be provided together',
        path: hasProof ? ['public_signals'] : ['proof'],
      });
    }
  });

export type GatekeeperInput = z.infer<typeof gatekeeperInputSchema>;
export type GatekeeperTask = z.infer<typeof gatekeeperTaskSchema>;
export type Preflight = z.infer<typeof preflightSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type ReasonCode = z.infer<typeof reasonCodeSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;

export function isGatekeeperTask(value: unknown): value is GatekeeperTask {
  return gatekeeperTaskSchema.safeParse(value).success;
}

export function isPreflight(value: unknown): value is Preflight {
  return preflightSchema.safeParse(value).success;
}
