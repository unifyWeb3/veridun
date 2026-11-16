import path from 'node:path';
import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AGENT_GAMES_HMAC_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(2),
  AUTO_MIGRATE: booleanish.default(true),
  KURIER_API_KEY: z.string().default(''),
  KURIER_API_BASE_URL: z.string().url().default('https://api.kurier.xyz/api/v1'),
  CIRCUIT_DIR: z.string().default('artifacts/circuit'),
  TASK_ID_ENCODING: z.enum(['auto', 'hex-suffix', 'sha256', 'keccak256']).default('auto'),
  INBOUND_PROOF_VERIFIER: z.enum(['zkverify', 'trusted-payload']).default('zkverify'),
  SUBSCAN_BASE_URL: z.string().url().default('https://zkverify.subscan.io'),
  ZKVERIFY_RPC_URL: z.string().url().default('https://zkverify-rpc.zkverify.io'),
  INBOUND_PROOF_TIMEOUT_MS: z.coerce.number().int().min(2_000).max(30_000).default(10_000),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DASHBOARD_ENABLED: booleanish.default(true),
  PROOF_SUBMIT_ENABLED: booleanish.default(true),
  KURIER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(10_000).default(2_000),
  KURIER_FINALITY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(45_000).default(30_000),
  REQUEST_BUDGET_MS: z.coerce.number().int().min(5_000).max(58_000).default(55_000),
  TASK_CLOCK_SKEW_MS: z.coerce.number().int().min(0).max(30_000).default(5_000),
  TASK_MAX_WINDOW_MS: z.coerce.number().int().min(10_000).max(120_000).default(65_000),
  MAX_REQUEST_BYTES: z.coerce.number().int().min(1_024).max(5_000_000).default(1_048_576),
});

export type TaskIdEncoding = 'auto' | 'hex-suffix' | 'sha256' | 'keccak256';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  hmacSecret: string;
  databaseUrl: string;
  databasePoolMax: number;
  autoMigrate: boolean;
  kurierApiKey: string;
  kurierApiBaseUrl: string;
  circuitDir: string;
  taskIdEncoding: TaskIdEncoding;
  inboundProofVerifier: 'zkverify' | 'trusted-payload';
  subscanBaseUrl: string;
  zkverifyRpcUrl: string;
  inboundProofTimeoutMs: number;
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  dashboardEnabled: boolean;
  proofSubmitEnabled: boolean;
  kurierPollIntervalMs: number;
  kurierFinalityTimeoutMs: number;
  requestBudgetMs: number;
  taskClockSkewMs: number;
  taskMaxWindowMs: number;
  maxRequestBytes: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    hmacSecret: parsed.AGENT_GAMES_HMAC_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    databasePoolMax: parsed.DATABASE_POOL_MAX,
    autoMigrate: parsed.AUTO_MIGRATE,
    kurierApiKey: parsed.KURIER_API_KEY,
    kurierApiBaseUrl: parsed.KURIER_API_BASE_URL.replace(/\/$/, ''),
    circuitDir: path.resolve(parsed.CIRCUIT_DIR),
    taskIdEncoding: parsed.TASK_ID_ENCODING,
    inboundProofVerifier: parsed.INBOUND_PROOF_VERIFIER,
    subscanBaseUrl: parsed.SUBSCAN_BASE_URL.replace(/\/$/, ''),
    zkverifyRpcUrl: parsed.ZKVERIFY_RPC_URL,
    inboundProofTimeoutMs: parsed.INBOUND_PROOF_TIMEOUT_MS,
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    dashboardEnabled: parsed.DASHBOARD_ENABLED,
    proofSubmitEnabled: parsed.PROOF_SUBMIT_ENABLED,
    kurierPollIntervalMs: parsed.KURIER_POLL_INTERVAL_MS,
    kurierFinalityTimeoutMs: parsed.KURIER_FINALITY_TIMEOUT_MS,
    requestBudgetMs: parsed.REQUEST_BUDGET_MS,
    taskClockSkewMs: parsed.TASK_CLOCK_SKEW_MS,
    taskMaxWindowMs: parsed.TASK_MAX_WINDOW_MS,
    maxRequestBytes: parsed.MAX_REQUEST_BYTES,
  };
}
