export interface IntervalTimerState {
  intervals: number[];
  cleared: number[];
}

interface IntervalTimerDriver {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(timer: unknown): void;
}

/** INFRASTRUCTURE_WRAPPER: owns recurring system timer operations. */
export class IntervalTimer {
  private readonly trackedState: IntervalTimerState = { intervals: [], cleared: [] };

  constructor(private readonly driver: IntervalTimerDriver) {}

  static create(): IntervalTimer {
    return new IntervalTimer({ setInterval, clearInterval });
  }

  static createNull(): IntervalTimer {
    let nextTimer = 1;
    return new IntervalTimer({
      setInterval: () => nextTimer++,
      clearInterval: () => {},
    });
  }

  get state(): IntervalTimerState {
    return structuredClone(this.trackedState);
  }

  start(callback: () => void, milliseconds: number): unknown {
    this.trackedState.intervals.push(milliseconds);
    return this.driver.setInterval(callback, milliseconds);
  }

  stop(timer: unknown): void {
    if (typeof timer === "number") this.trackedState.cleared.push(timer);
    this.driver.clearInterval(timer);
  }
}
