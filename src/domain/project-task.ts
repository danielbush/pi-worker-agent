/** Associates a durable task with a management project independently of workspace selection. */
export interface ProjectTask {
  projectId: string;
  taskId: string;
  addedAt: string;
}
