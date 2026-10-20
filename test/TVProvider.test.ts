/**
 * Unit tests for TV MediaProvider
 */

import {
  createTVProvider,
  getTVProviderResponse,
  TV_PROVIDER_IDENTIFIER,
  TV_PROVIDER_TITLE,
  TV_PROVIDER_VERSION,
  TV_PROVIDER_BASE_PATH,
} from '../src/providers/TVProvider';
import { MetadataType, FeatureType } from '../src/models/MediaProvider';

describe('TV MediaProvider', () => {
  describe('createTVProvider', () => {
    const provider = createTVProvider();

    it('should have the correct identifier', () => {
      expect(provider.identifier).toBe('tv.plex.agents.custom.example.themoviedb.tv');
      expect(provider.identifier).toBe(TV_PROVIDER_IDENTIFIER);
    });

    it('should have the correct title', () => {
      expect(provider.title).toBe('TheMovieDB Example TV Provider');
      expect(provider.title).toBe(TV_PROVIDER_TITLE);
    });

    it('should have a version', () => {
      expect(provider.version).toBe(TV_PROVIDER_VERSION);
      expect(provider.version).toBe('1.0.0');
    });

    it('should support TV Show, Season, and Episode types', () => {
      expect(provider.Types).toHaveLength(3);

      const types = provider.Types.map(t => t.type);
      expect(types).toContain(MetadataType.SHOW);
      expect(types).toContain(MetadataType.SEASON);
      expect(types).toContain(MetadataType.EPISODE);
    });

    it('should not support Movie or Collection types', () => {
      const types = provider.Types.map(t => t.type);
      expect(types).not.toContain(MetadataType.MOVIE);
      expect(types).not.toContain(MetadataType.COLLECTION);
    });

    it('should have the correct scheme for each type', () => {
      provider.Types.forEach(typeDefinition => {
        expect(typeDefinition.Scheme).toHaveLength(1);
        expect(typeDefinition.Scheme[0].scheme).toBe(TV_PROVIDER_IDENTIFIER);
      });
    });

    it('should have metadata and match features', () => {
      expect(provider.Feature).toHaveLength(2);

      const featureTypes = provider.Feature.map(f => f.type);
      expect(featureTypes).toContain(FeatureType.METADATA);
      expect(featureTypes).toContain(FeatureType.MATCH);
    });

    it('should not have collection feature', () => {
      const featureTypes = provider.Feature.map(f => f.type);
      expect(featureTypes).not.toContain(FeatureType.COLLECTION);
    });

    it('should have correct metadata feature endpoint', () => {
      const metadataFeature = provider.Feature.find(
        f => f.type === FeatureType.METADATA
      );
      expect(metadataFeature).toBeDefined();
      expect(metadataFeature?.key).toBe('/library/metadata');
    });

    it('should have correct match feature endpoint', () => {
      const matchFeature = provider.Feature.find(
        f => f.type === FeatureType.MATCH
      );
      expect(matchFeature).toBeDefined();
      expect(matchFeature?.key).toBe('/library/metadata/matches');
    });

    it('should validate identifier format (must use custom prefix)', () => {
      expect(provider.identifier).toMatch(/^tv\.plex\.agents\.custom\./);
    });

    it('should validate identifier characters (only ASCII letters, numbers, and periods)', () => {
      expect(provider.identifier).toMatch(/^[a-zA-Z0-9.]+$/);
    });
  });

  describe('getTVProviderResponse', () => {
    const response = getTVProviderResponse();

    it('should wrap provider in MediaProvider property', () => {
      expect(response).toHaveProperty('MediaProvider');
    });

    it('should return complete provider definition', () => {
      expect(response.MediaProvider.identifier).toBe(TV_PROVIDER_IDENTIFIER);
      expect(response.MediaProvider.title).toBe(TV_PROVIDER_TITLE);
      expect(response.MediaProvider.Types).toHaveLength(3);
      expect(response.MediaProvider.Feature).toHaveLength(2);
    });
  });

  describe('Type Definitions', () => {
    const provider = createTVProvider();

    it('should have correct numeric values for metadata types', () => {
      const showType = provider.Types.find(t => t.type === MetadataType.SHOW);
      const seasonType = provider.Types.find(t => t.type === MetadataType.SEASON);
      const episodeType = provider.Types.find(t => t.type === MetadataType.EPISODE);

      expect(showType?.type).toBe(2);
      expect(seasonType?.type).toBe(3);
      expect(episodeType?.type).toBe(4);
    });
  });
});
