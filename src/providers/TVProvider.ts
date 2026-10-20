/**
 * TheMovieDB TV Show Provider
 * Supports TV Shows, Seasons, and Episodes
 */

import {
  MediaProvider,
  MediaProviderResponse,
  MetadataType,
  FeatureType,
} from '../models/MediaProvider';
import { API_PATHS } from '../constants';

/**
 * TV Provider configuration
 */
export const TV_PROVIDER_IDENTIFIER = 'tv.plex.agents.custom.example.themoviedb.tv';
export const TV_PROVIDER_TITLE = 'TheMovieDB Example TV Provider';
export const TV_PROVIDER_VERSION = '1.0.0';
export const TV_PROVIDER_BASE_PATH = '/tv';

/**
 * Creates the TV MediaProvider definition
 */
export function createTVProvider(): MediaProvider {
  return {
    identifier: TV_PROVIDER_IDENTIFIER,
    title: TV_PROVIDER_TITLE,
    version: TV_PROVIDER_VERSION,
    Types: [
      {
        type: MetadataType.SHOW,
        Scheme: [
          {
            scheme: TV_PROVIDER_IDENTIFIER,
          },
        ],
      },
      {
        type: MetadataType.SEASON,
        Scheme: [
          {
            scheme: TV_PROVIDER_IDENTIFIER,
          },
        ],
      },
      {
        type: MetadataType.EPISODE,
        Scheme: [
          {
            scheme: TV_PROVIDER_IDENTIFIER,
          },
        ],
      },
    ],
    Feature: [
      {
        type: FeatureType.METADATA,
        key: `${API_PATHS.LIBRARY_METADATA}`,
      },
      {
        type: FeatureType.MATCH,
        key: `${API_PATHS.LIBRARY_MATCHES}`,
      },
    ],
  };
}

/**
 * Gets the full MediaProvider response
 */
export function getTVProviderResponse(): MediaProviderResponse {
  return {
    MediaProvider: createTVProvider(),
  };
}
