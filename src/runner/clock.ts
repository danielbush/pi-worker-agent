/** INFRASTRUCTURE_WRAPPER: supplies production or deterministic timestamps. */
export class Clock {
  private constructor(private readonly timestamp: string | undefined) {}

  static create(): Clock {
    return new Clock(undefined);
  }

  static createNull(timestamp = "2026-08-30T12:00:00Z"): Clock {
    return new Clock(timestamp);
  }

  now(): string {
    return this.timestamp ?? new Date().toISOString();
  }
}
