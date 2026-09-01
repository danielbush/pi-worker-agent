import type { JobDependency } from "../domain/job-dependency.ts";
import type { RegistryDatabase } from "../infrastructure/sqlite/registry-database.ts";

interface JobDependencyPersistence {
  create(dependency: JobDependency): void;
  listForJob(jobId: string): JobDependency[];
  listDependents(dependsOnJobId: string): JobDependency[];
}

/** INFRASTRUCTURE_CONSUMER: persists edges in the `jobDependencies` table. */
export class JobDependencyRepository {
  constructor(private readonly persistence: JobDependencyPersistence) {}

  static create(database: RegistryDatabase): JobDependencyRepository {
    return new JobDependencyRepository({
      create: (dependency) => database.db.query(`
        INSERT INTO jobDependencies (jobId, dependsOnJobId, relationship) VALUES (?, ?, ?)
      `).run(dependency.jobId, dependency.dependsOnJobId, dependency.relationship),
      listForJob: (jobId) => database.db.query(`
        SELECT * FROM jobDependencies WHERE jobId = ? ORDER BY dependsOnJobId
      `).all(jobId) as JobDependency[],
      listDependents: (dependsOnJobId) => database.db.query(`
        SELECT * FROM jobDependencies WHERE dependsOnJobId = ? ORDER BY jobId
      `).all(dependsOnJobId) as JobDependency[],
    });
  }

  static createNull(dependencies: JobDependency[] = []): JobDependencyRepository {
    const records = structuredClone(dependencies);
    return new JobDependencyRepository({
      create: (dependency) => { records.push(structuredClone(dependency)); },
      listForJob: (jobId) => records.filter((dependency) => dependency.jobId === jobId)
        .map((dependency) => structuredClone(dependency))
        .sort((a, b) => a.dependsOnJobId.localeCompare(b.dependsOnJobId)),
      listDependents: (dependsOnJobId) => records.filter((dependency) => dependency.dependsOnJobId === dependsOnJobId)
        .map((dependency) => structuredClone(dependency))
        .sort((a, b) => a.jobId.localeCompare(b.jobId)),
    });
  }

  create(dependency: JobDependency): void { this.persistence.create(dependency); }
  listForJob(jobId: string): JobDependency[] { return this.persistence.listForJob(jobId); }
  listDependents(dependsOnJobId: string): JobDependency[] { return this.persistence.listDependents(dependsOnJobId); }
}
