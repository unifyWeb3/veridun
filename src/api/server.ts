import 'dotenv/config';
import { loadConfig } from '../config/env.js';
import { createRuntime } from './runtime.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = await createRuntime(config);
  const shutdown = async (signal: string): Promise<void> => {
    runtime.app.log.info({ signal }, 'shutting down Veridun');
    await runtime.close();
    process.exitCode = 0;
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await runtime.app.listen({
    host: config.host,
    port: config.port,
  });
}

main().catch((error: unknown) => {
  console.error('Veridun failed to start', error);
  process.exitCode = 1;
});
