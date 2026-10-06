"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextBuilder = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
class ContextBuilder {
    options;
    constructor(options) {
        this.options = options;
    }
    build() {
        const files = this.options.files ?? [];
        const directories = this.collectDirectories(files);
        const importantFiles = files.slice(0, 15).map((file) => this.toRelativePath(file.path));
        const documents = files
            .slice(0, this.options.settings?.maxFiles ?? 20)
            .map((file) => ({
            path: this.toRelativePath(file.path),
            summary: this.createSummary(file.path),
            content: this.readSnippet(file.path),
        }))
            .filter((doc) => doc.path.length > 0);
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
            },
            documents,
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
    collectDirectories(files) {
        const dirs = new Set();
        for (const file of files) {
            const dir = path.dirname(file.path);
            if (dir && dir !== this.options.workspaceRoot) {
                dirs.add(this.toRelativePath(dir));
            }
        }
        return Array.from(dirs).slice(0, 20);
    }
    createSummary(filePath) {
        const name = path.basename(filePath);
        return `File: ${name}`;
    }
    readSnippet(filePath) {
        try {
            const text = fs.readFileSync(filePath, "utf8");
            const maxChars = this.options.settings?.maxDocumentChars ?? 500;
            return text.slice(0, maxChars);
        }
        catch {
            return undefined;
        }
    }
    toRelativePath(targetPath) {
        return path.relative(this.options.workspaceRoot, targetPath).replace(/\\/g, "/");
    }
}
exports.ContextBuilder = ContextBuilder;
//# sourceMappingURL=contextBuilder.js.map