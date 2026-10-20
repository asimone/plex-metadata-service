/**
 * HTTP Server entry point
 */

import { createApp } from './app';
import { config, validateConfig } from './config/env';

// Validate configuration on startup
try {
  validateConfig();
} catch (error) {
  console.error('Configuration error:', error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = createApp();

app.listen(config.server.port, () => {
  console.log(`TMDB Example Provider listening on port ${config.server.port}`);
  console.log(`TV Provider available at: http://localhost:${config.server.port}/tv`);
  console.log(`Match endpoint: http://localhost:${config.server.port}/tv/library/metadata/matches`);
  console.log(`API Documentation: http://localhost:${config.server.port}/api-docs`);
});
