import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkerAgentExtension } from "./extension/worker-agent-extension.ts";

export default function workerAgentExtension(pi: ExtensionAPI) {
  WorkerAgentExtension.create(pi).register();
}
