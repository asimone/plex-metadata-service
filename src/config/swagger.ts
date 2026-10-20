/**
 * Swagger/OpenAPI Configuration
 */

import swaggerJsdoc from 'swagger-jsdoc';
import { TV_PROVIDER_VERSION } from '../providers/TVProvider';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TMDB Example Provider API',
      version: TV_PROVIDER_VERSION,
      description: 'A Plex-compatible Custom Metadata Provider for TV shows using TheMovieDB.org API',
      contact: {
        name: 'API Support',
      },
      license: {
        name: 'ISC',
      },
    },
    servers: [
      {
        url: baseUrl,
        description: 'API server',
      },
    ],
    tags: [
      {
        name: 'Provider',
        description: 'MediaProvider definition endpoints',
      },
      {
        name: 'Metadata',
        description: 'Metadata retrieval by ratingKey',
      },
      {
        name: 'Match',
        description: 'Content matching and search',
      },
    ],
  },
  apis: ['./src/routes/*.ts'], // Path to the API routes
};

export const swaggerSpec = swaggerJsdoc(options);
