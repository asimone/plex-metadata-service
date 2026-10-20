/**
 * OMDb (IMDb) plots by imdb:// ID, with a daily request budget.
 * Docs: https://www.omdbapi.com/
 */

import { CircuitBreaker } from '../../resilience/circuitBreaker';
import { HttpSource, describeError } from '../../resilience/http';
import { Store } from '../../store/Store';
import { cleanSummary } from '../../text/cleanSummary';
import { DAY_MS, LookupItem, SourceLookup, SummarySource, externalId } from '../SummarySource';

interface OmdbResponse {
  Response: 'True' | 'False';
  Plot?: string;
  Error?: string;
}

export interface OmdbOptions {
  apiKey: string;
  dailyCap: number;
  store: Store;
  http?: HttpSource;
  ttlMs?: number;
  notFoundTtlMs?: number;
}

export class OmdbSource implements SummarySource {
  readonly name = 'omdb' as const;
  private http: HttpSource;

  constructor(private readonly options: OmdbOptions) {
    this.http =
      options.http ??
      new HttpSource({
        baseURL: 'https://www.omdbapi.com',
        params: { apikey: options.apiKey },
        breaker: new CircuitBreaker('omdb'),
      });
  }

  get breaker(): CircuitBreaker {
    return this.http.breaker;
  }

  budgetUsed(): number {
    return this.options.store.budgetUsed('omdb');
  }

  async getSummary(item: LookupItem): Promise<SourceLookup> {
    const imdbId = externalId(item, 'imdb');
    if (!imdbId) {
      return { status: 'no-id' };
    }
    const id = `imdb://${imdbId}`;
    const key = `omdb:${imdbId}`;
    const { store } = this.options;

    let plot: string | null;
    const hit = store.cacheGet<string | null>(key);
    if (hit) {
      plot = hit.value;
    } else {
      if (store.budgetUsed('omdb') >= this.options.dailyCap) {
        return { status: 'unavailable', reason: `omdb: daily cap of ${this.options.dailyCap} reached` };
      }
      try {
        store.budgetSpend('omdb');
        const data = await this.http.getJson<OmdbResponse>('/', { i: imdbId, plot: 'full' });
        plot = data.Response === 'True' ? (data.Plot ?? '') : null;
      } catch (error) {
        return { status: 'unavailable', reason: `omdb: ${describeError(error)}` };
      }
      const ttl = plot === null ? (this.options.notFoundTtlMs ?? 7 * DAY_MS) : (this.options.ttlMs ?? 30 * DAY_MS);
      store.cacheSet(key, plot, ttl);
    }

    const summary = cleanSummary(plot);
    return summary ? { status: 'found', summary, externalId: id } : { status: 'not-found', externalId: id };
  }
}
