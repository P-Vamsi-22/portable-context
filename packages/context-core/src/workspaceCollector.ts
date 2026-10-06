import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WorkspaceFile } from "./types";

export type WorkspaceCollectorOptions = {
  rootPath: string;
  maxFiles?: number;
  includeMarkdown?: boolean;
  markdownOnly?: boolean;
};

const DEFAULT_IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  ".venv",
  "venv",
  "out",
  ".idea",
  ".vscode",
  "target",
]);

const SECRET_FILES = new Set([".env", ".env.local", ".env.production", ".env.development"]);
const DOCUMENTATION_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const CONFIGURATION_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml"]);
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".cs", ".go", ".rs", ".sh",
  ".c", ".cpp", ".h", ".hpp", ".css", ".scss", ".html",
]);
const BINARY_EXTENSIONS = new Set([
  ".7z", ".avi", ".bmp", ".class", ".dll", ".dmg", ".exe", ".gif", ".ico",
  ".jar", ".jpeg", ".jpg", ".mp3", ".mp4", ".mov", ".png", ".so", ".svg",
  ".tar", ".ttf", ".wav", ".webm", ".woff", ".woff2", ".zip",
]);

export class WorkspaceCollector {
  constructor(private readonly options: WorkspaceCollectorOptions) {}

  public async collect(): Promise<WorkspaceFile[]> {
    const files: WorkspaceFile[] = [];
    const stack = [this.options.rootPath];

    while (stack.length > 0 && files.length < (this.options.maxFiles ?? 5000)) {
      const current = stack.pop();
      if (!current) continue;

      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (DEFAULT_IGNORE.has(entry.name)) continue;
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        if (!this.shouldInclude(fullPath, entry.name)) continue;

        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > 1024 * 1024) continue;
          const extension = path.extname(entry.name).toLowerCase();
          files.push({
            path: fullPath,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            extension,
            type: this.getType(entry.name, extension),
          });
        } catch {
          continue;
        }

        if (files.length >= (this.options.maxFiles ?? 200)) break;
      }
    }

    return files;
  }

  private shouldInclude(filePath: string, fileName: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (SECRET_FILES.has(fileName) || fileName.endsWith(".pem") || fileName.endsWith(".key")) return false;
    if (this.options.markdownOnly) {
      return DOCUMENTATION_EXTENSIONS.has(ext);
    }

    if (this.options.includeMarkdown === false && ext === ".md") return false;
    return DOCUMENTATION_EXTENSIONS.has(ext)
      || CONFIGURATION_EXTENSIONS.has(ext)
      || SOURCE_EXTENSIONS.has(ext)
      || /^(README|LICENSE|Dockerfile|Makefile)$/i.test(fileName)
      || !BINARY_EXTENSIONS.has(ext);
  }

  private getType(fileName: string, extension: string): WorkspaceFile["type"] {
    if (DOCUMENTATION_EXTENSIONS.has(extension) || /^(README|LICENSE)$/i.test(fileName)) return "documentation";
    if (CONFIGURATION_EXTENSIONS.has(extension) || /^(Dockerfile|Makefile)$/i.test(fileName)) return "configuration";
    if (SOURCE_EXTENSIONS.has(extension)) return "source";
    return "other";
  }
}
