export interface CompletionNotificationState {
  user: Array<{ message: string; level: "info" | "error" }>;
  agent: string[];
}

interface CompletionNotificationDriver {
  notifyUser(message: string, level: "info" | "error"): void;
  notifyAgent(message: string): void | Promise<void>;
}

/** INFRASTRUCTURE_WRAPPER: delivers worker completion messages to Pi's user and agent channels. */
export class CompletionNotifications {
  private readonly trackedState: CompletionNotificationState = { user: [], agent: [] };

  constructor(private readonly driver: CompletionNotificationDriver) {}

  static create(
    notifyUser: CompletionNotificationDriver["notifyUser"],
    notifyAgent: CompletionNotificationDriver["notifyAgent"],
  ): CompletionNotifications {
    return new CompletionNotifications({ notifyUser, notifyAgent });
  }

  static createNull(): CompletionNotifications {
    return new CompletionNotifications({
      notifyUser: () => {},
      notifyAgent: () => {},
    });
  }

  get state(): CompletionNotificationState {
    return structuredClone(this.trackedState);
  }

  notifyUser(message: string, level: "info" | "error"): void {
    this.trackedState.user.push({ message, level });
    this.driver.notifyUser(message, level);
  }

  async notifyAgent(message: string): Promise<void> {
    this.trackedState.agent.push(message);
    await this.driver.notifyAgent(message);
  }
}
