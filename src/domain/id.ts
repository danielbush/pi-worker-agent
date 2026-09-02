/** Creates application-owned construct IDs before database or file creation. */
export class Id {
  private constructor() {}

  static create(): Id {
    return new Id();
  }

  createProjectId(): string {
    return crypto.randomUUID();
  }

  createWorkspaceId(): string {
    return crypto.randomUUID();
  }

  createTaskId(): string {
    return crypto.randomUUID();
  }

  createJobId(): string {
    return `job_${crypto.randomUUID()}`;
  }

  createWorkerSessionId(): string {
    return `session_${crypto.randomUUID()}`;
  }
}

export function resolveIdReference<T extends { id: string }>(
  reference: string,
  records: T[],
  construct: string,
): T | undefined {
  const exact = records.find((record) => record.id === reference);
  if (exact) return exact;
  if (reference.length < 4) throw new Error(`${construct} ID shorthand must contain at least 4 characters`);
  const matches = records.filter((record) => record.id.startsWith(reference));
  if (matches.length > 1) throw new Error(`Ambiguous ${construct} ID shorthand: ${reference}`);
  return matches[0];
}
