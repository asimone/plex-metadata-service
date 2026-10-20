/**
 * TypeScript types for TheMovieDB.org API responses
 * Documentation: https://developer.themoviedb.org/docs
 */

/**
 * Common TMDB response fields
 */
export interface TMDBImage {
  file_path: string;
  aspect_ratio: number;
  height: number;
  width: number;
  vote_average?: number;
  vote_count?: number;
}

export interface TMDBGenre {
  id: number;
  name: string;
}

export interface TMDBProductionCompany {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface TMDBProductionCountry {
  iso_3166_1: string;
  name: string;
}

export interface TMDBSpokenLanguage {
  iso_639_1: string;
  name: string;
  english_name: string;
}

/**
 * Cast and Crew
 */
export interface TMDBCastMember {
  id: number;
  name: string;
  original_name: string;
  character: string;
  credit_id: string;
  order: number;
  profile_path: string | null;
}

export interface TMDBCrewMember {
  id: number;
  name: string;
  original_name: string;
  job: string;
  department: string;
  credit_id: string;
  profile_path: string | null;
}

export interface TMDBCredits {
  cast: TMDBCastMember[];
  crew: TMDBCrewMember[];
}

/**
 * Aggregate Credits (from /tv/{id}/aggregate_credits endpoint)
 * Used for TV shows to get all cast/crew across all episodes
 */
export interface TMDBAggregateCastRole {
  credit_id: string;
  character: string;
  episode_count: number;
}

export interface TMDBAggregateCastMember {
  id: number;
  name: string;
  original_name: string;
  roles: TMDBAggregateCastRole[];
  total_episode_count: number;
  order: number;
  profile_path: string | null;
}

export interface TMDBAggregateCrewJob {
  credit_id: string;
  job: string;
  episode_count: number;
}

export interface TMDBAggregateCrewMember {
  id: number;
  name: string;
  original_name: string;
  jobs: TMDBAggregateCrewJob[];
  department: string;
  total_episode_count: number;
  profile_path: string | null;
}

export interface TMDBAggregateCredits {
  cast: TMDBAggregateCastMember[];
  crew: TMDBAggregateCrewMember[];
}

/**
 * External IDs
 */
export interface TMDBExternalIds {
  imdb_id: string | null;
  tvdb_id: number | null;
  freebase_id: string | null;
  freebase_mid: string | null;
  tvrage_id: number | null;
}

/**
 * Images response
 */
export interface TMDBImages {
  backdrops: TMDBImage[];
  logos: TMDBImage[];
  posters: TMDBImage[];
}

/**
 * Content Ratings
 */
export interface TMDBContentRating {
  iso_3166_1: string;
  rating: string;
}

export interface TMDBContentRatings {
  results: TMDBContentRating[];
}

/**
 * TV Show specific types
 */
export interface TMDBNetwork {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface TMDBCreatedBy {
  id: number;
  name: string;
  profile_path: string | null;
}

export interface TMDBEpisodeToAir {
  id: number;
  name: string;
  overview: string;
  air_date: string;
  episode_number: number;
  season_number: number;
  still_path: string | null;
}

/**
 * TV Show response
 */
export interface TMDBTVShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  tagline?: string;
  first_air_date: string;
  last_air_date: string;
  status: string;
  type: string;
  adult: boolean;
  backdrop_path: string | null;
  poster_path: string | null;
  homepage: string;
  in_production: boolean;
  languages: string[];
  origin_country: string[];
  original_language: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  number_of_episodes: number;
  number_of_seasons: number;
  episode_run_time: number[];
  genres: TMDBGenre[];
  networks: TMDBNetwork[];
  production_companies: TMDBProductionCompany[];
  production_countries: TMDBProductionCountry[];
  spoken_languages: TMDBSpokenLanguage[];
  created_by: TMDBCreatedBy[];
  last_episode_to_air: TMDBEpisodeToAir | null;
  next_episode_to_air: TMDBEpisodeToAir | null;
  seasons: TMDBSeason[];
  // Append to response fields
  external_ids?: TMDBExternalIds;
  credits?: TMDBCredits | TMDBAggregateCredits;
  aggregate_credits?: TMDBAggregateCredits;
  images?: TMDBImages;
  content_ratings?: TMDBContentRatings;
  episode_groups?: TMDBEpisodeGroupsResponse;
}

/**
 * Season response
 */
export interface TMDBSeason {
  id: number;
  name: string;
  overview: string;
  air_date: string | null;
  episode_count: number;
  poster_path: string | null;
  season_number: number;
  // Additional fields when fetching season details
  episodes?: TMDBEpisode[];
  external_ids?: TMDBExternalIds;
  images?: TMDBImages;
  credits?: TMDBCredits;
}

/**
 * Episode response
 */
export interface TMDBEpisode {
  id: number;
  name: string;
  overview: string;
  air_date: string | null;
  episode_number: number;
  season_number: number;
  still_path: string | null;
  runtime: number | null;
  vote_average: number;
  vote_count: number;
  crew: TMDBCrewMember[];
  guest_stars: TMDBCastMember[];
  // Additional fields when fetching episode details
  credits?: TMDBCredits;
  external_ids?: TMDBExternalIds;
  images?: {
    stills: TMDBImage[];
  };
}

/**
 * Search results
 */
export interface TMDBSearchResult {
  page: number;
  total_pages: number;
  total_results: number;
  results: TMDBTVShow[];
}

/**
 * Find by external ID results
 * The /find endpoint returns results in different arrays based on media type
 */
export interface TMDBFindResult {
  movie_results: any[];
  person_results: any[];
  tv_results: TMDBTVShow[];
  tv_episode_results: any[];
  tv_season_results: any[];
}

/**
 * TMDB API Configuration
 */
export interface TMDBConfiguration {
  images: {
    base_url: string;
    secure_base_url: string;
    backdrop_sizes: string[];
    logo_sizes: string[];
    poster_sizes: string[];
    profile_sizes: string[];
    still_sizes: string[];
  };
}

/**
 * Episode Groups
 */
export interface TMDBEpisodeGroup {
  id: string;
  name: string;
  description: string;
  episode_count: number;
  group_count: number;
  type: number;
  network?: TMDBNetwork;
}

export interface TMDBEpisodeGroupsResponse {
  results: TMDBEpisodeGroup[];
}

/**
 * Episode Group Details (from /tv/episode_group/{id} endpoint)
 */
export interface TMDBEpisodeGroupEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  order: number;
}

export interface TMDBEpisodeGroupGroup {
  id: string;
  name: string;
  order: number;
  episodes: TMDBEpisodeGroupEpisode[];
  locked: boolean;
}

export interface TMDBEpisodeGroupDetails {
  id: string;
  name: string;
  description: string;
  episode_count: number;
  group_count: number;
  type: number;
  network?: TMDBNetwork;
  groups: TMDBEpisodeGroupGroup[];
}
