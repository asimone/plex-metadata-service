import { readConfig } from '../src/config/env';

describe('readConfig', () => {
  it('reads and trims source keys and settings', () => {
    const config = readConfig({
      TMDB_API_KEY: ' tmdb ',
      TVDB_API_KEY: 'tvdb',
      TVDB_PIN: '1234',
      OMDB_API_KEY: 'omdb',
      OMDB_DAILY_CAP: '500',
      SUMMARY_LANGUAGE: 'de-DE',
      DATA_DIR: '/data',
    });
    expect(config).toEqual({
      sources: {
        tmdbApiKey: 'tmdb',
        tvdbApiKey: 'tvdb',
        tvdbPin: '1234',
        omdbApiKey: 'omdb',
        omdbDailyCap: 500,
        language: 'de-DE',
      },
      dataDir: '/data',
    });
  });

  it('has sensible defaults', () => {
    const config = readConfig({ OMDB_DAILY_CAP: 'lots' });
    expect(config.sources.omdbDailyCap).toBe(900);
    expect(config.sources.language).toBe('en-US');
    expect(config.dataDir).toBe('./data');
    expect(config.sources.tmdbApiKey).toBe('');
  });
});
