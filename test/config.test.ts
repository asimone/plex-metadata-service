import { readConfig, validateConfig } from '../src/config/env';

describe('readConfig', () => {
  it('trims values, strips trailing slashes and splits libraries', () => {
    const config = readConfig({
      PLEX_URL: ' http://10.0.0.5:32400/ ',
      PLEX_TOKEN: ' abc ',
      PLEX_LIBRARIES: 'Movies, TV Shows ,,',
      TMDB_API_KEY: 'k',
    });
    expect(config.plex).toEqual({
      url: 'http://10.0.0.5:32400',
      token: 'abc',
      libraries: ['Movies', 'TV Shows'],
    });
    expect(config.sources.tmdbApiKey).toBe('k');
  });

  it('defaults to no library selection', () => {
    expect(readConfig({}).plex.libraries).toEqual([]);
  });
});

describe('validateConfig', () => {
  it('requires PLEX_URL and PLEX_TOKEN', () => {
    const { errors } = validateConfig(readConfig({}));
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toMatch(/PLEX_URL/);
    expect(errors.join('\n')).toMatch(/PLEX_TOKEN/);
  });

  it('rejects a URL without a scheme', () => {
    const { errors } = validateConfig(readConfig({ PLEX_URL: '10.0.0.5:32400', PLEX_TOKEN: 't' }));
    expect(errors).toEqual([expect.stringMatching(/must start with http/)]);
  });

  it('warns, but does not fail, when no source keys are set', () => {
    const { errors, warnings } = validateConfig(readConfig({ PLEX_URL: 'http://plex:32400', PLEX_TOKEN: 't' }));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/No source API keys/)]);
  });

  it('is clean with Plex settings and a source key', () => {
    const result = validateConfig(readConfig({ PLEX_URL: 'http://plex:32400', PLEX_TOKEN: 't', TVDB_API_KEY: 'x' }));
    expect(result).toEqual({ errors: [], warnings: [] });
  });
});
