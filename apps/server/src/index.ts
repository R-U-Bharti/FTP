import { startServer } from './server.js';

// CLI / pkg entry point. Starts the server and opens the system browser to the
// UI. The Electron desktop app imports `startServer` from ./server instead and
// renders the same UI in a native window (openBrowser: false).
async function main(): Promise<void> {
  const running = await startServer({ openBrowser: true });

  const shutdown = (signal: string) => {
    console.log(`\n  Shutting down (${signal})...`);
    void running.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('  ❌ Failed to start LocalDrop:', err);
  process.exit(1);
});
