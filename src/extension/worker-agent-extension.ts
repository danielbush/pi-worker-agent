import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getDataRoot } from "../storage/paths.ts";
import { Registry } from "../storage/registry.ts";

/** Owns Pi registration and the lifecycle of the real worker-agent services. */
export class WorkerAgentExtension {
  private readonly root = getDataRoot();
  private registry: Registry | undefined;

  constructor(private readonly pi: ExtensionAPI) {}

  register(): void {
    this.pi.on("session_start", async () => {
      this.registry ??= new Registry(this.root);
    });

    this.pi.on("session_shutdown", async () => {
      this.registry?.close();
      this.registry = undefined;
    });

    this.pi.registerCommand("worker-demo", {
      description: "Run the hardcoded Pi/Pi worker demonstration",
      handler: async (_args, ctx) => {
        ctx.ui.notify("The Pi/Pi worker demo is under construction.", "info");
      },
    });
  }
}
