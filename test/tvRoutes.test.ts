/**
 * Integration tests for TV routes
 */

import request from 'supertest';
import { createApp } from '../src/app';
import { TV_PROVIDER_IDENTIFIER, TV_PROVIDER_TITLE } from '../src/providers/TVProvider';
import { MetadataType, FeatureType } from '../src/models/MediaProvider';

describe('TV Routes', () => {
  const app = createApp();

  describe('GET /tv', () => {
    it('should return 200 OK', async () => {
      const response = await request(app).get('/tv');
      expect(response.status).toBe(200);
    });

    it('should return JSON content type', async () => {
      const response = await request(app).get('/tv');
      expect(response.type).toBe('application/json');
    });

    it('should return MediaProvider wrapped response', async () => {
      const response = await request(app).get('/tv');
      expect(response.body).toHaveProperty('MediaProvider');
    });

    it('should return valid MediaProvider structure', async () => {
      const response = await request(app).get('/tv');
      const { MediaProvider } = response.body;

      expect(MediaProvider).toHaveProperty('identifier');
      expect(MediaProvider).toHaveProperty('title');
      expect(MediaProvider).toHaveProperty('version');
      expect(MediaProvider).toHaveProperty('Types');
      expect(MediaProvider).toHaveProperty('Feature');
    });

    it('should return correct identifier and title', async () => {
      const response = await request(app).get('/tv');
      const { MediaProvider } = response.body;

      expect(MediaProvider.identifier).toBe(TV_PROVIDER_IDENTIFIER);
      expect(MediaProvider.title).toBe(TV_PROVIDER_TITLE);
    });

    it('should return TV show types (show, season, episode)', async () => {
      const response = await request(app).get('/tv');
      const { MediaProvider } = response.body;

      expect(MediaProvider.Types).toHaveLength(3);

      const types = MediaProvider.Types.map((t: any) => t.type);
      expect(types).toContain(MetadataType.SHOW);
      expect(types).toContain(MetadataType.SEASON);
      expect(types).toContain(MetadataType.EPISODE);
    });

    it('should return metadata and match features', async () => {
      const response = await request(app).get('/tv');
      const { MediaProvider } = response.body;

      expect(MediaProvider.Feature).toHaveLength(2);

      const featureTypes = MediaProvider.Feature.map((f: any) => f.type);
      expect(featureTypes).toContain(FeatureType.METADATA);
      expect(featureTypes).toContain(FeatureType.MATCH);
    });

    it('should have correct feature endpoints with /tv prefix', async () => {
      const response = await request(app).get('/tv');
      const { MediaProvider } = response.body;

      const metadataFeature = MediaProvider.Feature.find(
        (f: any) => f.type === FeatureType.METADATA
      );
      const matchFeature = MediaProvider.Feature.find(
        (f: any) => f.type === FeatureType.MATCH
      );

      expect(metadataFeature.key).toBe('/library/metadata');
      expect(matchFeature.key).toBe('/library/metadata/matches');
    });
  });

  describe('GET /health', () => {
    it('should return 200 OK', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
    });

    it('should return status ok', async () => {
      const response = await request(app).get('/health');
      expect(response.body).toEqual({ status: 'ok' });
    });
  });
});
