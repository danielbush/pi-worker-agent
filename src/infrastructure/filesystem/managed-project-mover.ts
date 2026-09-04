import { lstatSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { projectCollectionDirectory, type ProjectCollection } from "../../domain/project-collection.ts";

interface ManagedProjectMoverDriver {
  move(dataRoot: string, directoryName: string, from: ProjectCollection, to: ProjectCollection): void;
}

/** INFRASTRUCTURE_WRAPPER: moves one non-symlink project directory between trusted collection roots. */
export class ManagedProjectMover {
  constructor(private readonly dataRoot: string, private readonly driver: ManagedProjectMoverDriver) {}

  static create(dataRoot: string): ManagedProjectMover {
    return new ManagedProjectMover(dataRoot, { move: productionMove });
  }

  static createNull(moves: Array<{ directoryName: string; from: ProjectCollection; to: ProjectCollection }> = []): ManagedProjectMover {
    return new ManagedProjectMover("/null-worker-agent", {
      move: (_root, directoryName, from, to) => { moves.push({ directoryName, from, to }); },
    });
  }

  move(directoryName: string, from: ProjectCollection, to: ProjectCollection): void {
    this.driver.move(this.dataRoot, directoryName, from, to);
  }
}

function productionMove(dataRoot: string, directoryName: string, from: ProjectCollection, to: ProjectCollection): void {
  const source = join(dataRoot, projectCollectionDirectory(from), directoryName);
  const destinationRoot = join(dataRoot, projectCollectionDirectory(to));
  const destination = join(destinationRoot, directoryName);
  let sourceStat;
  try { sourceStat = lstatSync(source); } catch { throw new Error(`Project source does not exist: ${source}`); }
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`Project source is not a regular directory: ${source}`);
  try { lstatSync(destination); throw new Error(`Project destination already exists: ${destination}`); } catch (error) {
    if (error instanceof Error && error.message.startsWith("Project destination")) throw error;
  }
  mkdirSync(destinationRoot, { recursive: true });
  renameSync(source, destination);
}
