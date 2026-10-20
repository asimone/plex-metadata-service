/**
 * TheMovieDB.org API Client
 * Documentation: https://developer.themoviedb.org/docs
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../../utils/logger';
import {
  TMDBTVShow,
  TMDBSeason,
  TMDBEpisode,
  TMDBSearchResult,
  TMDBFindResult,
  TMDBConfiguration,
  TMDBAggregateCredits,
  TMDBEpisodeGroupDetails,
} from './types';

export class TMDBClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseURL = 'https://api.themoviedb.org/3';
  private imageBaseURL: string | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: this.baseURL,
      params: {
        api_key: this.apiKey,
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        const url = `${config.baseURL}${config.url}`;
        const params = new URLSearchParams(config.params);

        // Obfuscate API key in logs
        if (params.has('api_key')) {
          params.set('api_key', '********');
        }

        const paramsString = params.toString();
        const fullUrl = paramsString ? `${url}?${paramsString}` : url;

        logger.info(`TMDB API Request: ${config.method?.toUpperCase()} ${fullUrl}`);
        return config;
      },
      (error) => {
        logger.error('TMDB API Request Error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.info(`TMDB API Response: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error(`TMDB API Error: ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
        } else {
          logger.error(`TMDB API Network Error: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get TMDB API configuration (including image base URLs)
   */
  async getConfiguration(): Promise<TMDBConfiguration> {
    const response = await this.client.get<TMDBConfiguration>('/configuration');
    this.imageBaseURL = response.data.images.secure_base_url;
    return response.data;
  }

  /**
   * Get image base URL (fetches configuration if not cached)
   */
  async getImageBaseURL(): Promise<string> {
    if (!this.imageBaseURL) {
      await this.getConfiguration();
    }
    return this.imageBaseURL!;
  }

  /**
   * Construct full image URL from path
   * @param path - Image path from TMDB (e.g., "/abc123.jpg")
   * @param size - Image size (e.g., "original", "w500")
   */
  async getImageURL(path: string | null, size: string = 'original'): Promise<string | null> {
    if (!path) return null;
    const baseURL = await this.getImageBaseURL();
    return `${baseURL}${size}${path}`;
  }

  /**
   * Search for TV shows
   */
  async searchTVShows(query: string, options?: {
    language?: string;
    page?: number;
    year?: number;
  }): Promise<TMDBSearchResult> {
    const response = await this.client.get<TMDBSearchResult>('/search/tv', {
      params: {
        query,
        language: options?.language,
        page: options?.page,
        first_air_date_year: options?.year,
      },
    });
    return response.data;
  }

  /**
   * Get TV show details
   * @param tvId - TMDB TV show ID
   * @param options - Optional parameters for append_to_response
   */
  async getTVShowDetails(tvId: number, options?: {
    language?: string;
    appendToResponse?: string[];
  }): Promise<TMDBTVShow> {
    const appendToResponse = options?.appendToResponse?.join(',') ||
      'external_ids,images,content_ratings,episode_groups,aggregate_credits';

    const response = await this.client.get<TMDBTVShow>(`/tv/${tvId}`, {
      params: {
        language: options?.language,
        append_to_response: appendToResponse,
      },
    });
    return response.data;
  }

  /**
   * Get aggregate credits (cast and crew) for a TV show
   * This endpoint returns more complete cast/crew data than credits or append_to_response
   * It aggregates all cast/crew across all episodes
   * @param tvId - TMDB TV show ID
   */
  async getTVShowCredits(tvId: number, options?: {
    language?: string;
  }): Promise<TMDBAggregateCredits> {
    const response = await this.client.get<TMDBAggregateCredits>(`/tv/${tvId}/aggregate_credits`, {
      params: {
        language: options?.language,
      },
    });
    return response.data;
  }

  /**
   * Get season details
   * @param tvId - TMDB TV show ID
   * @param seasonNumber - Season number
   */
  async getSeasonDetails(tvId: number, seasonNumber: number, options?: {
    language?: string;
  }): Promise<TMDBSeason> {
    const response = await this.client.get<TMDBSeason>(
      `/tv/${tvId}/season/${seasonNumber}`,
      {
        params: {
          language: options?.language,
          append_to_response: 'external_ids,credits,images',
        },
      }
    );
    return response.data;
  }

  /**
   * Get episode details
   * @param tvId - TMDB TV show ID
   * @param seasonNumber - Season number
   * @param episodeNumber - Episode number
   */
  async getEpisodeDetails(
    tvId: number,
    seasonNumber: number,
    episodeNumber: number,
    options?: {
      language?: string;
    }
  ): Promise<TMDBEpisode> {
    const response = await this.client.get<TMDBEpisode>(
      `/tv/${tvId}/season/${seasonNumber}/episode/${episodeNumber}`,
      {
        params: {
          language: options?.language,
          append_to_response: 'external_ids,credits,images',
        },
      }
    );
    return response.data;
  }

  /**
   * Get TV show by external ID (IMDB, TVDB)
   * @param externalId - External ID (e.g., "tt1234567" for IMDB)
   * @param source - Source of the ID ("imdb_id" or "tvdb_id")
   */
  async findTVShowByExternalId(
    externalId: string,
    source: 'imdb_id' | 'tvdb_id',
    options?: {
      language?: string;
    }
  ): Promise<TMDBFindResult> {
    const response = await this.client.get<TMDBFindResult>('/find/' + externalId, {
      params: {
        external_source: source,
        language: options?.language,
      },
    });
    return response.data;
  }

  /**
   * Get images for a TV show
   * @param tvId - TMDB TV show ID
   */
  async getTVShowImages(tvId: number, options?: {
    language?: string;
  }) {
    // Build include_image_language: requested language + en-US,null
    const includeLanguages = options?.language
      ? `${options.language},en-US,null`
      : 'en-US,null';

    const response = await this.client.get(`/tv/${tvId}/images`, {
      params: {
        include_image_language: includeLanguages,
      },
    });
    return response.data;
  }

  /**
   * Get images for a season
   * @param tvId - TMDB TV show ID
   * @param seasonNumber - Season number
   */
  async getSeasonImages(tvId: number, seasonNumber: number, options?: {
    language?: string;
  }) {
    // Build include_image_language: requested language + en-US,null
    const includeLanguages = options?.language
      ? `${options.language},en-US,null`
      : 'en-US,null';

    const response = await this.client.get(`/tv/${tvId}/season/${seasonNumber}/images`, {
      params: {
        include_image_language: includeLanguages,
      },
    });
    return response.data;
  }

  /**
   * Get images for an episode
   * @param tvId - TMDB TV show ID
   * @param seasonNumber - Season number
   * @param episodeNumber - Episode number
   */
  async getEpisodeImages(tvId: number, seasonNumber: number, episodeNumber: number, options?: {
    language?: string;
  }) {
    // Build include_image_language: requested language + en-US,null
    const includeLanguages = options?.language
      ? `${options.language},en-US,null`
      : 'en-US,null';

    const response = await this.client.get(`/tv/${tvId}/season/${seasonNumber}/episode/${episodeNumber}/images`, {
      params: {
        include_image_language: includeLanguages,
      },
    });
    return response.data;
  }

  /**
   * Get episode group details (alternative episode orderings)
   * @param groupId - TMDB episode group ID (e.g., "5a6bba1d0e0a26527f005e71")
   */
  async getEpisodeGroupDetails(groupId: string): Promise<TMDBEpisodeGroupDetails> {
    const response = await this.client.get<TMDBEpisodeGroupDetails>(`/tv/episode_group/${groupId}`);
    return response.data;
  }

}
