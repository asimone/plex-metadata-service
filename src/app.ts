/**
 * Express application setup
 */

import express, { Application } from 'express';
import swaggerUi from 'swagger-ui-express';
import tvRoutes from './routes/tvRoutes';
import { swaggerSpec } from './config/swagger';
import logger from './utils/logger';

/**
 * Creates and configures the Express application
 */
export function createApp(): Application {
  const app = express();

  // Request logging middleware
  app.use((req, _res, next) => {
    logger.info(`Incoming Request: ${req.method} ${req.path}`);
    next();
  });

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Swagger documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Swagger JSON endpoint
  app.get('/api-docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Routes
  app.use('/tv', tvRoutes);

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
