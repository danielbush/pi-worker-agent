/** A task-local replacement for one job type's default agent profile. */
export interface TaskAgentProfileOverride {
  taskId: string;
  jobTypeId: string;
  agentProfileId: string;
}
