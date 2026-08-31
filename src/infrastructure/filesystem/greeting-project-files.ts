import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface GreetingProjectFileInput {
  examplesRoot: string;
  name: string;
  packageJson: string;
  source: string;
  test: string;
}

/** INFRASTRUCTURE_WRAPPER: creates the demo greeting project's directory and files. */
export class GreetingProjectFiles {
  private constructor(private readonly nullable: boolean) {}

  static create(): GreetingProjectFiles {
    return new GreetingProjectFiles(false);
  }

  static createNull(): GreetingProjectFiles {
    return new GreetingProjectFiles(true);
  }

  async create(input: GreetingProjectFileInput): Promise<string> {
    const rootDir = join(input.examplesRoot, input.name);
    if (this.nullable) return rootDir;

    await mkdir(input.examplesRoot, { recursive: true });
    await mkdir(rootDir, { recursive: false });
    await mkdir(join(rootDir, "src"));
    await Promise.all([
      Bun.write(join(rootDir, "package.json"), input.packageJson),
      Bun.write(join(rootDir, "src", "index.ts"), input.source),
      Bun.write(join(rootDir, "src", "index.test.ts"), input.test),
    ]);
    return rootDir;
  }
}
