/**
 * Match Service - Handles matching requests for TV shows, seasons, and episodes
 * See: docs/API Endpoints.md - Match Feature
 */

import { TMDBClient } from './TMDBClient';
import { TMDBMapper } from '../mappers/TMDBMapper';
import { MetadataResponse, ShowMetadata, SeasonMetadata, EpisodeMetadata } from '../models/Metadata';
import { TV_PROVIDER_IDENTIFIER } from '../providers/TVProvider';

/**
 * Match request body parameters
 */
export interface MatchRequest {
  type: number; // 2=show, 3=season, 4=episode
  title?: string;
  parentTitle?: string; // For seasons
  grandparentTitle?: string; // For episodes
  year?: number;
  guid?: string; // External ID (e.g., "tvdb://12345")
  index?: number; // Season number or episode number
  parentIndex?: number; // Season number for episodes
  date?: string; // Air date for episode matching (YYYY-MM-DD format)
  filename?: string;
  manual?: number; // 0 or 1
  includeAdult?: number; // 0 or 1
  includeChildren?: number; // 0 or 1
  episodeOrder?: string; // Episode group ID for alternative ordering
}

/**
 * Match service options
 */
export interface MatchServiceOptions {
  language?: string;
  country?: string;
}

export class MatchService {
  private tmdbClient: TMDBClient;
  private mapper: TMDBMapper | null = null;

  constructor(apiKey: string) {
    this.tmdbClient = new TMDBClient(apiKey);
  }

  /**
   * Initialize the mapper with TMDB configuration
   */
  private async getMapper(): Promise<TMDBMapper> {
    if (!this.mapper) {
      const imageBaseURL = await this.tmdbClient.getImageBaseURL();
      this.mapper = new TMDBMapper({ imageBaseURL });
    }
    return this.mapper;
  }

  /**
   * Parse external GUID to extract provider and ID
   */
  private parseExternalGuid(guid: string): { provider: string; id: string } | null {
    const match = guid.match(/^([^:]+):\/\/(.+)$/);
    if (!match) return null;

    return {
      provider: match[1],
      id: match[2],
    };
  }

  /**
   * Match TV Show
   */
  private async matchShow(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    const mapper = await this.getMapper();
    let matches: ShowMetadata[] = [];

    // Try to match by external ID first
    if (request.guid) {
      const parsed = this.parseExternalGuid(request.guid);
      if (parsed && (parsed.provider === 'imdb' || parsed.provider === 'tvdb')) {
        try {
          const externalSource = parsed.provider === 'imdb' ? 'imdb_id' : 'tvdb_id';
          const findResult = await this.tmdbClient.findTVShowByExternalId(
            parsed.id,
            externalSource,
            { language: options.language }
          );

          if (findResult.tv_results && findResult.tv_results.length > 0) {
            const tvId = findResult.tv_results[0].id;
            const showDetails = await this.tmdbClient.getTVShowDetails(tvId, {
              language: options.language,
            });

            // Use aggregate_credits if available (from append_to_response), otherwise use credits
            if (showDetails.aggregate_credits) {
              showDetails.credits = showDetails.aggregate_credits as any;
            }

            matches.push(mapper.mapTVShow(showDetails, {
              includeChildren: request.includeChildren === 1,
              country: options.country,
              episodeGroups: showDetails.episode_groups?.results,
            }));
          }
        } catch (error) {
          // Fall through to title search
        }
      }
    }

    // If no match by GUID, search by title
    if (matches.length === 0 && request.title) {
      const searchResults = await this.tmdbClient.searchTVShows(request.title, {
        language: options.language,
        year: request.year,
      });

      // Get detailed info for the top result(s)
      const limit = request.manual === 1 ? Math.min(5, searchResults.results.length) : Math.min(1, searchResults.results.length);

      for (let i = 0; i < limit; i++) {
        const tvId = searchResults.results[i].id;
        const showDetails = await this.tmdbClient.getTVShowDetails(tvId, {
          language: options.language,
        });

        // Use aggregate_credits if available (from append_to_response), otherwise use credits
        if (showDetails.aggregate_credits) {
          showDetails.credits = showDetails.aggregate_credits as any;
        }

        // Filter adult content if requested
        if (request.includeAdult !== 1 && showDetails.adult) {
          continue;
        }

        matches.push(mapper.mapTVShow(showDetails, {
          includeChildren: request.includeChildren === 1,
          country: options.country,
          episodeGroups: showDetails.episode_groups?.results,
        }));
      }
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: matches.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: matches.length,
        Metadata: matches,
      },
    };
  }

  /**
   * Match Season
   */
  private async matchSeason(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    const mapper = await this.getMapper();
    let matches: SeasonMetadata[] = [];

    if (!request.parentTitle || request.index === undefined) {
      return {
        MediaContainer: {
          offset: 0,
          totalSize: 0,
          identifier: TV_PROVIDER_IDENTIFIER,
          size: 0,
          Metadata: [],
        },
      };
    }

    // First, find the TV show
    const searchResults = await this.tmdbClient.searchTVShows(request.parentTitle, {
      language: options.language,
      year: request.year,
    });

    if (searchResults.results.length === 0) {
      return {
        MediaContainer: {
          offset: 0,
          totalSize: 0,
          identifier: TV_PROVIDER_IDENTIFIER,
          size: 0,
          Metadata: [],
        },
      };
    }

    // Get the show details
    const tvId = searchResults.results[0].id;
    const showDetails = await this.tmdbClient.getTVShowDetails(tvId, {
      language: options.language,
    });

    // Get the specific season
    try {
      const seasonDetails = await this.tmdbClient.getSeasonDetails(
        tvId,
        request.index,
        { language: options.language }
      );

      const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${tvId}`;
      const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

      const seasonMetadata = mapper.mapSeason(
        seasonDetails,
        tvId,
        showDetails.name,
        showGuid,
        showThumb || undefined,
        { includeChildren: request.includeChildren === 1 }
      );

      matches.push(seasonMetadata);
    } catch (error) {
      // Season not found
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: matches.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: matches.length,
        Metadata: matches,
      },
    };
  }

  /**
   * Match Episode
   */
  private async matchEpisode(
    request: MatchRequest,
    options: MatchServiceOptions
  ): Promise<MetadataResponse> {
    const mapper = await this.getMapper();
    let matches: EpisodeMetadata[] = [];

    // Validate that we have either (index + parentIndex) or date
    const hasIndexes = request.index !== undefined && request.parentIndex !== undefined;
    const hasDate = request.date !== undefined;

    if (!request.grandparentTitle || (!hasIndexes && !hasDate)) {
      // Bad request - need either indexes or date
      throw new Error('Episode matching requires either (index + parentIndex) or date parameter');
    }

    // First, find the TV show
    const searchResults = await this.tmdbClient.searchTVShows(request.grandparentTitle, {
      language: options.language,
      year: request.year,
    });

    if (searchResults.results.length === 0) {
      return {
        MediaContainer: {
          offset: 0,
          totalSize: 0,
          identifier: TV_PROVIDER_IDENTIFIER,
          size: 0,
          Metadata: [],
        },
      };
    }

    // Get the show details
    const tvId = searchResults.results[0].id;
    const showDetails = await this.tmdbClient.getTVShowDetails(tvId, {
      language: options.language,
    });

    // Match by index (season/episode number)
    if (hasIndexes) {
      try {
        const episodeDetails = await this.tmdbClient.getEpisodeDetails(
          tvId,
          request.parentIndex!,
          request.index!,
          { language: options.language }
        );

        const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${tvId}`;
        const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tmdb-season-${tvId}-${request.parentIndex}`;
        const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

        const episodeMetadata = mapper.mapEpisode(
          episodeDetails,
          tvId,
          showDetails.name,
          showGuid,
          `Season ${request.parentIndex}`,
          seasonGuid,
          showThumb || undefined,
          undefined
        );

        matches.push(episodeMetadata);
      } catch (error) {
        // Episode not found
      }
    }
    // Match by air date
    else if (hasDate) {
      // Fetch all seasons and search for episode by air date
      const seasons = showDetails.seasons?.filter((s) => s.season_number >= 1) || [];

      for (const season of seasons) {
        try {
          const seasonDetails = await this.tmdbClient.getSeasonDetails(
            tvId,
            season.season_number,
            { language: options.language }
          );

          // Find episode with matching air date
          const matchingEpisode = seasonDetails.episodes?.find(
            (ep) => ep.air_date === request.date
          );

          if (matchingEpisode) {
            const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${tvId}`;
            const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tmdb-season-${tvId}-${season.season_number}`;
            const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

            const episodeMetadata = mapper.mapEpisode(
              matchingEpisode,
              tvId,
              showDetails.name,
              showGuid,
              `Season ${season.season_number}`,
              seasonGuid,
              showThumb || undefined,
              undefined
            );

            matches.push(episodeMetadata);
            break; // Found the episode, stop searching
          }
        } catch (error) {
          // Season not found or error fetching, continue to next season
          continue;
        }
      }
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: matches.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: matches.length,
        Metadata: matches,
      },
    };
  }

  /**
   * Main match handler
   */
  async match(
    request: MatchRequest,
    options: MatchServiceOptions = {}
  ): Promise<MetadataResponse> {
    switch (request.type) {
      case 2: // Show
        return this.matchShow(request, options);
      case 3: // Season
        return this.matchSeason(request, options);
      case 4: // Episode
        return this.matchEpisode(request, options);
      default:
        throw new Error(`Unsupported metadata type: ${request.type}`);
    }
  }
}
