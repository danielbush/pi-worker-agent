import type { JobDependency } from "../domain/job-dependency.ts";
import type { RegistryDatabase } from "./registry-database.ts";

/** Persists directed edges in the architecture's `jobDependencies` table. */
export class JobDependencyRepository {
  constructor(private readonly database: RegistryDatabase) {}

  create(dependency: JobDependency): void {
    this.database.db.query(`
      INSERT INTO jobDependencies (jobId, dependsOnJobId, relationship)
      VALUES (?, ?, ?)
    `).run(dependency.jobId, dependency.dependsOnJobId, dependency.relationship);
  }

  listForJob(jobId: string): JobDependency[] {
    return this.database.db.query(`
      SELECT * FROM jobDependencies WHERE jobId = ? ORDER BY dependsOnJobId
    `).all(jobId) as JobDependency[];
  }

  listDependents(dependsOnJobId: string): JobDependency[] {
    return this.database.db.query(`
      SELECT * FROM jobDependencies WHERE dependsOnJobId = ? ORDER BY jobId
    `).all(dependsOnJobId) as JobDependency[];
  }
}
