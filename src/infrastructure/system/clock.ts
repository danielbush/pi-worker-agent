interface DateValue {
  toISOString(): string;
}

type DateDriver = new () => DateValue;

/** INFRASTRUCTURE_WRAPPER: supplies production or deterministic timestamps. */
export class Clock {
  constructor(private readonly DateDriver: DateDriver) {}

  static create(): Clock {
    return new Clock(Date);
  }

  static createNull(timestamp = "2026-08-30T12:00:00Z"): Clock {
    return new Clock(class EmbeddedDateStub {
      toISOString(): string { return timestamp; }
    });
  }

  now(): string {
    return new this.DateDriver().toISOString();
  }
}
