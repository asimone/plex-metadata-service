/**
 * Metadata Service - Handles metadata requests by ratingKey
 * See: docs/API Endpoints.md - Metadata Feature
 */

import { TMDBClient } from './TMDBClient';
import { TMDBMapper } from '../mappers/TMDBMapper';
import { MetadataResponse, ShowMetadata, SeasonMetadata, EpisodeMetadata, Image } from '../models/Metadata';
import { TV_PROVIDER_IDENTIFIER } from '../providers/TVProvider';
import { constructGuid, constructMetadataKey, constructMetadataKeyWithChildren } from '../utils/guid';

/**
 * Images response
 */
export interface ImagesResponse {
  MediaContainer: {
    offset: number;
    totalSize: number;
    identifier: string;
    size: number;
    Image: Image[];
  };
}

/**
 * Metadata service options
 */
export interface MetadataServiceOptions {
  language?: string;
  country?: string;
  includeChildren?: boolean;
  episodeOrder?: string; // Episode group ID for alternative ordering
}

/**
 * Paging options
 */
export interface PagingOptions {
  containerSize?: number;
  containerStart?: number;
}

/**
 * Parsed ratingKey components
 */
interface ParsedRatingKey {
  type: 'show' | 'season' | 'episode';
  tvId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeGroupId?: string;
}

export class MetadataService {
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
   * Parse ratingKey to extract metadata type and IDs
   * Format examples:
   * - tmdb-show-15260
   * - tmdb-season-15260-1
   * - tmdb-season-15260-1-dvd-5a6bba1d0e0a26527f005e71 (with episode group)
   * - tmdb-episode-15260-1-5
   * - tmdb-episode-15260-1-5-dvd-5a6bba1d0e0a26527f005e71 (with episode group)
   */
  private parseRatingKey(ratingKey: string): ParsedRatingKey | null {
    // Show: tmdb-show-{id}
    const showMatch = ratingKey.match(/^tmdb-show-(\d+)$/);
    if (showMatch) {
      return {
        type: 'show',
        tvId: parseInt(showMatch[1], 10),
      };
    }

    // Season with episode group: tmdb-season-{tvId}-{seasonNumber}-{groupType}-{groupId}
    const seasonGroupMatch = ratingKey.match(/^tmdb-season-(\d+)-(\d+)-([a-z]+)-([a-f0-9]+)$/);
    if (seasonGroupMatch) {
      return {
        type: 'season',
        tvId: parseInt(seasonGroupMatch[1], 10),
        seasonNumber: parseInt(seasonGroupMatch[2], 10),
        episodeGroupId: seasonGroupMatch[4],
      };
    }

    // Season: tmdb-season-{tvId}-{seasonNumber}
    const seasonMatch = ratingKey.match(/^tmdb-season-(\d+)-(\d+)$/);
    if (seasonMatch) {
      return {
        type: 'season',
        tvId: parseInt(seasonMatch[1], 10),
        seasonNumber: parseInt(seasonMatch[2], 10),
      };
    }

    // Episode with episode group: tmdb-episode-{tvId}-{seasonNumber}-{episodeNumber}-{groupType}-{groupId}
    const episodeGroupMatch = ratingKey.match(/^tmdb-episode-(\d+)-(\d+)-(\d+)-([a-z]+)-([a-f0-9]+)$/);
    if (episodeGroupMatch) {
      return {
        type: 'episode',
        tvId: parseInt(episodeGroupMatch[1], 10),
        seasonNumber: parseInt(episodeGroupMatch[2], 10),
        episodeNumber: parseInt(episodeGroupMatch[3], 10),
        episodeGroupId: episodeGroupMatch[5],
      };
    }

    // Episode: tmdb-episode-{tvId}-{seasonNumber}-{episodeNumber}
    const episodeMatch = ratingKey.match(/^tmdb-episode-(\d+)-(\d+)-(\d+)$/);
    if (episodeMatch) {
      return {
        type: 'episode',
        tvId: parseInt(episodeMatch[1], 10),
        seasonNumber: parseInt(episodeMatch[2], 10),
        episodeNumber: parseInt(episodeMatch[3], 10),
      };
    }

    return null;
  }

  /**
   * Get TV Show metadata by ratingKey
   */
  private async getShow(
    tvId: number,
    options: MetadataServiceOptions
  ): Promise<MetadataResponse> {
    const mapper = await this.getMapper();

    const showDetails = await this.tmdbClient.getTVShowDetails(tvId, {
      language: options.language,
    });

    // Use aggregate_credits if available (from append_to_response), otherwise use credits
    if (showDetails.aggregate_credits) {
      showDetails.credits = showDetails.aggregate_credits as any;
    }

    // If includeChildren and episodeOrder are both set, we need to fetch episode group children
    if (options.includeChildren && options.episodeOrder) {
      // Fetch episode group details
      const episodeGroupDetails = await this.tmdbClient.getEpisodeGroupDetails(options.episodeOrder);

      // Map show metadata without children first
      const showMetadata = mapper.mapTVShow(showDetails, {
        includeChildren: false, // We'll add children manually
        country: options.country,
        episodeGroups: showDetails.episode_groups?.results,
      });

      const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${tvId}`;
      const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

      // Map episode group seasons
      const episodeGroupSeasons = mapper.mapEpisodeGroupSeasons(
        episodeGroupDetails,
        tvId,
        showDetails.name,
        showGuid,
        showThumb || undefined
      );

      // Add episode group seasons as children
      showMetadata.Children = {
        size: episodeGroupSeasons.length,
        Metadata: episodeGroupSeasons,
      };

      return {
        MediaContainer: {
          offset: 0,
          totalSize: 1,
          identifier: TV_PROVIDER_IDENTIFIER,
          size: 1,
          Metadata: [showMetadata],
        },
      };
    }

    // Default: use normal mapping with regular seasons (if includeChildren is true)
    const showMetadata = mapper.mapTVShow(showDetails, {
      includeChildren: options.includeChildren,
      country: options.country,
      episodeGroups: showDetails.episode_groups?.results,
    });

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [showMetadata],
      },
    };
  }

  /**
   * Get Season metadata by ratingKey
   */
  private async getSeason(
    tvId: number,
    seasonNumber: number,
    options: MetadataServiceOptions,
    episodeGroupId?: string
  ): Promise<MetadataResponse> {
    const mapper = await this.getMapper();

    // If this is an episode group season and includeChildren is true
    if (episodeGroupId && options.includeChildren) {
      // Fetch episode group details and show details
      const [showDetails, episodeGroupDetails] = await Promise.all([
        this.tmdbClient.getTVShowDetails(tvId, {
          language: options.language,
        }),
        this.tmdbClient.getEpisodeGroupDetails(episodeGroupId),
      ]);

      // Find the specific group (season) by order
      const group = episodeGroupDetails.groups.find(g => g.order === seasonNumber);
      if (!group) {
        throw new Error(`Episode group season ${seasonNumber} not found`);
      }

      // Fetch all TMDB episodes referenced in this group
      const uniqueSeasons = [...new Set(group.episodes.map(e => e.season_number))];
      const allSeasonDetails = await Promise.all(
        uniqueSeasons.map(sn =>
          this.tmdbClient.getSeasonDetails(tvId, sn, {
            language: options.language,
          })
        )
      );

      // Flatten all episodes
      const allTmdbEpisodes = allSeasonDetails.flatMap(sd => sd.episodes || []);

      const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${tvId}`;
      const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

      // Create season metadata using episode group format
      const groupTypeShort = this.getEpisodeGroupTypeShortTag(episodeGroupDetails.type);
      const ratingKey = `tmdb-season-${tvId}-${seasonNumber}-${groupTypeShort}-${episodeGroupId}`;
      const parentRatingKey = `tmdb-show-${tvId}`;

      // Map episode group episodes
      const episodeMetadata = mapper.mapEpisodeGroupEpisodes(
        group,
        allTmdbEpisodes,
        episodeGroupId,
        episodeGroupDetails.type,
        tvId,
        showDetails.name,
        showGuid,
        group.name,
        seasonNumber,
        showThumb || undefined
      );

      const seasonMetadata: SeasonMetadata = {
        type: 'season',
        ratingKey,
        key: constructMetadataKeyWithChildren(ratingKey),
        guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'season', ratingKey),
        title: group.name,
        originallyAvailableAt: '',
        index: seasonNumber,
        parentRatingKey,
        parentKey: constructMetadataKey(parentRatingKey),
        parentGuid: showGuid,
        parentType: 'show',
        parentTitle: showDetails.name,
        parentThumb: showThumb || undefined,
        Children: {
          size: episodeMetadata.length,
          Metadata: episodeMetadata,
        },
      };

      return {
        MediaContainer: {
          offset: 0,
          totalSize: 1,
          identifier: TV_PROVIDER_IDENTIFIER,
          size: 1,
          Metadata: [seasonMetadata],
        },
      };
    }

    // Default: Get both show details (for show metadata) and season details
    const [showDetails, seasonDetails] = await Promise.all([
      this.tmdbClient.getTVShowDetails(tvId, {
        language: options.language,
      }),
      this.tmdbClient.getSeasonDetails(tvId, seasonNumber, {
        language: options.language,
      }),
    ]);

    const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${tvId}`;
    const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

    const seasonMetadata = mapper.mapSeason(
      seasonDetails,
      tvId,
      showDetails.name,
      showGuid,
      showThumb || undefined,
      { includeChildren: options.includeChildren }
    );

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [seasonMetadata],
      },
    };
  }

  /**
   * Get short tag for episode group type (for ratingKey)
   */
  private getEpisodeGroupTypeShortTag(type: number): string {
    const typeMap: { [key: number]: string } = {
      1: 'aired',
      2: 'absolute',
      3: 'dvd',
      4: 'digital',
      5: 'story',
      6: 'production',
      7: 'tv',
    };
    return typeMap[type] || 'unknown';
  }

  /**
   * Get Episode metadata by ratingKey
   */
  private async getEpisode(
    tvId: number,
    seasonNumber: number,
    episodeNumber: number,
    options: MetadataServiceOptions
  ): Promise<MetadataResponse> {
    const mapper = await this.getMapper();

    // Get show details and episode details
    const [showDetails, episodeDetails] = await Promise.all([
      this.tmdbClient.getTVShowDetails(tvId, {
        language: options.language,
      }),
      this.tmdbClient.getEpisodeDetails(tvId, seasonNumber, episodeNumber, {
        language: options.language,
      }),
    ]);

    const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${tvId}`;
    const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tmdb-season-${tvId}-${seasonNumber}`;
    const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

    const episodeMetadata = mapper.mapEpisode(
      episodeDetails,
      tvId,
      showDetails.name,
      showGuid,
      `Season ${seasonNumber}`,
      seasonGuid,
      showThumb || undefined,
      undefined
    );

    return {
      MediaContainer: {
        offset: 0,
        totalSize: 1,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: 1,
        Metadata: [episodeMetadata],
      },
    };
  }

  /**
   * Get metadata by ratingKey
   * @param ratingKey - The ratingKey to fetch (e.g., "tmdb-show-15260")
   * @param options - Language, country, and includeChildren options
   */
  async getMetadata(
    ratingKey: string,
    options: MetadataServiceOptions = {}
  ): Promise<MetadataResponse> {
    const parsed = this.parseRatingKey(ratingKey);

    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    switch (parsed.type) {
      case 'show':
        return this.getShow(parsed.tvId, options);
      case 'season':
        if (parsed.seasonNumber === undefined) {
          throw new Error(`Invalid season ratingKey: ${ratingKey}`);
        }
        return this.getSeason(parsed.tvId, parsed.seasonNumber, options, parsed.episodeGroupId);
      case 'episode':
        if (parsed.seasonNumber === undefined || parsed.episodeNumber === undefined) {
          throw new Error(`Invalid episode ratingKey: ${ratingKey}`);
        }
        return this.getEpisode(parsed.tvId, parsed.seasonNumber, parsed.episodeNumber, options);
      default:
        throw new Error(`Unsupported metadata type: ${parsed.type}`);
    }
  }

  /**
   * Get all images for an item by ratingKey
   * @param ratingKey - The ratingKey to fetch images for
   * @param options - Language options
   */
  async getImages(
    ratingKey: string,
    options: MetadataServiceOptions = {}
  ): Promise<ImagesResponse> {
    const parsed = this.parseRatingKey(ratingKey);

    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    const images: Image[] = [];

    switch (parsed.type) {
      case 'show': {
        const [showDetails, showImages] = await Promise.all([
          this.tmdbClient.getTVShowDetails(parsed.tvId, {
            language: options.language,
          }),
          this.tmdbClient.getTVShowImages(parsed.tvId, {
            language: options.language,
          }),
        ]);

        // Add all posters
        if (showImages.posters) {
          for (const poster of showImages.posters) {
            images.push({
              type: 'coverPoster',
              url: (await this.tmdbClient.getImageURL(poster.file_path))!,
              alt: showDetails.name,
            });
          }
        }

        // Add all backdrops
        if (showImages.backdrops) {
          for (const backdrop of showImages.backdrops) {
            // Regular backdrops
            if (backdrop.aspect_ratio < 0.9 || backdrop.aspect_ratio > 1.1) {
              images.push({
                type: 'background',
                url: (await this.tmdbClient.getImageURL(backdrop.file_path))!,
                alt: showDetails.name,
              });
            } else {
              // Square backdrops (aspect ratio close to 1:1)
              images.push({
                type: 'backgroundSquare',
                url: (await this.tmdbClient.getImageURL(backdrop.file_path))!,
                alt: showDetails.name,
              });
            }
          }
        }

        // Add all logos
        if (showImages.logos) {
          for (const logo of showImages.logos) {
            images.push({
              type: 'clearLogo',
              url: (await this.tmdbClient.getImageURL(logo.file_path))!,
              alt: showDetails.name,
            });
          }
        }
        break;
      }

      case 'season': {
        if (parsed.seasonNumber === undefined) {
          throw new Error(`Invalid season ratingKey: ${ratingKey}`);
        }

        const [showDetails, seasonImages] = await Promise.all([
          this.tmdbClient.getTVShowDetails(parsed.tvId, {
            language: options.language,
          }),
          this.tmdbClient.getSeasonImages(parsed.tvId, parsed.seasonNumber, {
            language: options.language,
          }),
        ]);

        // Add all season posters
        if (seasonImages.posters) {
          for (const poster of seasonImages.posters) {
            images.push({
              type: 'coverPoster',
              url: (await this.tmdbClient.getImageURL(poster.file_path))!,
              alt: `${showDetails.name} - Season ${parsed.seasonNumber}`,
            });
          }
        }
        break;
      }

      case 'episode': {
        if (parsed.seasonNumber === undefined || parsed.episodeNumber === undefined) {
          throw new Error(`Invalid episode ratingKey: ${ratingKey}`);
        }

        const [showDetails, episodeImages] = await Promise.all([
          this.tmdbClient.getTVShowDetails(parsed.tvId, {
            language: options.language,
          }),
          this.tmdbClient.getEpisodeImages(parsed.tvId, parsed.seasonNumber, parsed.episodeNumber, {
            language: options.language,
          }),
        ]);

        // Add all episode stills
        if (episodeImages.stills) {
          for (const still of episodeImages.stills) {
            images.push({
              type: 'snapshot',
              url: (await this.tmdbClient.getImageURL(still.file_path))!,
              alt: `${showDetails.name} - S${parsed.seasonNumber}E${parsed.episodeNumber}`,
            });
          }
        }
        break;
      }

      default:
        throw new Error(`Unsupported metadata type for images: ${parsed.type}`);
    }

    return {
      MediaContainer: {
        offset: 0,
        totalSize: images.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: images.length,
        Image: images,
      },
    };
  }

  /**
   * Get children of an item (Seasons for Shows, Episodes for Seasons)
   * @param ratingKey - The ratingKey to fetch children for
   * @param options - Language, country options
   * @param paging - Paging options (containerSize, containerStart)
   */
  async getChildren(
    ratingKey: string,
    options: MetadataServiceOptions = {},
    paging: PagingOptions = {}
  ): Promise<MetadataResponse> {
    const parsed = this.parseRatingKey(ratingKey);

    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    const mapper = await this.getMapper();
    const containerSize = paging.containerSize ?? 20;
    const containerStart = paging.containerStart ?? 1;

    switch (parsed.type) {
      case 'show': {
        // Check if episode ordering is requested
        if (options.episodeOrder) {
          // Fetch episode group details
          const [showDetails, episodeGroupDetails] = await Promise.all([
            this.tmdbClient.getTVShowDetails(parsed.tvId, {
              language: options.language,
            }),
            this.tmdbClient.getEpisodeGroupDetails(options.episodeOrder),
          ]);

          const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${parsed.tvId}`;
          const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

          // Map episode group seasons
          const allSeasons = mapper.mapEpisodeGroupSeasons(
            episodeGroupDetails,
            parsed.tvId,
            showDetails.name,
            showGuid,
            showThumb || undefined
          );

          // Apply paging (containerStart is 1-based)
          const startIndex = containerStart - 1;
          const endIndex = startIndex + containerSize;
          const pagedSeasons = allSeasons.slice(startIndex, endIndex);

          return {
            MediaContainer: {
              offset: startIndex,
              totalSize: allSeasons.length,
              identifier: TV_PROVIDER_IDENTIFIER,
              size: pagedSeasons.length,
              Metadata: pagedSeasons,
            },
          };
        }

        // Default: Get show details with all seasons
        const showDetails = await this.tmdbClient.getTVShowDetails(parsed.tvId, {
          language: options.language,
        });

        const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${parsed.tvId}`;
        const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

        // Map all seasons (filter out specials with season_number < 0)
        const allSeasons = showDetails.seasons
          ?.filter((s) => s.season_number >= 0)
          .map((season) =>
            mapper.mapSeason(
              season,
              parsed.tvId,
              showDetails.name,
              showGuid,
              showThumb || undefined
            )
          ) || [];

        // Apply paging (containerStart is 1-based)
        const startIndex = containerStart - 1;
        const endIndex = startIndex + containerSize;
        const pagedSeasons = allSeasons.slice(startIndex, endIndex);

        return {
          MediaContainer: {
            offset: startIndex,
            totalSize: allSeasons.length,
            identifier: TV_PROVIDER_IDENTIFIER,
            size: pagedSeasons.length,
            Metadata: pagedSeasons,
          },
        };
      }

      case 'season': {
        if (parsed.seasonNumber === undefined) {
          throw new Error(`Invalid season ratingKey: ${ratingKey}`);
        }

        // Check if this is an episode group season
        if (parsed.episodeGroupId) {
          // Fetch episode group details and show details
          const [showDetails, episodeGroupDetails] = await Promise.all([
            this.tmdbClient.getTVShowDetails(parsed.tvId, {
              language: options.language,
            }),
            this.tmdbClient.getEpisodeGroupDetails(parsed.episodeGroupId),
          ]);

          // Find the specific group (season) by order
          const group = episodeGroupDetails.groups.find(g => g.order === parsed.seasonNumber);
          if (!group) {
            throw new Error(`Episode group season ${parsed.seasonNumber} not found`);
          }

          // Fetch all TMDB episodes referenced in this group
          const episodesToFetch = group.episodes.map(ep => ({
            seasonNumber: ep.season_number,
            episodeNumber: ep.episode_number,
          }));

          // Fetch unique season/episode combinations
          const uniqueSeasons = [...new Set(episodesToFetch.map(e => e.seasonNumber))];
          const allSeasonDetails = await Promise.all(
            uniqueSeasons.map(sn =>
              this.tmdbClient.getSeasonDetails(parsed.tvId, sn, {
                language: options.language,
              })
            )
          );

          // Flatten all episodes
          const allTmdbEpisodes = allSeasonDetails.flatMap(sd => sd.episodes || []);

          const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${parsed.tvId}`;
          const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

          // Map episode group episodes
          const allEpisodes = mapper.mapEpisodeGroupEpisodes(
            group,
            allTmdbEpisodes,
            parsed.episodeGroupId,
            episodeGroupDetails.type,
            parsed.tvId,
            showDetails.name,
            showGuid,
            group.name,
            parsed.seasonNumber,
            showThumb || undefined
          );

          // Apply paging (containerStart is 1-based)
          const startIndex = containerStart - 1;
          const endIndex = startIndex + containerSize;
          const pagedEpisodes = allEpisodes.slice(startIndex, endIndex);

          return {
            MediaContainer: {
              offset: startIndex,
              totalSize: allEpisodes.length,
              identifier: TV_PROVIDER_IDENTIFIER,
              size: pagedEpisodes.length,
              Metadata: pagedEpisodes,
            },
          };
        }

        // Default: Get season details with all episodes
        const [showDetails, seasonDetails] = await Promise.all([
          this.tmdbClient.getTVShowDetails(parsed.tvId, {
            language: options.language,
          }),
          this.tmdbClient.getSeasonDetails(parsed.tvId, parsed.seasonNumber, {
            language: options.language,
          }),
        ]);

        const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${parsed.tvId}`;
        const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tmdb-season-${parsed.tvId}-${parsed.seasonNumber}`;
        const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

        // Map all episodes
        const allEpisodes = seasonDetails.episodes?.map((episode) =>
          mapper.mapEpisode(
            episode,
            parsed.tvId,
            showDetails.name,
            showGuid,
            `Season ${parsed.seasonNumber}`,
            seasonGuid,
            showThumb || undefined,
            undefined
          )
        ) || [];

        // Apply paging (containerStart is 1-based)
        const startIndex = containerStart - 1;
        const endIndex = startIndex + containerSize;
        const pagedEpisodes = allEpisodes.slice(startIndex, endIndex);

        return {
          MediaContainer: {
            offset: startIndex,
            totalSize: allEpisodes.length,
            identifier: TV_PROVIDER_IDENTIFIER,
            size: pagedEpisodes.length,
            Metadata: pagedEpisodes,
          },
        };
      }

      default:
        throw new Error(`Cannot get children for type: ${parsed.type}`);
    }
  }

  /**
   * Get grandchildren of an item (Episodes for Shows)
   * @param ratingKey - The ratingKey to fetch grandchildren for
   * @param options - Language, country options
   * @param paging - Paging options (containerSize, containerStart)
   */
  async getGrandchildren(
    ratingKey: string,
    options: MetadataServiceOptions = {},
    paging: PagingOptions = {}
  ): Promise<MetadataResponse> {
    const parsed = this.parseRatingKey(ratingKey);

    if (!parsed) {
      throw new Error(`Invalid ratingKey format: ${ratingKey}`);
    }

    if (parsed.type !== 'show') {
      throw new Error(`Cannot get grandchildren for type: ${parsed.type}`);
    }

    const mapper = await this.getMapper();
    const containerSize = paging.containerSize ?? 20;
    const containerStart = paging.containerStart ?? 1;

    // Get show details
    const showDetails = await this.tmdbClient.getTVShowDetails(parsed.tvId, {
      language: options.language,
    });

    const showGuid = `${TV_PROVIDER_IDENTIFIER}://show/tmdb-show-${parsed.tvId}`;
    const showThumb = await this.tmdbClient.getImageURL(showDetails.poster_path);

    // Fetch all episodes from all seasons
    const allEpisodes: EpisodeMetadata[] = [];

    // Get all regular seasons (season_number >= 1)
    const regularSeasons = showDetails.seasons?.filter((s) => s.season_number >= 1) || [];

    for (const season of regularSeasons) {
      const seasonDetails = await this.tmdbClient.getSeasonDetails(
        parsed.tvId,
        season.season_number,
        { language: options.language }
      );

      const seasonGuid = `${TV_PROVIDER_IDENTIFIER}://season/tmdb-season-${parsed.tvId}-${season.season_number}`;

      const episodes = seasonDetails.episodes?.map((episode) =>
        mapper.mapEpisode(
          episode,
          parsed.tvId,
          showDetails.name,
          showGuid,
          `Season ${season.season_number}`,
          seasonGuid,
          showThumb || undefined,
          undefined
        )
      ) || [];

      allEpisodes.push(...episodes);
    }

    // Apply paging (containerStart is 1-based)
    const startIndex = containerStart - 1;
    const endIndex = startIndex + containerSize;
    const pagedEpisodes = allEpisodes.slice(startIndex, endIndex);

    return {
      MediaContainer: {
        offset: startIndex,
        totalSize: allEpisodes.length,
        identifier: TV_PROVIDER_IDENTIFIER,
        size: pagedEpisodes.length,
        Metadata: pagedEpisodes,
      },
    };
  }
}
