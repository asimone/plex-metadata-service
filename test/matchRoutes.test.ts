/**
 * Integration tests for Match routes
 * Note: These tests require TMDB_API_KEY to be set in environment
 */

import request from 'supertest';
import { createApp } from '../src/app';

// Skip tests if TMDB_API_KEY is not set
const SKIP_TESTS = !process.env.TMDB_API_KEY;

describe('Match Routes', () => {
  const app = createApp();

  if (SKIP_TESTS) {
    it.skip('skipping tests - TMDB_API_KEY not set', () => {});
    return;
  }

  describe('POST /tv/library/metadata/matches', () => {
    it('should return 200 for valid show match request', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2, // show
          title: 'Adventure Time',
          year: 2010,
        });

      expect(response.status).toBe(200);
    });

    it('should return MediaContainer structure', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Adventure Time',
        });

      expect(response.body).toHaveProperty('MediaContainer');
      expect(response.body.MediaContainer).toHaveProperty('offset');
      expect(response.body.MediaContainer).toHaveProperty('totalSize');
      expect(response.body.MediaContainer).toHaveProperty('identifier');
      expect(response.body.MediaContainer).toHaveProperty('size');
      expect(response.body.MediaContainer).toHaveProperty('Metadata');
    });

    it('should return show metadata for Adventure Time', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Adventure Time',
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('show');
      expect(metadata.title).toContain('Adventure');
      expect(metadata.ratingKey).toBeDefined();
      expect(metadata.guid).toContain('tv.plex.agents.custom.example.themoviedb.tv://show/');
    });

    it('should include external IDs (IMDB, TMDB, TVDB)', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Breaking Bad',
        });

      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.Guid).toBeDefined();
      expect(metadata.Guid.length).toBeGreaterThan(0);

      const hasImdb = metadata.Guid.some((g: any) => g.id.startsWith('imdb://'));
      const hasTmdb = metadata.Guid.some((g: any) => g.id.startsWith('tmdb://'));

      expect(hasImdb || hasTmdb).toBe(true);
    });

    it('should match show by external TVDB ID', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          guid: 'tvdb://152831', // Adventure Time TVDB ID
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.title).toContain('Adventure');
    });

    it('should return multiple matches when manual=1', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'Star',
          manual: 1,
        });

      expect(response.body.MediaContainer.size).toBeGreaterThanOrEqual(1);
      // Should return up to 5 results for manual search
      expect(response.body.MediaContainer.size).toBeLessThanOrEqual(5);
    });

    it('should match season by parent title and index', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 3, // season
          parentTitle: 'Adventure Time',
          index: 1,
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('season');
      expect(metadata.index).toBe(1);
      expect(metadata.parentTitle).toContain('Adventure');
      expect(metadata.ratingKey).toBeDefined();
      expect(metadata.guid).toContain('tv.plex.agents.custom.example.themoviedb.tv://season/');
    });

    it('should match episode by grandparent title and indices', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 4, // episode
          grandparentTitle: 'Adventure Time',
          parentIndex: 1,
          index: 1,
        });

      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
      const metadata = response.body.MediaContainer.Metadata[0];

      expect(metadata.type).toBe('episode');
      expect(metadata.index).toBe(1);
      expect(metadata.parentIndex).toBe(1);
      expect(metadata.grandparentTitle).toContain('Adventure');
      expect(metadata.ratingKey).toBeDefined();
      expect(metadata.guid).toContain('tv.plex.agents.custom.example.themoviedb.tv://episode/');
    });

    it('should respect X-Plex-Language header', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .set('X-Plex-Language', 'en-US')
        .send({
          type: 2,
          title: 'Adventure Time',
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBeGreaterThan(0);
    });

    it('should respect X-Plex-Country header for content ratings', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .set('X-Plex-Country', 'US')
        .send({
          type: 2,
          title: 'Adventure Time',
        });

      expect(response.status).toBe(200);
      const metadata = response.body.MediaContainer.Metadata[0];
      // Content rating might be present depending on TMDB data
      if (metadata.contentRating) {
        expect(typeof metadata.contentRating).toBe('string');
      }
    });

    it('should return empty results for non-existent show', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 2,
          title: 'NonExistentShowWithVeryUniqueName12345',
        });

      expect(response.status).toBe(200);
      expect(response.body.MediaContainer.size).toBe(0);
      expect(response.body.MediaContainer.Metadata).toHaveLength(0);
    });

    it('should return 500 for invalid type', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 1, // movie type - not supported by TV provider
          title: 'Some Movie',
        });

      expect(response.status).toBe(500);
    });

    it('should include proper parent relationships for seasons', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 3,
          parentTitle: 'Breaking Bad',
          index: 1,
        });

      const metadata = response.body.MediaContainer.Metadata[0];
      expect(metadata.parentRatingKey).toBeDefined();
      expect(metadata.parentGuid).toBeDefined();
      expect(metadata.parentType).toBe('show');
      expect(metadata.parentTitle).toBeDefined();
    });

    it('should include proper parent and grandparent relationships for episodes', async () => {
      const response = await request(app)
        .post('/tv/library/metadata/matches')
        .send({
          type: 4,
          grandparentTitle: 'Breaking Bad',
          parentIndex: 1,
          index: 1,
        });

      const metadata = response.body.MediaContainer.Metadata[0];

      // Parent (season)
      expect(metadata.parentRatingKey).toBeDefined();
      expect(metadata.parentGuid).toBeDefined();
      expect(metadata.parentType).toBe('season');

      // Grandparent (show)
      expect(metadata.grandparentRatingKey).toBeDefined();
      expect(metadata.grandparentGuid).toBeDefined();
      expect(metadata.grandparentType).toBe('show');
    });
  });
});
