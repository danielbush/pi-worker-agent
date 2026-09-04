import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkerAgentExtension } from "./extension/worker-agent-extension.ts";
import { PiExtension } from "./infrastructure/pi/pi-extension.ts";

export default function workerAgentExtension(pi: ExtensionAPI) {
  WorkerAgentExtension.create(PiExtension.create(pi)).register();
}
