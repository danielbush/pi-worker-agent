/** One normalized record in a worker session's canonical `events.jsonl`. */
export interface WorkerEvent {
  timestamp: string;
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  arguments?: unknown;
  result?: unknown;
  isError?: boolean;
  pid?: number;
  exitCode?: number;
  error?: string;
  artifactPath?: string;
}
