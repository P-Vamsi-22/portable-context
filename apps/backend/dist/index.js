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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const node_sqlite_1 = require("node:sqlite");
const app = (0, express_1.default)();
const port = Number(process.env.PORT || 3000);
const graphRagUrl = process.env.GRAPHRAG_URL || "http://127.0.0.1:8000";
const storageDir = path.resolve(__dirname, "../../../data");
(0, node_fs_1.mkdirSync)(storageDir, { recursive: true });
const database = new node_sqlite_1.DatabaseSync(path.join(storageDir, "portable-context.sqlite"));
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    branch TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS context_snapshots_project_id
    ON context_snapshots(project_id);
`);
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "10mb" }));
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "portable-context-backend",
        version: "0.1.0",
        routes: [
            "/projects",
            "/projects/create",
            "/projects/register",
            "/context",
            "/projects/:projectId/ingestion",
            "/projects/:projectId/query",
        ],
        graphRagUrl,
        database: path.join(storageDir, "portable-context.sqlite"),
    });
});
app.post("/projects/:projectId/ingestion", async (req, res) => {
    const project = database.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.projectId);
    if (!project) {
        return res.status(404).json({ error: "project not found" });
    }
    try {
        const response = await fetch(`${graphRagUrl}/projects/${req.params.projectId}/ingestion`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...req.body,
                project_id: req.params.projectId,
            }),
        });
        const body = await response.text();
        return res.status(response.status).type("application/json").send(body);
    }
    catch (error) {
        return res.status(502).json({
            error: "GraphRAG service unavailable",
            detail: error instanceof Error ? error.message : String(error),
        });
    }
});
app.post("/projects/:projectId/query", async (req, res) => {
    const project = database.prepare("SELECT id FROM projects WHERE id = ?").get(req.params.projectId);
    if (!project)
        return res.status(404).json({ error: "project not found" });
    try {
        const response = await fetch(`${graphRagUrl}/projects/${req.params.projectId}/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: req.body?.question }),
        });
        return res.status(response.status).type("application/json").send(await response.text());
    }
    catch (error) {
        return res.status(502).json({
            error: "GraphRAG service unavailable",
            detail: error instanceof Error ? error.message : String(error),
        });
    }
});
app.get("/ingestion/:jobId", async (req, res) => {
    try {
        const response = await fetch(`${graphRagUrl}/ingestion/${req.params.jobId}`);
        return res.status(response.status).type("application/json").send(await response.text());
    }
    catch (error) {
        return res.status(502).json({
            error: "GraphRAG service unavailable",
            detail: error instanceof Error ? error.message : String(error),
        });
    }
});
const registerProject = (req, res) => {
    const { name, repositoryPath, branch } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
    }
    if (typeof repositoryPath !== "string" || !repositoryPath.trim()) {
        return res.status(400).json({ error: "repositoryPath is required" });
    }
    const existing = database.prepare(`
    SELECT id, name, repository_path AS repositoryPath, branch,
           created_at AS createdAt, updated_at AS updatedAt
    FROM projects
    WHERE repository_path = ?
    LIMIT 1
  `).get(repositoryPath.trim());
    const now = new Date().toISOString();
    if (existing) {
        database.prepare(`
      UPDATE projects
      SET name = ?, branch = ?, updated_at = ?
      WHERE id = ?
    `).run(name.trim(), typeof branch === "string" && branch ? branch : null, now, existing.id);
        return res.json({
            ...existing,
            name: name.trim(),
            branch: typeof branch === "string" && branch ? branch : null,
            updatedAt: now,
        });
    }
    const project = {
        id: (0, node_crypto_1.randomUUID)(),
        name: name.trim(),
        repositoryPath: repositoryPath.trim(),
        branch: typeof branch === "string" && branch ? branch : null,
        createdAt: now,
        updatedAt: now,
    };
    database.prepare(`
    INSERT INTO projects (id, name, repository_path, branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(project.id, project.name, project.repositoryPath, project.branch, now, now);
    return res.status(201).json(project);
};
app.post("/projects", registerProject);
app.post("/projects/register", registerProject);
app.post("/projects/create", (req, res) => {
    const { name, repositoryPath, branch } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
    }
    if (typeof repositoryPath !== "string" || !repositoryPath.trim()) {
        return res.status(400).json({ error: "repositoryPath is required" });
    }
    const now = new Date().toISOString();
    const project = {
        id: (0, node_crypto_1.randomUUID)(),
        name: name.trim(),
        repositoryPath: repositoryPath.trim(),
        branch: typeof branch === "string" && branch ? branch : null,
        createdAt: now,
        updatedAt: now,
    };
    database.prepare(`
    INSERT INTO projects (id, name, repository_path, branch, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(project.id, project.name, project.repositoryPath, project.branch, now, now);
    return res.status(201).json(project);
});
app.get("/projects", (_req, res) => {
    const projects = database.prepare(`
    SELECT id, name, repository_path AS repositoryPath, branch,
           created_at AS createdAt, updated_at AS updatedAt
    FROM projects
    ORDER BY updated_at DESC
  `).all();
    return res.json(projects);
});
app.post("/context", (req, res) => {
    const body = req.body;
    if (!body || !body.projectId) {
        return res.status(400).json({ error: "projectId is required" });
    }
    const project = database.prepare("SELECT id FROM projects WHERE id = ?").get(body.projectId);
    if (!project) {
        return res.status(404).json({ error: "project not found" });
    }
    const snapshotId = (0, node_crypto_1.randomUUID)();
    const now = new Date().toISOString();
    database.prepare(`
    INSERT INTO context_snapshots (id, project_id, generated_at, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(snapshotId, body.projectId, body.generatedAt ?? now, JSON.stringify(body), now);
    database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, body.projectId);
    return res.status(201).json({
        ok: true,
        snapshotId,
        projectId: body.projectId,
        updatedAt: now,
    });
});
app.get("/context/:projectId", (req, res) => {
    const snapshot = database.prepare(`
    SELECT payload
    FROM context_snapshots
    WHERE project_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(req.params.projectId);
    if (!snapshot?.payload) {
        return res.status(404).json({ error: "context not found" });
    }
    return res.json(JSON.parse(snapshot.payload));
});
app.listen(port, () => {
    console.log(`Portable Context backend running on http://localhost:${port}`);
    console.log(`Portable Context database: ${path.join(storageDir, "portable-context.sqlite")}`);
});
//# sourceMappingURL=index.js.map