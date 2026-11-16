import type { FastifyInstance } from 'fastify';
import { CircuitProver } from '../agent/prover.js';
import {
  TrustedPayloadProofVerifier,
  ZkVerifyInboundProofVerifier,
} from '../agent/inbound-proof.js';
import { KurierProofClient } from '../agent/kurier.js';
import type { AppConfig } from '../config/env.js';
import { createDatabasePool } from '../db/pool.js';
import { PostgresTaskRepository } from '../db/repository.js';
import { createApp } from './app.js';

export interface ApiRuntime {
  app: FastifyInstance;
  close(): Promise<void>;
}

export async function createRuntime(config: AppConfig): Promise<ApiRuntime> {
  const pool = createDatabasePool(config.databaseUrl, config.databasePoolMax);
  const repository = new PostgresTaskRepository(pool);

  if (config.autoMigrate) {
    await repository.ensureSchema();
  }

  const prover = new CircuitProver(config.circuitDir, config.taskIdEncoding);
  const inboundVerifier =
    config.inboundProofVerifier === 'trusted-payload'
      ? new TrustedPayloadProofVerifier()
      : new ZkVerifyInboundProofVerifier({
          rpcUrl: config.zkverifyRpcUrl,
          subscanBaseUrl: config.subscanBaseUrl,
          timeoutMs: config.inboundProofTimeoutMs,
        });
  const kurier = new KurierProofClient({
    apiKey: config.kurierApiKey,
    baseUrl: config.kurierApiBaseUrl,
    pollIntervalMs: config.kurierPollIntervalMs,
    finalityTimeoutMs: config.kurierFinalityTimeoutMs,
  });

  const app = await createApp({
    config,
    repository,
    prover,
    inboundVerifier,
    kurier,
  });

  let closed = false;
  return {
    app,
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      if ('close' in inboundVerifier && typeof inboundVerifier.close === 'function') {
        await inboundVerifier.close();
      }
      await pool.end();
    },
  };
}
