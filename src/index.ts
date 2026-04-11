import { bootstrapCLI } from './bootstrap.js';

bootstrapCLI({ edition: 'community' }).catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
