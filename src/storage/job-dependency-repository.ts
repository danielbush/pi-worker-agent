import type { JobDependency } from "../domain/job-dependency.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

/** INFRASTRUCTURE_CONSUMER: persists edges in the `jobDependencies` table. */
export class JobDependencyRepository {
  private constructor(
    private readonly database: RegistryDatabase | undefined,
    private readonly records: JobDependency[] | undefined,
  ) {}

  static create(database: RegistryDatabase): JobDependencyRepository {
    return new JobDependencyRepository(database, undefined);
  }

  static createNull(dependencies: JobDependency[] = []): JobDependencyRepository {
    return new JobDependencyRepository(undefined, structuredClone(dependencies));
  }

  create(dependency: JobDependency): void {
    if (this.records) {
      this.records.push(structuredClone(dependency));
      return;
    }
    this.database!.db.query(`
      INSERT INTO jobDependencies (jobId, dependsOnJobId, relationship)
      VALUES (?, ?, ?)
    `).run(dependency.jobId, dependency.dependsOnJobId, dependency.relationship);
  }

  listForJob(jobId: string): JobDependency[] {
    if (this.records) {
      return this.records.filter((dependency) => dependency.jobId === jobId)
        .map((dependency) => structuredClone(dependency))
        .sort((a, b) => a.dependsOnJobId.localeCompare(b.dependsOnJobId));
    }
    return this.database!.db.query(`
      SELECT * FROM jobDependencies WHERE jobId = ? ORDER BY dependsOnJobId
    `).all(jobId) as JobDependency[];
  }

  listDependents(dependsOnJobId: string): JobDependency[] {
    if (this.records) {
      return this.records.filter((dependency) => dependency.dependsOnJobId === dependsOnJobId)
        .map((dependency) => structuredClone(dependency))
        .sort((a, b) => a.jobId.localeCompare(b.jobId));
    }
    return this.database!.db.query(`
      SELECT * FROM jobDependencies WHERE dependsOnJobId = ? ORDER BY jobId
    `).all(dependsOnJobId) as JobDependency[];
  }
}
