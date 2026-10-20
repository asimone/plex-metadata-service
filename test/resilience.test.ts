import nock from 'nock';
import { CircuitBreaker, CircuitOpenError } from '../src/resilience/circuitBreaker';
import { HttpSource, NotFoundError } from '../src/resilience/http';

const BASE = 'http://upstream.test';

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());
afterAll(() => nock.enableNetConnect());

describe('CircuitBreaker', () => {
  it('opens after the threshold, half-opens after the cooldown, and closes on success', async () => {
    let now = 0;
    const breaker = new CircuitBreaker('x', 2, 1000, () => now);
    const fail = () => breaker.run(() => Promise.reject(new Error('boom')));

    await expect(fail()).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('closed');
    await expect(fail()).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('open');
    await expect(breaker.run(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);

    now = 1000;
    expect(breaker.getState()).toBe('half-open');
    await expect(breaker.run(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('reopens immediately when the half-open trial fails', async () => {
    let now = 0;
    const breaker = new CircuitBreaker('x', 1, 1000, () => now);
    await expect(breaker.run(() => Promise.reject(new Error('a')))).rejects.toThrow();
    now = 1000;
    await expect(breaker.run(() => Promise.reject(new Error('b')))).rejects.toThrow();
    expect(breaker.getState()).toBe('open');
  });
});

describe('HttpSource', () => {
  const sleeps: number[] = [];
  const source = (breaker = new CircuitBreaker('t')) =>
    new HttpSource({
      baseURL: BASE,
      params: { key: 'k' },
      breaker,
      backoffMs: 10,
      sleep: async ms => {
        sleeps.push(ms);
      },
    });

  beforeEach(() => (sleeps.length = 0));

  it('retries 5xx and returns the eventual success', async () => {
    nock(BASE).get('/a').query({ key: 'k' }).reply(503).get('/a').query({ key: 'k' }).reply(200, { ok: true });
    await expect(source().getJson('/a')).resolves.toEqual({ ok: true });
    expect(sleeps).toHaveLength(1);
  });

  it('honors Retry-After on 429', async () => {
    nock(BASE).get('/a').query(true).reply(429, {}, { 'Retry-After': '2' }).get('/a').query(true).reply(200, {});
    await source().getJson('/a');
    expect(sleeps).toEqual([2000]);
  });

  it('gives up after maxRetries', async () => {
    nock(BASE).get('/a').query(true).times(4).reply(500);
    await expect(source().getJson('/a')).rejects.toThrow();
    expect(sleeps).toHaveLength(3);
  });

  it('does not retry other 4xx', async () => {
    nock(BASE).get('/a').query(true).reply(401);
    await expect(source().getJson('/a')).rejects.toThrow();
    expect(sleeps).toHaveLength(0);
  });

  it('turns 404 into NotFoundError without tripping the breaker', async () => {
    const breaker = new CircuitBreaker('t', 1);
    nock(BASE).get('/missing').query(true).reply(404);
    await expect(source(breaker).getJson('/missing')).rejects.toBeInstanceOf(NotFoundError);
    expect(breaker.getState()).toBe('closed');
  });
});
