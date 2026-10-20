/**
 * Maps TMDB API responses to Plex Metadata models
 */

import {
  ShowMetadata,
  SeasonMetadata,
  EpisodeMetadata,
  Image,
  Genre,
  Guid,
  Person,
  Rating,
  Network,
  Country,
  Studio,
  SeasonType,
} from '../models/Metadata';
import {
  TMDBTVShow,
  TMDBSeason,
  TMDBEpisode,
  TMDBCastMember,
  TMDBCrewMember,
  TMDBAggregateCastMember,
  TMDBAggregateCrewMember,
  TMDBEpisodeGroup,
  TMDBEpisodeGroupDetails,
  TMDBEpisodeGroupGroup,
} from '../types/tmdb';
import { TV_PROVIDER_IDENTIFIER } from '../providers/TVProvider';
import { constructGuid, constructMetadataKey, constructMetadataKeyWithChildren, createExternalGuid } from '../utils/guid';

/**
 * Configuration for the mapper
 */
export interface MapperConfig {
  imageBaseURL: string;
}

export class TMDBMapper {
  private config: MapperConfig;

  constructor(config: MapperConfig) {
    this.config = config;
  }

  /**
   * Construct full image URL
   */
  private getImageURL(path: string | null, size: string = 'original'): string | undefined {
    if (!path) return undefined;
    return `${this.config.imageBaseURL}${size}${path}`;
  }

  /**
   * Map TMDB images to Plex Image array
   * Only includes one image of each type
   */
  private mapImages(tmdbShow: TMDBTVShow): Image[] | undefined {
    const images: Image[] = [];

    // Poster (coverPoster) - only one
    if (tmdbShow.poster_path) {
      images.push({
        type: 'coverPoster',
        url: this.getImageURL(tmdbShow.poster_path)!,
        alt: tmdbShow.name,
      });
    }

    // Backdrop (background) - only one
    if (tmdbShow.backdrop_path) {
      images.push({
        type: 'background',
        url: this.getImageURL(tmdbShow.backdrop_path)!,
        alt: tmdbShow.name,
      });
    }

    // Clear logo - only one (from images append if available)
    if (tmdbShow.images?.logos && tmdbShow.images.logos.length > 0) {
      images.push({
        type: 'clearLogo',
        url: this.getImageURL(tmdbShow.images.logos[0].file_path)!,
        alt: tmdbShow.name,
      });
    }

    // Background square - only one (from images append if available)
    if (tmdbShow.images?.backdrops && tmdbShow.images.backdrops.length > 0) {
      // Find a backdrop with roughly square aspect ratio (close to 1:1)
      const squareBackdrop = tmdbShow.images.backdrops.find(
        backdrop => backdrop.aspect_ratio >= 0.9 && backdrop.aspect_ratio <= 1.1
      );
      if (squareBackdrop) {
        images.push({
          type: 'backgroundSquare',
          url: this.getImageURL(squareBackdrop.file_path)!,
          alt: tmdbShow.name,
        });
      }
    }

    return images.length > 0 ? images : undefined;
  }

  /**
   * Map TMDB genres to Plex Genre array
   */
  private mapGenres(tmdbShow: TMDBTVShow): Genre[] | undefined {
    if (!tmdbShow.genres || tmdbShow.genres.length === 0) return undefined;

    return tmdbShow.genres.map(genre => ({
      tag: genre.name,
    }));
  }

  /**
   * Map external IDs to Plex Guid array
   */
  private mapExternalGuids(tmdbShow: TMDBTVShow): Guid[] | undefined {
    const guids: Guid[] = [];

    if (tmdbShow.external_ids?.imdb_id) {
      guids.push({ id: createExternalGuid('imdb', tmdbShow.external_ids.imdb_id) });
    }

    // Always include TMDB ID
    guids.push({ id: createExternalGuid('tmdb', tmdbShow.id) });

    if (tmdbShow.external_ids?.tvdb_id) {
      guids.push({ id: createExternalGuid('tvdb', tmdbShow.external_ids.tvdb_id) });
    }

    return guids.length > 0 ? guids : undefined;
  }

  /**
   * Map TMDB cast to Plex Role array
   * Limits to 1000 to avoid excessively large responses
   */
  private mapCast(cast: TMDBCastMember[]): Person[] | undefined {
    if (!cast || cast.length === 0) return undefined;

    // Sort by order first, then map
    const sortedCast = [...cast].sort((a, b) => a.order - b.order);

    return sortedCast.slice(0, 1000).map(member => ({
      tag: member.name,
      role: member.character,
      order: member.order + 1, // Plex uses 1-based ordering
      thumb: member.profile_path ? this.getImageURL(member.profile_path) : undefined,
    }));
  }

  /**
   * Map TMDB aggregate cast to Plex Role array
   * Used for TV shows with aggregate_credits endpoint
   * Limits to 1000 to avoid excessively large responses
   */
  private mapAggregateCast(cast: TMDBAggregateCastMember[]): Person[] | undefined {
    if (!cast || cast.length === 0) return undefined;

    // Sort by total_episode_count (descending) first, then by order (ascending)
    const sortedCast = [...cast].sort((a, b) => {
      if (b.total_episode_count !== a.total_episode_count) {
        return b.total_episode_count - a.total_episode_count;
      }
      return a.order - b.order;
    });

    return sortedCast.slice(0, 1000).map(member => {
      // Get the character name from roles array
      // If multiple roles, join them with " / "
      const characters = member.roles.map(role => role.character).filter(Boolean);
      const character = characters.length > 0 ? characters.join(' / ') : undefined;

      return {
        tag: member.name,
        role: character,
        order: member.order + 1, // Plex uses 1-based ordering
        thumb: member.profile_path ? this.getImageURL(member.profile_path) : undefined,
      };
    });
  }

  /**
   * Map TMDB crew to Plex crew arrays (Director, Producer, Writer)
   */
  private mapCrew(crew: TMDBCrewMember[]): {
    Director?: Person[];
    Producer?: Person[];
    Writer?: Person[];
  } {
    const directors: Person[] = [];
    const producers: Person[] = [];
    const writers: Person[] = [];

    crew.forEach(member => {
      const person: Person = {
        tag: member.name,
        role: member.job,
        thumb: member.profile_path ? this.getImageURL(member.profile_path) : undefined,
      };

      if (member.job === 'Director') {
        directors.push(person);
      } else if (member.department === 'Production') {
        producers.push(person);
      } else if (member.department === 'Writing') {
        writers.push(person);
      }
    });

    return {
      Director: directors.length > 0 ? directors : undefined,
      Producer: producers.length > 0 ? producers : undefined,
      Writer: writers.length > 0 ? writers : undefined,
    };
  }

  /**
   * Map TMDB aggregate crew to Plex crew arrays (Director, Producer, Writer)
   * Used for TV shows with aggregate_credits endpoint
   */
  private mapAggregateCrew(crew: TMDBAggregateCrewMember[]): {
    Director?: Person[];
    Producer?: Person[];
    Writer?: Person[];
  } {
    const directors: Person[] = [];
    const producers: Person[] = [];
    const writers: Person[] = [];

    crew.forEach(member => {
      // Get the job(s) from jobs array
      const jobs = member.jobs.map(job => job.job).filter(Boolean);
      const jobString = jobs.length > 0 ? jobs.join(' / ') : undefined;

      const person: Person = {
        tag: member.name,
        role: jobString,
        thumb: member.profile_path ? this.getImageURL(member.profile_path) : undefined,
      };

      // Check if any of the jobs is Director or if department matches
      const hasDirectorJob = member.jobs.some(job => job.job === 'Director');
      if (hasDirectorJob) {
        directors.push(person);
      } else if (member.department === 'Production') {
        producers.push(person);
      } else if (member.department === 'Writing') {
        writers.push(person);
      }
    });

    return {
      Director: directors.length > 0 ? directors : undefined,
      Producer: producers.length > 0 ? producers : undefined,
      Writer: writers.length > 0 ? writers : undefined,
    };
  }

  /**
   * Map TMDB ratings to Plex Rating array
   */
  private mapRatings(tmdbShow: TMDBTVShow): Rating[] | undefined {
    const ratings: Rating[] = [];

    if (tmdbShow.vote_average && tmdbShow.vote_count > 0) {
      ratings.push({
        image: 'themoviedb://image.rating',
        type: 'audience',
        value: tmdbShow.vote_average,
      });
    }

    return ratings.length > 0 ? ratings : undefined;
  }

  /**
   * Map TMDB networks to Plex Network array
   */
  private mapNetworks(tmdbShow: TMDBTVShow): Network[] | undefined {
    if (!tmdbShow.networks || tmdbShow.networks.length === 0) return undefined;

    return tmdbShow.networks.map(network => ({
      tag: network.name,
    }));
  }

  /**
   * Map TMDB production countries to Plex Country array
   */
  private mapCountries(tmdbShow: TMDBTVShow): Country[] | undefined {
    if (!tmdbShow.production_countries || tmdbShow.production_countries.length === 0) {
      return undefined;
    }

    return tmdbShow.production_countries.map(country => ({
      tag: country.name,
    }));
  }

  /**
   * Map TMDB production companies to Plex Studio array
   */
  private mapStudios(tmdbShow: TMDBTVShow): Studio[] | undefined {
    if (!tmdbShow.production_companies || tmdbShow.production_companies.length === 0) {
      return undefined;
    }

    return tmdbShow.production_companies.map(company => ({
      tag: company.name,
    }));
  }

  /**
   * Get content rating for a specific country (defaults to US)
   */
  private getContentRating(tmdbShow: TMDBTVShow, country: string = 'US'): string | undefined {
    if (!tmdbShow.content_ratings?.results) return undefined;

    const rating = tmdbShow.content_ratings.results.find(
      r => r.iso_3166_1 === country
    );

    if (rating) {
      return country === 'US' ? rating.rating : `${country.toLowerCase()}/${rating.rating}`;
    }

    return undefined;
  }

  /**
   * Map TMDB Episode Groups to Plex SeasonType array
   */
  private mapEpisodeGroups(episodeGroups: TMDBEpisodeGroup[]): SeasonType[] | undefined {
    if (!episodeGroups || episodeGroups.length === 0) return undefined;

    return episodeGroups.map(group => ({
      id: group.id,
      source: 'tmdb',
      tag: this.getEpisodeGroupTypeTag(group.type),
      title: group.name,
    }));
  }

  /**
   * Get human-readable tag for episode group type
   */
  private getEpisodeGroupTypeTag(type: number): string {
    const typeMap: { [key: number]: string } = {
      1: 'Original air date',
      2: 'Absolute',
      3: 'DVD',
      4: 'Digital',
      5: 'Story arc',
      6: 'Production',
      7: 'TV',
    };
    return typeMap[type] || 'Unknown';
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
   * Map Episode Group groups (like seasons) to SeasonMetadata array
   * Used when episodeOrder parameter is set to an episode group ID
   */
  mapEpisodeGroupSeasons(
    episodeGroupDetails: TMDBEpisodeGroupDetails,
    tvId: number,
    showTitle: string,
    showGuid: string,
    showThumb?: string
  ): SeasonMetadata[] {
    const groupTypeShort = this.getEpisodeGroupTypeShortTag(episodeGroupDetails.type);

    return episodeGroupDetails.groups.map((group) => {
      const ratingKey = `tmdb-season-${tvId}-${group.order}-${groupTypeShort}-${episodeGroupDetails.id}`;
      const parentRatingKey = `tmdb-show-${tvId}`;

      const metadata: SeasonMetadata = {
        type: 'season',
        ratingKey,
        key: constructMetadataKeyWithChildren(ratingKey),
        guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'season', ratingKey),
        title: group.name,
        originallyAvailableAt: '', // Episode groups don't have air dates
        index: group.order,
        parentRatingKey,
        parentKey: constructMetadataKey(parentRatingKey),
        parentGuid: showGuid,
        parentType: 'show',
        parentTitle: showTitle,
        parentThumb: showThumb,
      };

      return metadata;
    });
  }

  /**
   * Map Episode Group episodes to EpisodeMetadata array
   * Used when episodeOrder parameter is set to an episode group ID
   * @param group - The episode group "season" (group) to map episodes from
   * @param tmdbEpisodes - Array of TMDB episodes to map from (fetched separately)
   * @param episodeGroupId - The episode group ID
   * @param episodeGroupType - The episode group type (1-7)
   * @param tvId - TMDB TV show ID
   * @param showTitle - Show title
   * @param showGuid - Show GUID
   * @param seasonTitle - Season title (from group)
   * @param groupOrder - The group order (season number in episode group context)
   * @param showThumb - Show thumbnail URL
   */
  mapEpisodeGroupEpisodes(
    group: TMDBEpisodeGroupGroup,
    tmdbEpisodes: TMDBEpisode[],
    episodeGroupId: string,
    episodeGroupType: number,
    tvId: number,
    showTitle: string,
    showGuid: string,
    seasonTitle: string,
    groupOrder: number,
    showThumb?: string
  ): EpisodeMetadata[] {
    const groupTypeShort = this.getEpisodeGroupTypeShortTag(episodeGroupType);

    // Create a map of TMDB episode ID to episode details
    const episodeMap = new Map<number, TMDBEpisode>();
    tmdbEpisodes.forEach(ep => episodeMap.set(ep.id, ep));

    return group.episodes.map((groupEpisode) => {
      const tmdbEpisode = episodeMap.get(groupEpisode.id);
      if (!tmdbEpisode) {
        throw new Error(`Episode ${groupEpisode.id} not found in TMDB episodes`);
      }

      // Use the episode group's custom ordering (convert 0-based to 1-based)
      const customIndex = groupEpisode.order + 1;
      const customParentIndex = groupOrder;

      const ratingKey = `tmdb-episode-${tvId}-${customParentIndex}-${customIndex}-${groupTypeShort}-${episodeGroupId}`;
      const parentRatingKey = `tmdb-season-${tvId}-${customParentIndex}-${groupTypeShort}-${episodeGroupId}`;
      const grandparentRatingKey = `tmdb-show-${tvId}`;
      const seasonGuid = constructGuid(TV_PROVIDER_IDENTIFIER, 'season', parentRatingKey);

      const crew = tmdbEpisode.credits ? this.mapCrew(tmdbEpisode.credits.crew) : {};

      const metadata: EpisodeMetadata = {
        type: 'episode',
        ratingKey,
        key: constructMetadataKey(ratingKey),
        guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'episode', ratingKey),
        title: tmdbEpisode.name,
        originallyAvailableAt: tmdbEpisode.air_date || '',
        year: tmdbEpisode.air_date ? new Date(tmdbEpisode.air_date).getFullYear() : undefined,
        summary: tmdbEpisode.overview || undefined,
        thumb: this.getImageURL(tmdbEpisode.still_path),
        duration: tmdbEpisode.runtime ? tmdbEpisode.runtime * 60 * 1000 : undefined,
        index: customIndex, // Use episode group's custom index (1-based)
        parentIndex: customParentIndex, // Use episode group's custom parent index
        parentRatingKey,
        parentKey: constructMetadataKey(parentRatingKey),
        parentGuid: seasonGuid,
        parentType: 'season',
        parentTitle: seasonTitle,
        grandparentRatingKey,
        grandparentKey: constructMetadataKey(grandparentRatingKey),
        grandparentGuid: showGuid,
        grandparentType: 'show',
        grandparentTitle: showTitle,
        grandparentThumb: showThumb,
      };

      // Add snapshot image
      if (tmdbEpisode.still_path) {
        metadata.Image = [{
          type: 'snapshot',
          url: this.getImageURL(tmdbEpisode.still_path)!,
          alt: tmdbEpisode.name,
        }];
      }

      // Add ratings
      if (tmdbEpisode.vote_average && tmdbEpisode.vote_count > 0) {
        metadata.Rating = [{
          image: 'themoviedb://image.rating',
          type: 'audience',
          value: tmdbEpisode.vote_average,
        }];
      }

      // Add external IDs
      if (tmdbEpisode.external_ids) {
        const guids: Guid[] = [];
        if (tmdbEpisode.external_ids.imdb_id) {
          guids.push({ id: createExternalGuid('imdb', tmdbEpisode.external_ids.imdb_id) });
        }
        if (tmdbEpisode.external_ids.tvdb_id) {
          guids.push({ id: createExternalGuid('tvdb', tmdbEpisode.external_ids.tvdb_id) });
        }
        if (guids.length > 0) {
          metadata.Guid = guids;
        }
      }

      // Add cast and crew
      if (tmdbEpisode.credits) {
        metadata.Role = this.mapCast(tmdbEpisode.credits.cast);
      } else if (tmdbEpisode.guest_stars) {
        metadata.Role = this.mapCast(tmdbEpisode.guest_stars);
      }

      metadata.Producer = crew.Producer;
      metadata.Writer = crew.Writer;

      return metadata;
    });
  }

  /**
   * Map TMDB TV Show to Plex ShowMetadata
   */
  mapTVShow(tmdbShow: TMDBTVShow, options?: {
    includeChildren?: boolean;
    country?: string;
    episodeGroups?: TMDBEpisodeGroup[];
  }): ShowMetadata {
    const ratingKey = `tmdb-show-${tmdbShow.id}`;

    // Determine if we have aggregate credits or regular credits
    // Aggregate credits have 'roles' array on cast members, regular have 'character' string
    const isAggregateCredits = tmdbShow.credits?.cast?.[0] && 'roles' in tmdbShow.credits.cast[0];

    const crew = tmdbShow.credits
      ? (isAggregateCredits
          ? this.mapAggregateCrew(tmdbShow.credits.crew as TMDBAggregateCrewMember[])
          : this.mapCrew(tmdbShow.credits.crew as TMDBCrewMember[]))
      : {};

    // Calculate average episode runtime
    const avgRuntime = tmdbShow.episode_run_time.length > 0
      ? tmdbShow.episode_run_time.reduce((a, b) => a + b, 0) / tmdbShow.episode_run_time.length
      : undefined;

    const metadata: ShowMetadata = {
      type: 'show',
      ratingKey,
      key: constructMetadataKeyWithChildren(ratingKey),
      guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'show', ratingKey),
      title: tmdbShow.name,
      originalTitle: tmdbShow.original_name !== tmdbShow.name ? tmdbShow.original_name : undefined,
      originallyAvailableAt: tmdbShow.first_air_date,
      year: tmdbShow.first_air_date ? new Date(tmdbShow.first_air_date).getFullYear() : undefined,
      summary: tmdbShow.overview || undefined,
      tagline: tmdbShow.tagline || undefined,
      thumb: this.getImageURL(tmdbShow.poster_path),
      art: this.getImageURL(tmdbShow.backdrop_path),
      contentRating: this.getContentRating(tmdbShow, options?.country),
      duration: avgRuntime ? avgRuntime * 60 * 1000 : undefined, // Convert minutes to milliseconds
      studio: tmdbShow.production_companies?.[0]?.name,
      isAdult: tmdbShow.adult,
      Image: this.mapImages(tmdbShow),
      Genre: this.mapGenres(tmdbShow),
      Guid: this.mapExternalGuids(tmdbShow),
      Country: this.mapCountries(tmdbShow),
      Role: tmdbShow.credits
        ? (isAggregateCredits
            ? this.mapAggregateCast(tmdbShow.credits.cast as TMDBAggregateCastMember[])
            : this.mapCast(tmdbShow.credits.cast as TMDBCastMember[]))
        : undefined,
      Director: crew.Director,
      Producer: crew.Producer,
      Writer: crew.Writer,
      Studio: this.mapStudios(tmdbShow),
      Rating: this.mapRatings(tmdbShow),
      Network: this.mapNetworks(tmdbShow),
      SeasonType: options?.episodeGroups ? this.mapEpisodeGroups(options.episodeGroups) : undefined,
    };

    // Add Children (seasons) if requested
    if (options?.includeChildren && tmdbShow.seasons && tmdbShow.seasons.length > 0) {
      const showGuid = metadata.guid;
      const showThumb = this.getImageURL(tmdbShow.poster_path);

      const seasonMetadata = tmdbShow.seasons
        .map(season => this.mapSeason(
          season,
          tmdbShow.id,
          tmdbShow.name,
          showGuid,
          showThumb
        ));

      metadata.Children = {
        size: seasonMetadata.length,
        Metadata: seasonMetadata,
      };
    }

    // TODO: Add SeasonType support for different episode orderings

    return metadata;
  }

  /**
   * Map TMDB Season to Plex SeasonMetadata
   */
  mapSeason(
    tmdbSeason: TMDBSeason,
    tvId: number,
    showTitle: string,
    showGuid: string,
    showThumb?: string,
    options?: {
      includeChildren?: boolean;
    }
  ): SeasonMetadata {
    const ratingKey = `tmdb-season-${tvId}-${tmdbSeason.season_number}`;
    const parentRatingKey = `tmdb-show-${tvId}`;

    const metadata: SeasonMetadata = {
      type: 'season',
      ratingKey,
      key: constructMetadataKeyWithChildren(ratingKey),
      guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'season', ratingKey),
      title: tmdbSeason.name,
      originallyAvailableAt: tmdbSeason.air_date || '',
      year: tmdbSeason.air_date ? new Date(tmdbSeason.air_date).getFullYear() : undefined,
      thumb: this.getImageURL(tmdbSeason.poster_path),
      index: tmdbSeason.season_number,
      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: showGuid,
      parentType: 'show',
      parentTitle: showTitle,
      parentThumb: showThumb,
    };

    // Add external IDs
    const guids: Guid[] = [];

    // Always include TMDB ID
    guids.push({ id: createExternalGuid('tmdb', tmdbSeason.id) });

    // Add TVDB if available
    if (tmdbSeason.external_ids?.tvdb_id) {
      guids.push({ id: createExternalGuid('tvdb', tmdbSeason.external_ids.tvdb_id) });
    }

    if (guids.length > 0) {
      metadata.Guid = guids;
    }

    // Add images - always include poster if available
    const images: Image[] = [];
    if (tmdbSeason.poster_path) {
      images.push({
        type: 'coverPoster',
        url: this.getImageURL(tmdbSeason.poster_path)!,
        alt: tmdbSeason.name,
      });
    }

    // Add additional images from detailed fetch if available
    if (tmdbSeason.images?.posters && tmdbSeason.images.posters.length > 0) {
      // If we don't already have a poster from poster_path, use the first from images
      if (!tmdbSeason.poster_path && images.length === 0) {
        images.push({
          type: 'coverPoster',
          url: this.getImageURL(tmdbSeason.images.posters[0].file_path)!,
          alt: tmdbSeason.name,
        });
      }
    }

    if (images.length > 0) {
      metadata.Image = images;
    }

    // Add Children (episodes) if requested
    if (options?.includeChildren && tmdbSeason.episodes && tmdbSeason.episodes.length > 0) {
      const seasonGuid = metadata.guid;
      const seasonThumb = this.getImageURL(tmdbSeason.poster_path);

      // If season has credits, attach them to each episode
      const seasonCredits = tmdbSeason.credits;

      const episodeMetadata = tmdbSeason.episodes.map(episode => {
        // Create a copy of the episode with season cast (but not crew) added
        const episodeWithCredits = {
          ...episode,
          // Add season-level cast while preserving episode-specific crew
          credits: seasonCredits ? {
            cast: seasonCredits.cast,
            crew: episode.crew, // Use episode-specific crew
          } : episode.credits,
        };

        return this.mapEpisode(
          episodeWithCredits,
          tvId,
          showTitle,
          showGuid,
          tmdbSeason.name,
          seasonGuid,
          showThumb,
          seasonThumb
        );
      });

      metadata.Children = {
        size: episodeMetadata.length,
        Metadata: episodeMetadata,
      };
    }

    return metadata;
  }

  /**
   * Map TMDB Episode to Plex EpisodeMetadata
   */
  mapEpisode(
    tmdbEpisode: TMDBEpisode,
    tvId: number,
    showTitle: string,
    showGuid: string,
    seasonTitle: string,
    seasonGuid: string,
    showThumb?: string,
    seasonThumb?: string
  ): EpisodeMetadata {
    const ratingKey = `tmdb-episode-${tvId}-${tmdbEpisode.season_number}-${tmdbEpisode.episode_number}`;
    const parentRatingKey = `tmdb-season-${tvId}-${tmdbEpisode.season_number}`;
    const grandparentRatingKey = `tmdb-show-${tvId}`;

    // Use credits.crew if available (from episode details), otherwise fall back to crew array (from season details)
    const crewArray = tmdbEpisode.credits ? tmdbEpisode.credits.crew : tmdbEpisode.crew;
    const crew = crewArray ? this.mapCrew(crewArray) : {};

    const metadata: EpisodeMetadata = {
      type: 'episode',
      ratingKey,
      key: constructMetadataKey(ratingKey),
      guid: constructGuid(TV_PROVIDER_IDENTIFIER, 'episode', ratingKey),
      title: tmdbEpisode.name,
      originallyAvailableAt: tmdbEpisode.air_date || '',
      year: tmdbEpisode.air_date ? new Date(tmdbEpisode.air_date).getFullYear() : undefined,
      summary: tmdbEpisode.overview || undefined,
      thumb: this.getImageURL(tmdbEpisode.still_path),
      duration: tmdbEpisode.runtime ? tmdbEpisode.runtime * 60 * 1000 : undefined, // Convert minutes to milliseconds
      index: tmdbEpisode.episode_number,
      parentIndex: tmdbEpisode.season_number,
      parentRatingKey,
      parentKey: constructMetadataKey(parentRatingKey),
      parentGuid: seasonGuid,
      parentType: 'season',
      parentTitle: seasonTitle,
      parentThumb: seasonThumb,
      grandparentRatingKey,
      grandparentKey: constructMetadataKey(grandparentRatingKey),
      grandparentGuid: showGuid,
      grandparentType: 'show',
      grandparentTitle: showTitle,
      grandparentThumb: showThumb,
    };

    // Add snapshot image
    if (tmdbEpisode.still_path) {
      metadata.Image = [{
        type: 'snapshot',
        url: this.getImageURL(tmdbEpisode.still_path)!,
        alt: tmdbEpisode.name,
      }];
    }

    // Add ratings
    if (tmdbEpisode.vote_average && tmdbEpisode.vote_count > 0) {
      metadata.Rating = [{
        image: 'themoviedb://image.rating',
        type: 'audience',
        value: tmdbEpisode.vote_average,
      }];
    }

    // Add external IDs
    if (tmdbEpisode.external_ids) {
      const guids: Guid[] = [];
      if (tmdbEpisode.external_ids.imdb_id) {
        guids.push({ id: createExternalGuid('imdb', tmdbEpisode.external_ids.imdb_id) });
      }
      if (tmdbEpisode.external_ids.tvdb_id) {
        guids.push({ id: createExternalGuid('tvdb', tmdbEpisode.external_ids.tvdb_id) });
      }
      if (guids.length > 0) {
        metadata.Guid = guids;
      }
    }

    // Add cast - combine credits.cast (if available) with guest_stars
    const castMembers: TMDBCastMember[] = [];
    if (tmdbEpisode.credits?.cast) {
      castMembers.push(...tmdbEpisode.credits.cast);
    }
    if (tmdbEpisode.guest_stars) {
      castMembers.push(...tmdbEpisode.guest_stars);
    }
    if (castMembers.length > 0) {
      metadata.Role = this.mapCast(castMembers);
    }

    metadata.Director = crew.Director;
    metadata.Producer = crew.Producer;
    metadata.Writer = crew.Writer;

    return metadata;
  }
}
