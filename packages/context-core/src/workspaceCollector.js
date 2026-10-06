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
exports.WorkspaceCollector = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
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
]);
class WorkspaceCollector {
    options;
    constructor(options) {
        this.options = options;
    }
    collect() {
        const files = [];
        const stack = [this.options.rootPath];
        while (stack.length > 0 && files.length < (this.options.maxFiles ?? 200)) {
            const current = stack.pop();
            if (!current)
                continue;
            let entries = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    if (DEFAULT_IGNORE.has(entry.name))
                        continue;
                    stack.push(fullPath);
                    continue;
                }
                if (!entry.isFile())
                    continue;
                if (!this.shouldInclude(fullPath))
                    continue;
                try {
                    const stat = fs.statSync(fullPath);
                    files.push({
                        path: fullPath,
                        size: stat.size,
                        modifiedAt: stat.mtime.toISOString(),
                    });
                }
                catch {
                    continue;
                }
                if (files.length >= (this.options.maxFiles ?? 200))
                    break;
            }
        }
        return files;
    }
    shouldInclude(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const allowed = new Set([
            ".md",
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
            ".json",
            ".yml",
            ".yaml",
            ".txt",
            ".py",
            ".java",
            ".cs",
            ".go",
            ".rs",
            ".sh",
        ]);
        if (this.options.includeMarkdown === false && ext === ".md")
            return false;
        return allowed.has(ext) || filePath.endsWith("README") || filePath.endsWith("package.json");
    }
}
exports.WorkspaceCollector = WorkspaceCollector;
//# sourceMappingURL=workspaceCollector.js.map