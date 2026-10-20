/**
 * Unit tests for Metadata models
 */

import {
  MovieMetadata,
  ShowMetadata,
  SeasonMetadata,
  EpisodeMetadata,
  MediaContainer,
  Image,
  Genre,
  Guid,
  Person,
  Rating,
  Network,
  SeasonType,
} from '../src/models/Metadata';

describe('Metadata Models', () => {
  describe('MovieMetadata', () => {
    it('should validate required fields for movie', () => {
      const movie: MovieMetadata = {
        type: 'movie',
        ratingKey: 'tmdb-movie-105',
        key: '/library/metadata/tmdb-movie-105',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://movie/tmdb-movie-105',
        title: 'Back to the Future',
        originallyAvailableAt: '1985-07-03',
      };

      expect(movie.type).toBe('movie');
      expect(movie.ratingKey).toBe('tmdb-movie-105');
      expect(movie.title).toBe('Back to the Future');
    });

    it('should allow all optional movie fields', () => {
      const movie: MovieMetadata = {
        type: 'movie',
        ratingKey: 'tmdb-movie-105',
        key: '/library/metadata/tmdb-movie-105',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://movie/tmdb-movie-105',
        title: 'Back to the Future',
        originallyAvailableAt: '1985-07-03',
        thumb: 'https://image.tmdb.org/poster.jpg',
        art: 'https://image.tmdb.org/backdrop.jpg',
        contentRating: 'PG',
        originalTitle: 'Back to the Future',
        year: 1985,
        summary: 'A teenager is accidentally sent back in time...',
        duration: 6960000,
        tagline: 'He was never in time for his classes...',
        studio: 'Universal Pictures',
        theme: 'https://example.com/theme.mp3',
        isAdult: false,
      };

      expect(movie.year).toBe(1985);
      expect(movie.duration).toBe(6960000);
      expect(movie.studio).toBe('Universal Pictures');
    });

    it('should allow Image array', () => {
      const images: Image[] = [
        { type: 'coverPoster', url: 'https://example.com/poster.jpg', alt: 'Movie Poster' },
        { type: 'background', url: 'https://example.com/backdrop.jpg' },
        { type: 'clearLogo', url: 'https://example.com/logo.png' },
      ];

      const movie: MovieMetadata = {
        type: 'movie',
        ratingKey: 'tmdb-movie-105',
        key: '/library/metadata/tmdb-movie-105',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://movie/tmdb-movie-105',
        title: 'Back to the Future',
        originallyAvailableAt: '1985-07-03',
        Image: images,
      };

      expect(movie.Image).toHaveLength(3);
      expect(movie.Image?.[0].type).toBe('coverPoster');
    });

    it('should allow Genre array', () => {
      const genres: Genre[] = [
        { tag: 'Adventure' },
        { tag: 'Comedy' },
        { tag: 'Science Fiction' },
      ];

      const movie: MovieMetadata = {
        type: 'movie',
        ratingKey: 'tmdb-movie-105',
        key: '/library/metadata/tmdb-movie-105',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://movie/tmdb-movie-105',
        title: 'Back to the Future',
        originallyAvailableAt: '1985-07-03',
        Genre: genres,
      };

      expect(movie.Genre).toHaveLength(3);
    });

    it('should allow external Guid array', () => {
      const guids: Guid[] = [
        { id: 'imdb://tt0088763' },
        { id: 'tmdb://105' },
        { id: 'tvdb://299' },
      ];

      const movie: MovieMetadata = {
        type: 'movie',
        ratingKey: 'tmdb-movie-105',
        key: '/library/metadata/tmdb-movie-105',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://movie/tmdb-movie-105',
        title: 'Back to the Future',
        originallyAvailableAt: '1985-07-03',
        Guid: guids,
      };

      expect(movie.Guid).toHaveLength(3);
      expect(movie.Guid?.[0].id).toBe('imdb://tt0088763');
    });

    it('should allow Role array with cast', () => {
      const cast: Person[] = [
        {
          tag: 'Michael J. Fox',
          role: 'Marty McFly',
          order: 1,
          thumb: 'https://example.com/actor.jpg',
        },
        {
          tag: 'Christopher Lloyd',
          role: 'Emmett Brown',
          order: 2,
        },
      ];

      const movie: MovieMetadata = {
        type: 'movie',
        ratingKey: 'tmdb-movie-105',
        key: '/library/metadata/tmdb-movie-105',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://movie/tmdb-movie-105',
        title: 'Back to the Future',
        originallyAvailableAt: '1985-07-03',
        Role: cast,
      };

      expect(movie.Role).toHaveLength(2);
      expect(movie.Role?.[0].role).toBe('Marty McFly');
    });

    it('should allow Rating array', () => {
      const ratings: Rating[] = [
        { image: 'imdb://image.rating', type: 'audience', value: 8.5 },
        { image: 'rottentomatoes://image.rating.ripe', type: 'critic', value: 9.3 },
      ];

      const movie: MovieMetadata = {
        type: 'movie',
        ratingKey: 'tmdb-movie-105',
        key: '/library/metadata/tmdb-movie-105',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://movie/tmdb-movie-105',
        title: 'Back to the Future',
        originallyAvailableAt: '1985-07-03',
        Rating: ratings,
      };

      expect(movie.Rating).toHaveLength(2);
      expect(movie.Rating?.[0].value).toBe(8.5);
    });
  });

  describe('ShowMetadata', () => {
    it('should validate required fields for TV show', () => {
      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'tmdb-show-15260',
        key: '/library/metadata/tmdb-show-15260/children',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        title: 'Adventure Time',
        originallyAvailableAt: '2010-04-05',
      };

      expect(show.type).toBe('show');
      expect(show.title).toBe('Adventure Time');
    });

    it('should allow Network array', () => {
      const networks: Network[] = [
        { tag: 'Cartoon Network' },
      ];

      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'tmdb-show-15260',
        key: '/library/metadata/tmdb-show-15260/children',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        title: 'Adventure Time',
        originallyAvailableAt: '2010-04-05',
        Network: networks,
      };

      expect(show.Network).toHaveLength(1);
      expect(show.Network?.[0].tag).toBe('Cartoon Network');
    });

    it('should allow SeasonType array', () => {
      const seasonTypes: SeasonType[] = [
        {
          id: 'tmdbAiring',
          source: 'tmdb',
          tag: 'Aired',
          title: 'The Movie Database (Aired)',
        },
        {
          id: 'tvdbDvd',
          source: 'tvdb',
          tag: 'DVD',
          title: 'TheTVDB (DVD)',
        },
      ];

      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'tmdb-show-15260',
        key: '/library/metadata/tmdb-show-15260/children',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        title: 'Adventure Time',
        originallyAvailableAt: '2010-04-05',
        SeasonType: seasonTypes,
      };

      expect(show.SeasonType).toHaveLength(2);
      expect(show.SeasonType?.[0].id).toBe('tmdbAiring');
    });

    it('should allow Children object', () => {
      const show: ShowMetadata = {
        type: 'show',
        ratingKey: 'tmdb-show-15260',
        key: '/library/metadata/tmdb-show-15260/children',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        title: 'Adventure Time',
        originallyAvailableAt: '2010-04-05',
        Children: {
          size: 2,
          Metadata: [
            {
              type: 'season',
              ratingKey: 'tmdb-season-1',
              key: '/library/metadata/tmdb-season-1/children',
              guid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-1',
              title: 'Season 1',
              originallyAvailableAt: '2010-04-05',
              parentRatingKey: 'tmdb-show-15260',
              parentKey: '/library/metadata/tmdb-show-15260',
              parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
              parentType: 'show',
              parentTitle: 'Adventure Time',
              index: 1,
            },
          ],
        },
      };

      expect(show.Children?.size).toBe(2);
      expect(show.Children?.Metadata).toHaveLength(1);
    });
  });

  describe('SeasonMetadata', () => {
    it('should validate required fields for season', () => {
      const season: SeasonMetadata = {
        type: 'season',
        ratingKey: 'tmdb-season-8',
        key: '/library/metadata/tmdb-season-8/children',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-8',
        title: 'Season 8',
        originallyAvailableAt: '2016-03-26',
        parentRatingKey: 'tmdb-show-15260',
        parentKey: '/library/metadata/tmdb-show-15260',
        parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        parentType: 'show',
        parentTitle: 'Adventure Time',
        index: 8,
      };

      expect(season.type).toBe('season');
      expect(season.index).toBe(8);
      expect(season.parentTitle).toBe('Adventure Time');
    });

    it('should require parent attributes', () => {
      const season: SeasonMetadata = {
        type: 'season',
        ratingKey: 'tmdb-season-8',
        key: '/library/metadata/tmdb-season-8/children',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-8',
        title: 'Season 8',
        originallyAvailableAt: '2016-03-26',
        parentRatingKey: 'tmdb-show-15260',
        parentKey: '/library/metadata/tmdb-show-15260',
        parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        parentType: 'show',
        parentTitle: 'Adventure Time',
        parentThumb: 'https://example.com/show-thumb.jpg',
        index: 8,
      };

      expect(season.parentRatingKey).toBe('tmdb-show-15260');
      expect(season.parentGuid).toContain('show');
      expect(season.parentThumb).toBeDefined();
    });

    it('should allow Children object with episodes', () => {
      const season: SeasonMetadata = {
        type: 'season',
        ratingKey: 'tmdb-season-8',
        key: '/library/metadata/tmdb-season-8/children',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-8',
        title: 'Season 8',
        originallyAvailableAt: '2016-03-26',
        parentRatingKey: 'tmdb-show-15260',
        parentKey: '/library/metadata/tmdb-show-15260',
        parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        parentType: 'show',
        parentTitle: 'Adventure Time',
        index: 8,
        Children: {
          size: 1,
          Metadata: [
            {
              type: 'episode',
              ratingKey: 'tmdb-episode-1',
              key: '/library/metadata/tmdb-episode-1',
              guid: 'tv.plex.agents.custom.example.themoviedb.tv://episode/tmdb-episode-1',
              title: 'Episode 1',
              originallyAvailableAt: '2016-03-26',
              parentRatingKey: 'tmdb-season-8',
              parentKey: '/library/metadata/tmdb-season-8',
              parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-8',
              parentType: 'season',
              parentTitle: 'Season 8',
              index: 1,
              grandparentRatingKey: 'tmdb-show-15260',
              grandparentKey: '/library/metadata/tmdb-show-15260',
              grandparentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
              grandparentType: 'show',
              grandparentTitle: 'Adventure Time',
              parentIndex: 8,
            },
          ],
        },
      };

      expect(season.Children?.size).toBe(1);
      expect(season.Children?.Metadata[0].type).toBe('episode');
    });
  });

  describe('EpisodeMetadata', () => {
    it('should validate required fields for episode', () => {
      const episode: EpisodeMetadata = {
        type: 'episode',
        ratingKey: 'tmdb-episode-1418023',
        key: '/library/metadata/tmdb-episode-1418023',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://episode/tmdb-episode-1418023',
        title: 'The Wild Hunt',
        originallyAvailableAt: '2017-09-17',
        parentRatingKey: 'tmdb-season-10',
        parentKey: '/library/metadata/tmdb-season-10',
        parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-10',
        parentType: 'season',
        parentTitle: 'Season 10',
        index: 1,
        grandparentRatingKey: 'tmdb-show-15260',
        grandparentKey: '/library/metadata/tmdb-show-15260',
        grandparentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        grandparentType: 'show',
        grandparentTitle: 'Adventure Time',
        parentIndex: 10,
      };

      expect(episode.type).toBe('episode');
      expect(episode.index).toBe(1);
      expect(episode.parentIndex).toBe(10);
      expect(episode.grandparentTitle).toBe('Adventure Time');
    });

    it('should require both parent and grandparent attributes', () => {
      const episode: EpisodeMetadata = {
        type: 'episode',
        ratingKey: 'tmdb-episode-1418023',
        key: '/library/metadata/tmdb-episode-1418023',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://episode/tmdb-episode-1418023',
        title: 'The Wild Hunt',
        originallyAvailableAt: '2017-09-17',
        summary: 'A fierce creature is terrorizing the Candy Kingdom...',
        duration: 660000,
        parentRatingKey: 'tmdb-season-10',
        parentKey: '/library/metadata/tmdb-season-10',
        parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-10',
        parentType: 'season',
        parentTitle: 'Season 10',
        parentThumb: 'https://example.com/season-thumb.jpg',
        index: 1,
        grandparentRatingKey: 'tmdb-show-15260',
        grandparentKey: '/library/metadata/tmdb-show-15260',
        grandparentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        grandparentType: 'show',
        grandparentTitle: 'Adventure Time',
        grandparentThumb: 'https://example.com/show-thumb.jpg',
        parentIndex: 10,
      };

      expect(episode.parentRatingKey).toBeDefined();
      expect(episode.grandparentRatingKey).toBeDefined();
      expect(episode.duration).toBe(660000);
    });

    it('should allow snapshot Image type', () => {
      const images: Image[] = [
        { type: 'snapshot', url: 'https://example.com/episode-screenshot.jpg' },
      ];

      const episode: EpisodeMetadata = {
        type: 'episode',
        ratingKey: 'tmdb-episode-1418023',
        key: '/library/metadata/tmdb-episode-1418023',
        guid: 'tv.plex.agents.custom.example.themoviedb.tv://episode/tmdb-episode-1418023',
        title: 'The Wild Hunt',
        originallyAvailableAt: '2017-09-17',
        parentRatingKey: 'tmdb-season-10',
        parentKey: '/library/metadata/tmdb-season-10',
        parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-10',
        parentType: 'season',
        parentTitle: 'Season 10',
        index: 1,
        grandparentRatingKey: 'tmdb-show-15260',
        grandparentKey: '/library/metadata/tmdb-show-15260',
        grandparentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
        grandparentType: 'show',
        grandparentTitle: 'Adventure Time',
        parentIndex: 10,
        Image: images,
      };

      expect(episode.Image?.[0].type).toBe('snapshot');
    });
  });

  describe('MediaContainer', () => {
    it('should wrap metadata in proper structure', () => {
      const container: MediaContainer = {
        offset: 0,
        totalSize: 1,
        identifier: 'tv.plex.agents.custom.example.themoviedb.tv',
        size: 1,
        Metadata: [
          {
            type: 'movie',
            ratingKey: 'tmdb-movie-105',
            key: '/library/metadata/tmdb-movie-105',
            guid: 'tv.plex.agents.custom.example.themoviedb.tv://movie/tmdb-movie-105',
            title: 'Back to the Future',
            originallyAvailableAt: '1985-07-03',
          },
        ],
      };

      expect(container.size).toBe(1);
      expect(container.Metadata).toHaveLength(1);
      expect(container.offset).toBe(0);
    });

    it('should support multiple metadata items', () => {
      const container: MediaContainer = {
        offset: 0,
        totalSize: 2,
        identifier: 'tv.plex.agents.custom.example.themoviedb.tv',
        size: 2,
        Metadata: [
          {
            type: 'season',
            ratingKey: 'tmdb-season-1',
            key: '/library/metadata/tmdb-season-1/children',
            guid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-1',
            title: 'Season 1',
            originallyAvailableAt: '2010-04-05',
            parentRatingKey: 'tmdb-show-15260',
            parentKey: '/library/metadata/tmdb-show-15260',
            parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
            parentType: 'show',
            parentTitle: 'Adventure Time',
            index: 1,
          },
          {
            type: 'season',
            ratingKey: 'tmdb-season-2',
            key: '/library/metadata/tmdb-season-2/children',
            guid: 'tv.plex.agents.custom.example.themoviedb.tv://season/tmdb-season-2',
            title: 'Season 2',
            originallyAvailableAt: '2010-10-11',
            parentRatingKey: 'tmdb-show-15260',
            parentKey: '/library/metadata/tmdb-show-15260',
            parentGuid: 'tv.plex.agents.custom.example.themoviedb.tv://show/tmdb-show-15260',
            parentType: 'show',
            parentTitle: 'Adventure Time',
            index: 2,
          },
        ],
      };

      expect(container.size).toBe(2);
      expect(container.totalSize).toBe(2);
      expect(container.Metadata).toHaveLength(2);
    });
  });
});
