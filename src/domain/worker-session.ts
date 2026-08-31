/** Basic metadata and harness/storage pointers for `workerSessions`. */
export interface WorkerSession {
  id: string;
  jobId: string;
  harnessSessionId: string | null;
  harnessSessionPath: string | null;
  storagePath: string;
  createdAt: string;
}
