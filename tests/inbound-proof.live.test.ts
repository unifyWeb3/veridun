import { describe, expect, it } from 'vitest';
import { ZkVerifyInboundProofVerifier } from '../src/agent/inbound-proof.js';
import { testTask } from './fixtures.js';

const live = process.env.RUN_LIVE_ZKVERIFY === '1';

describe.skipIf(!live)('live zkVerify inbound verification', () => {
  it(
    'confirms finality, ProofVerified, the submitted VK, and public inputs',
    async () => {
      const verifier = new ZkVerifyInboundProofVerifier({
        rpcUrl: 'https://zkverify-rpc.zkverify.io',
        subscanBaseUrl: 'https://zkverify.subscan.io',
        timeoutMs: 20_000,
      });
      const task = testTask();
      task.input.proof_tx =
        '0x89768425e86fe35a43a3a2ee6a172eee4b8ffc7336bea32e44b06c81cd085d35';
      task.input.proof_vk =
        '0xeff0bb5fb5dde45258b16a9caa7db40371b456c85ea79f26a6225b7723c24a10';

      try {
        const result = await verifier.verify(task);
        expect(result.error).toBeUndefined();
        expect(result.verified).toBe(true);
        expect(result.finalized).toBe(true);
        expect(result.vkMatches).toBe(true);
        expect(result.publicInputs.length).toBeGreaterThan(0);
        expect(result.publicInputsHash).toHaveLength(64);
      } finally {
        await verifier.close();
      }
    },
    60_000,
  );
});
