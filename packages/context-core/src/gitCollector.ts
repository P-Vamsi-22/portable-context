import * as childProcess from "node:child_process";
import { promisify } from "node:util";
import type { GitState } from "./types";

const execFile = promisify(childProcess.execFile);

export class GitCollector {
  constructor(private readonly workspaceRoot: string) {}

  public async collect(): Promise<GitState> {
    const [branch, status, recentCommitsOutput] = await Promise.all([
      this.run(["rev-parse", "--abbrev-ref", "HEAD"]),
      this.run(["status", "--short"]),
      this.run(["log", "-n", "5", "--oneline"]),
    ]);
    const recentCommits = recentCommitsOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      branch: branch || null,
      status: status || "clean",
      recentCommits,
    };
  }

  private async run(args: string[]): Promise<string> {
    try {
      const result = await execFile("git", args, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      });
      return result.stdout.trim();
    } catch {
      return "";
    }
  }
}
