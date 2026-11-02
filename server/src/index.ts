import 'dotenv/config';
import { buildApp, createServices } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const warnings: string[] = [];
  const { service, mediaStore } = await createServices(config, (m) => warnings.push(m));
  const app = await buildApp({ config, service, mediaStore, logger: true });
  for (const w of warnings) app.log.warn(w);

  if (!config.apiKey) {
    app.log.warn('BLACK_HISTORY_API_KEY not set: serving reviewed fallbacks only');
  }
  app.log.info(`${service.fallbackCount} reviewed fallbacks loaded`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  // Never print the environment; config errors only name the offending variables.
  console.error('Failed to start:', err instanceof Error ? err.message : 'unknown error');
  process.exit(1);
});
