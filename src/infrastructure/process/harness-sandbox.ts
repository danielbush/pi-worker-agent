import type { HarnessName } from "../../domain/execution-profile.ts";
import { NullSandbox } from "./harness-sandboxes/null-sandbox.ts";
import { WorkerSandbox, type WorkerSandboxPolicy, type WorkerSandboxState } from "./worker-sandbox.ts";

export interface HarnessSandbox {
  readonly state: WorkerSandboxState;
  preflight(): void;
  wrap(command: string[], policy: WorkerSandboxPolicy): Promise<string[]>;
  reset(): Promise<void>;
}

interface HarnessSandboxRegistration {
  harness: HarnessName;
  sandbox: HarnessSandbox;
}

/** Selects the process-isolation strategy owned by a harness profile. */
export class HarnessSandboxCatalog {
  private readonly sandboxes: ReadonlyMap<HarnessName, HarnessSandbox>;

  constructor(registrations: readonly HarnessSandboxRegistration[]) {
    this.sandboxes = new Map(registrations.map(({ harness, sandbox }) => [harness, sandbox]));
  }

  static create(): HarnessSandboxCatalog {
    return new HarnessSandboxCatalog([
      { harness: "pi", sandbox: WorkerSandbox.create() },
      { harness: "cursor-agent", sandbox: NullSandbox.create() },
    ]);
  }

  static createNull(): HarnessSandboxCatalog {
    return new HarnessSandboxCatalog([
      { harness: "pi", sandbox: WorkerSandbox.createNull() },
      { harness: "cursor-agent", sandbox: NullSandbox.createNull() },
    ]);
  }

  sandbox(harness: HarnessName): HarnessSandbox {
    const sandbox = this.sandboxes.get(harness);
    if (!sandbox) throw new Error(`No process-isolation strategy is registered for harness: ${harness}`);
    return sandbox;
  }

  get state(): Partial<Record<HarnessName, WorkerSandboxState>> {
    return Object.fromEntries([...this.sandboxes].map(([harness, sandbox]) => [harness, sandbox.state]));
  }
}
