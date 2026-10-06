import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ContextPack, ContextSettings, GitState, WorkspaceFile } from "./types";

export type ContextBuilderOptions = {
  projectId: string;
  workspaceRoot: string;
  gitState?: GitState;
  files?: WorkspaceFile[];
  settings?: ContextSettings;
  activeFile?: string;
  openFiles?: string[];
  diagnostics?: string[];
};

export class ContextBuilder {
  constructor(private readonly options: ContextBuilderOptions) {}

  public async build(): Promise<ContextPack> {
    const files = this.options.files ?? [];
    const directories = this.collectDirectories(files);
    const importantFiles = files
      .filter((file) => file.type !== "other")
      .slice(0, 30)
      .map((file) => this.toRelativePath(file.path));
    const documents = files
      .filter((file) => file.type === "documentation" || file.type === "configuration")
      .slice(0, this.options.settings?.maxFiles ?? 100)
      .map(async (file) => ({
        path: this.toRelativePath(file.path),
        type: file.type,
        size: file.size,
        summary: this.createSummary(file.path),
        content: await this.readContent(file.path),
      }));
    const resolvedDocuments = (await Promise.all(documents)).filter((doc) => doc.path.length > 0);

    return {
      projectId: this.options.projectId,
      workspaceRoot: this.options.workspaceRoot,
      generatedAt: new Date().toISOString(),
      repository: {
        branch: this.options.gitState?.branch ?? null,
        status: this.options.gitState?.status ?? "unknown",
        recentCommits: this.options.gitState?.recentCommits ?? [],
      },
      structure: {
        importantFiles,
        directories,
        totalFiles: files.length,
        filesByType: this.countByType(files),
        documentationFiles: files.filter((file) => file.type === "documentation").length,
        sourceFiles: files.filter((file) => file.type === "source").length,
      },
      documents: resolvedDocuments,
      activeContext: {
        activeFile: this.options.activeFile,
        openFiles: this.options.openFiles ?? [],
        diagnostics: this.options.diagnostics ?? [],
      },
      session: {
        goal: undefined,
        summary: "Context snapshot created from workspace and git state.",
        decisions: [],
        pendingTasks: [],
      },
    };
  }

  private collectDirectories(files: WorkspaceFile[]): string[] {
    const dirs = new Set<string>();
    for (const file of files) {
      const dir = path.dirname(file.path);
      if (dir && dir !== this.options.workspaceRoot) {
        dirs.add(this.toRelativePath(dir));
      }
    }
    return Array.from(dirs).sort();
  }

  private createSummary(filePath: string): string {
    const name = path.basename(filePath);
    return `File: ${name}`;
  }

  private async readContent(filePath: string): Promise<string | undefined> {
    try {
      const text = await fs.readFile(filePath, "utf8");
      const maxChars = this.options.settings?.maxDocumentChars ?? 12000;
      return text.slice(0, maxChars);
    } catch {
      return undefined;
    }
  }

  private countByType(files: WorkspaceFile[]): Record<string, number> {
    return files.reduce<Record<string, number>>((counts, file) => {
      counts[file.type] = (counts[file.type] ?? 0) + 1;
      return counts;
    }, {});
  }

  private toRelativePath(targetPath: string): string {
    return path.relative(this.options.workspaceRoot, targetPath).replace(/\\/g, "/");
  }
}
