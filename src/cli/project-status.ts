import { DATA_ROOT } from "../config.ts";
import { message, openConfiguredProjectRegistry } from "./project-configuration.ts";

interface TaskStatusRow {
  id: string;
  title: string;
  status: string;
  jobs: number;
  activeJobs: number;
}

try {
  const project = process.argv[2];
  if (!project || process.argv.length !== 3) throw new Error("usage: bun run project-status -- <project-name>");
  const configured = await openConfiguredProjectRegistry(DATA_ROOT);
  const { database, projects } = configured;
  try {
    if (!projects.includes(project)) throw new Error(`unknown project: ${project}`);
    const tasks = database.query<TaskStatusRow, [string]>(`
      SELECT t.id, t.title, t.status,
             COUNT(j.id) AS jobs,
             COALESCE(SUM(CASE WHEN j.status IN ('queued', 'running', 'blocked') THEN 1 ELSE 0 END), 0) AS activeJobs
      FROM projects p
      JOIN projects_tasks pt ON pt.projectId = p.id
      JOIN tasks t ON t.id = pt.taskId
      LEFT JOIN jobs j ON j.taskId = t.id
      WHERE p.directoryName = ?
      GROUP BY t.id, t.title, t.status, t.createdAt
      ORDER BY t.createdAt DESC
    `).all(project);

    console.log(`Project: ${project}`);
    if (!tasks.length) {
      console.log("Tasks: none");
    } else {
      console.log("Task ID | Status | Jobs | Active | Title");
      for (const task of tasks) {
        console.log(`${task.id} | ${task.status} | ${task.jobs} | ${task.activeJobs} | ${task.title}`);
      }
    }
  } finally {
    database.close();
  }
} catch (error) {
  console.error(`project-status: ${message(error)}`);
  process.exit(1);
}
