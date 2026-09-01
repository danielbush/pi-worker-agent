import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface GreetingProjectFileInput {
  examplesRoot: string;
  name: string;
  packageJson: string;
  source: string;
  test: string;
}

interface GreetingProjectFileDriver {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  write(path: string, content: string): Promise<unknown>;
}

/** INFRASTRUCTURE_WRAPPER: creates the demo greeting project's directory and files. */
export class GreetingProjectFiles {
  constructor(private readonly driver: GreetingProjectFileDriver) {}

  static create(): GreetingProjectFiles {
    return new GreetingProjectFiles({ mkdir, write: Bun.write });
  }

  static createNull(): GreetingProjectFiles {
    return new GreetingProjectFiles({
      mkdir: async () => {},
      write: async () => {},
    });
  }

  async create(input: GreetingProjectFileInput): Promise<string> {
    const rootDir = join(input.examplesRoot, input.name);
    await this.driver.mkdir(input.examplesRoot, { recursive: true });
    await this.driver.mkdir(rootDir, { recursive: false });
    await this.driver.mkdir(join(rootDir, "src"));
    await Promise.all([
      this.driver.write(join(rootDir, "package.json"), input.packageJson),
      this.driver.write(join(rootDir, "src", "index.ts"), input.source),
      this.driver.write(join(rootDir, "src", "index.test.ts"), input.test),
    ]);
    return rootDir;
  }
}
