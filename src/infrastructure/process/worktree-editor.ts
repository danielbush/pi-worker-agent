interface EditorProcess {
  pid: number;
  unref(): void;
}

interface EditorDriver {
  editor(): string | undefined;
  which(command: string): string | null;
  spawn(command: string[], options: {
    detached: true;
    stdin: "ignore";
    stdout: "ignore";
    stderr: "ignore";
  }): EditorProcess;
}

export interface WorktreeEditorLaunch {
  editor: string;
  executable: string;
  worktreePath: string;
  pid: number;
}

/** INFRASTRUCTURE_WRAPPER: opens one derived worktree with the user's configured editor. */
export class WorktreeEditor {
  private readonly launches: WorktreeEditorLaunch[] = [];

  constructor(private readonly driver: EditorDriver) {}

  static create(): WorktreeEditor {
    return new WorktreeEditor({
      editor: () => process.env.EDITOR,
      which: (command) => Bun.which(command),
      spawn: (command, options) => Bun.spawn(command, options) as unknown as EditorProcess,
    });
  }

  static createNull(editor = "code", executable = "/null/bin/code", pid = 1234): WorktreeEditor {
    return new WorktreeEditor({
      editor: () => editor,
      which: () => executable,
      spawn: () => ({ pid, unref: () => {} }),
    });
  }

  get state(): WorktreeEditorLaunch[] {
    return structuredClone(this.launches);
  }

  open(worktreePath: string): WorktreeEditorLaunch {
    const editor = this.driver.editor()?.trim();
    if (!editor) {
      throw new Error("EDITOR is not set. Set it to an editor command available in PATH, for example: export EDITOR=code");
    }
    if (/\s/.test(editor)) {
      throw new Error(`EDITOR must name one executable without arguments; received: ${editor}`);
    }
    const executable = this.driver.which(editor);
    if (!executable) {
      throw new Error(`EDITOR executable was not found in PATH: ${editor}`);
    }
    const child = this.driver.spawn([executable, worktreePath], {
      detached: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    child.unref();
    const launch = { editor, executable, worktreePath, pid: child.pid };
    this.launches.push(launch);
    return launch;
  }
}
