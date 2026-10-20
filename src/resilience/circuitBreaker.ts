/**
 * Per-source circuit breaker: opens after consecutive failures, half-opens after a cooldown.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`${name} circuit is open; skipping call`);
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'closed';

  constructor(
    readonly name: string,
    private readonly threshold = 5,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  getState(): CircuitState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.getState() === 'open') {
      throw new CircuitOpenError(this.name);
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (error) {
      this.failures++;
      if (this.state === 'half-open' || this.failures >= this.threshold) {
        this.state = 'open';
        this.openedAt = this.now();
      }
      throw error;
    }
  }
}
