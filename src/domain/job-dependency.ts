/** One directed dependency edge in `jobDependencies`. */
export interface JobDependency {
  jobId: string;
  dependsOnJobId: string;
  relationship: string;
}
