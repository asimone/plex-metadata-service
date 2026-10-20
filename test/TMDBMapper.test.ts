/**
 * Unit tests for TMDB Mapper
 */

import { TMDBMapper } from '../src/mappers/TMDBMapper';
import { TMDBTVShow, TMDBSeason, TMDBEpisode } from '../src/types/tmdb';

describe('TMDBMapper', () => {
  const mapper = new TMDBMapper({
    imageBaseURL: 'https://image.tmdb.org/t/p/',
  });

  describe('mapTVShow', () => {
    const mockTMDBShow: TMDBTVShow = {
      id: 15260,
      name: 'Adventure Time',
      original_name: 'Adventure Time',
      overview: 'Unlikely heroes Finn and Jake are buddies who traverse the mystical Land of Ooo.',
      tagline: 'They\'re heroes!',
      first_air_date: '2010-04-05',
      last_air_date: '2018-09-03',
      status: 'Ended',
      type: 'Scripted',
      adult: false,
      backdrop_path: '/backdrop.jpg',
      poster_path: '/poster.jpg',
      homepage: 'https://example.com',
      in_production: false,
      languages: ['en'],
      origin_country: ['US'],
      original_language: 'en',
      popularity: 123.456,
      vote_average: 8.5,
      vote_count: 1500,
      number_of_episodes: 283,
      number_of_seasons: 10,
      episode_run_time: [11],
      genres: [
        { id: 16, name: 'Animation' },
        { id: 35, name: 'Comedy' },
      ],
      networks: [
        { id: 56, name: 'Cartoon Network', logo_path: null, origin_country: 'US' },
      ],
      production_companies: [
        { id: 1, name: 'Frederator Studios', logo_path: null, origin_country: 'US' },
      ],
      production_countries: [
        { iso_3166_1: 'US', name: 'United States of America' },
      ],
      spoken_languages: [
        { iso_639_1: 'en', name: 'English', english_name: 'English' },
      ],
      created_by: [],
      last_episode_to_air: null,
      next_episode_to_air: null,
      seasons: [],
      external_ids: {
        imdb_id: 'tt1305826',
        tvdb_id: 152831,
        freebase_id: null,
        freebase_mid: null,
        tvrage_id: null,
      },
      credits: {
        cast: [
          {
            id: 1,
            name: 'Jeremy Shada',
            original_name: 'Jeremy Shada',
            character: 'Finn the Human (voice)',
            credit_id: 'abc123',
            order: 0,
            profile_path: '/actor.jpg',
          },
        ],
        crew: [
          {
            id: 2,
            name: 'Pendleton Ward',
            original_name: 'Pendleton Ward',
            job: 'Director',
            department: 'Directing',
            credit_id: 'def456',
            profile_path: null,
          },
        ],
      },
      content_ratings: {
        results: [
          { iso_3166_1: 'US', rating: 'TV-PG' },
        ],
      },
    };

    it('should map basic TV show fields', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.type).toBe('show');
      expect(show.title).toBe('Adventure Time');
      expect(show.originallyAvailableAt).toBe('2010-04-05');
      expect(show.year).toBe(2010);
      expect(show.summary).toBe('Unlikely heroes Finn and Jake are buddies who traverse the mystical Land of Ooo.');
      expect(show.tagline).toBe('They\'re heroes!');
    });

    it('should generate correct ratingKey and guid', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.ratingKey).toBe('tmdb-show-15260');
      expect(show.guid).toBe('tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260');
      expect(show.key).toBe('/library/metadata/tmdb-show-15260/children');
    });

    it('should map image URLs correctly', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.thumb).toBe('https://image.tmdb.org/t/p/original/poster.jpg');
      expect(show.art).toBe('https://image.tmdb.org/t/p/original/backdrop.jpg');
    });

    it('should map genres', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.Genre).toHaveLength(2);
      expect(show.Genre?.[0].tag).toBe('Animation');
      expect(show.Genre?.[1].tag).toBe('Comedy');
    });

    it('should map external IDs', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.Guid).toBeDefined();
      expect(show.Guid).toHaveLength(3);
      expect(show.Guid?.find(g => g.id === 'imdb://tt1305826')).toBeDefined();
      expect(show.Guid?.find(g => g.id === 'tmdb://15260')).toBeDefined();
      expect(show.Guid?.find(g => g.id === 'tvdb://152831')).toBeDefined();
    });

    it('should map networks', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.Network).toHaveLength(1);
      expect(show.Network?.[0].tag).toBe('Cartoon Network');
    });

    it('should map cast', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.Role).toHaveLength(1);
      expect(show.Role?.[0].tag).toBe('Jeremy Shada');
      expect(show.Role?.[0].role).toBe('Finn the Human (voice)');
      expect(show.Role?.[0].order).toBe(1); // 0-based to 1-based
      expect(show.Role?.[0].thumb).toBe('https://image.tmdb.org/t/p/original/actor.jpg');
    });

    it('should map crew (directors)', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.Director).toHaveLength(1);
      expect(show.Director?.[0].tag).toBe('Pendleton Ward');
      expect(show.Director?.[0].role).toBe('Director');
    });

    it('should map ratings', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.Rating).toHaveLength(1);
      expect(show.Rating?.[0].image).toBe('themoviedb://image.rating');
      expect(show.Rating?.[0].type).toBe('audience');
      expect(show.Rating?.[0].value).toBe(8.5);
    });

    it('should map content rating for US', () => {
      const show = mapper.mapTVShow(mockTMDBShow, { country: 'US' });

      expect(show.contentRating).toBe('TV-PG');
    });

    it('should convert runtime to milliseconds', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      // 11 minutes * 60 seconds * 1000 milliseconds
      expect(show.duration).toBe(660000);
    });

    it('should map studios', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.Studio).toHaveLength(1);
      expect(show.Studio?.[0].tag).toBe('Frederator Studios');
      expect(show.studio).toBe('Frederator Studios');
    });

    it('should map countries', () => {
      const show = mapper.mapTVShow(mockTMDBShow);

      expect(show.Country).toHaveLength(1);
      expect(show.Country?.[0].tag).toBe('United States of America');
    });

    it('should handle adult content flag', () => {
      const show = mapper.mapTVShow(mockTMDBShow);
      expect(show.isAdult).toBe(false);

      const adultShow = { ...mockTMDBShow, adult: true };
      const mappedAdultShow = mapper.mapTVShow(adultShow);
      expect(mappedAdultShow.isAdult).toBe(true);
    });
  });

  describe('mapSeason', () => {
    const mockTMDBSeason: TMDBSeason = {
      id: 12345,
      name: 'Season 8',
      overview: 'Season 8 overview',
      air_date: '2016-03-26',
      episode_count: 27,
      poster_path: '/season-poster.jpg',
      season_number: 8,
    };

    it('should map basic season fields', () => {
      const season = mapper.mapSeason(
        mockTMDBSeason,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        'https://image.tmdb.org/t/p/original/show-thumb.jpg'
      );

      expect(season.type).toBe('season');
      expect(season.title).toBe('Season 8');
      expect(season.index).toBe(8);
      expect(season.originallyAvailableAt).toBe('2016-03-26');
      expect(season.year).toBe(2016);
    });

    it('should generate correct season ratingKey and guid', () => {
      const season = mapper.mapSeason(
        mockTMDBSeason,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260'
      );

      expect(season.ratingKey).toBe('tmdb-season-15260-8');
      expect(season.guid).toBe('tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-15260-8');
    });

    it('should map parent relationships', () => {
      const season = mapper.mapSeason(
        mockTMDBSeason,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        'https://image.tmdb.org/t/p/original/show-thumb.jpg'
      );

      expect(season.parentRatingKey).toBe('tmdb-show-15260');
      expect(season.parentGuid).toBe('tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260');
      expect(season.parentType).toBe('show');
      expect(season.parentTitle).toBe('Adventure Time');
      expect(season.parentThumb).toBe('https://image.tmdb.org/t/p/original/show-thumb.jpg');
    });

    it('should map season poster', () => {
      const season = mapper.mapSeason(
        mockTMDBSeason,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260'
      );

      expect(season.thumb).toBe('https://image.tmdb.org/t/p/original/season-poster.jpg');
    });
  });

  describe('mapEpisode', () => {
    const mockTMDBEpisode: TMDBEpisode = {
      id: 1418023,
      name: 'The Wild Hunt',
      overview: 'A fierce creature is terrorizing the Candy Kingdom...',
      air_date: '2017-09-17',
      episode_number: 1,
      season_number: 10,
      still_path: '/episode-still.jpg',
      runtime: 11,
      vote_average: 8.3,
      vote_count: 150,
      crew: [],
      guest_stars: [],
    };

    it('should map basic episode fields', () => {
      const episode = mapper.mapEpisode(
        mockTMDBEpisode,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        'Season 10',
        'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-15260-10'
      );

      expect(episode.type).toBe('episode');
      expect(episode.title).toBe('The Wild Hunt');
      expect(episode.summary).toBe('A fierce creature is terrorizing the Candy Kingdom...');
      expect(episode.index).toBe(1);
      expect(episode.parentIndex).toBe(10);
      expect(episode.originallyAvailableAt).toBe('2017-09-17');
      expect(episode.year).toBe(2017);
    });

    it('should generate correct episode ratingKey and guid', () => {
      const episode = mapper.mapEpisode(
        mockTMDBEpisode,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        'Season 10',
        'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-15260-10'
      );

      expect(episode.ratingKey).toBe('tmdb-episode-15260-10-1');
      expect(episode.guid).toBe('tv.plex.agents.custom.example.themoviedb.tv://episode/tmdb-episode-15260-10-1');
    });

    it('should map parent and grandparent relationships', () => {
      const episode = mapper.mapEpisode(
        mockTMDBEpisode,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        'Season 10',
        'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-15260-10',
        'https://image.tmdb.org/t/p/original/show-thumb.jpg',
        'https://image.tmdb.org/t/p/original/season-thumb.jpg'
      );

      // Parent (season)
      expect(episode.parentRatingKey).toBe('tmdb-season-15260-10');
      expect(episode.parentGuid).toBe('tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-15260-10');
      expect(episode.parentType).toBe('season');
      expect(episode.parentTitle).toBe('Season 10');
      expect(episode.parentThumb).toBe('https://image.tmdb.org/t/p/original/season-thumb.jpg');

      // Grandparent (show)
      expect(episode.grandparentRatingKey).toBe('tmdb-show-15260');
      expect(episode.grandparentGuid).toBe('tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260');
      expect(episode.grandparentType).toBe('show');
      expect(episode.grandparentTitle).toBe('Adventure Time');
      expect(episode.grandparentThumb).toBe('https://image.tmdb.org/t/p/original/show-thumb.jpg');
    });

    it('should convert episode runtime to milliseconds', () => {
      const episode = mapper.mapEpisode(
        mockTMDBEpisode,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        'Season 10',
        'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-15260-10'
      );

      // 11 minutes * 60 seconds * 1000 milliseconds
      expect(episode.duration).toBe(660000);
    });

    it('should map episode snapshot image', () => {
      const episode = mapper.mapEpisode(
        mockTMDBEpisode,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        'Season 10',
        'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-15260-10'
      );

      expect(episode.Image).toHaveLength(1);
      expect(episode.Image?.[0].type).toBe('snapshot');
      expect(episode.Image?.[0].url).toBe('https://image.tmdb.org/t/p/original/episode-still.jpg');
    });

    it('should map episode rating', () => {
      const episode = mapper.mapEpisode(
        mockTMDBEpisode,
        15260,
        'Adventure Time',
        'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        'Season 10',
        'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-15260-10'
      );

      expect(episode.Rating).toHaveLength(1);
      expect(episode.Rating?.[0].value).toBe(8.3);
    });
  });
});
