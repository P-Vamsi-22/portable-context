import * as vscode from "vscode";
import { ContextBuilder, GitCollector, WorkspaceCollector, type ContextPack } from "context-core";

export class ContextController implements vscode.WebviewViewProvider {
  public static readonly viewId = "portable-context.sidebar";
  private static readonly backendUrl = "http://localhost:3000";
  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private project: Project | undefined;
  private refreshing = false;
  private workspaceRoot: string | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private workspaceWatcher: vscode.FileSystemWatcher | undefined;
  private ingestionPollTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    const projectId = context.globalState.get<string>("portable-context.projectId");
    const projectName = context.globalState.get<string>("portable-context.projectName");
    const repositoryPath = context.globalState.get<string>("portable-context.repositoryPath");
    if (projectId && projectName && repositoryPath) {
      this.project = { id: projectId, name: projectName, repositoryPath };
    }

  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewListeners();
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!this.isMessage(message)) {
          console.warn("Portable Context received an invalid sidebar message.");
          return;
        }

        if (message.type === "create-project") {
          if (message.name) {
            await this.createProject(message.name);
          }
        } else if (message.type === "open-project") {
          await this.openProject();
        } else if (message.type === "new-project") {
          await this.newProject();
        } else if (message.type === "refresh") {
          await this.refreshContext();
        }
      }),
      webviewView.onDidDispose(() => {
        this.disposeViewListeners();
        this.view = undefined;
      }),
    );

    void this.initializeWorkspace();
  }

  public initialize(): void {
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.initializeWorkspace();
      }),
    );
    this.configureWorkspaceWatcher();
  }

  public async openProject(): Promise<void> {
    try {
      const projects = await this.fetchProjects();
      if (projects.length === 0) {
        await this.sendError("No context projects exist yet. Use New Project first.");
        return;
      }

      const selected = await vscode.window.showQuickPick(
        projects.map((project) => ({
          label: project.name,
          description: project.repositoryPath,
          detail: project.createdAt
            ? `Created ${new Date(project.createdAt).toLocaleString()}`
            : "Context project",
          project,
        })),
        { placeHolder: "Select a context project" },
      );
      if (!selected) return;

      this.project = selected.project;
      await this.persistProject(this.project);
      await this.sendProjectState();
      await this.loadLatestProjectContext();
      await this.refreshContext();
    } catch (error) {
      await this.sendError(`Could not open context project: ${this.errorMessage(error)}`);
    }
  }

  public async newProject(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) {
      await this.sendError("Open a workspace before creating a context project.");
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: "Name for the new context project",
      placeHolder: pathBasename(root),
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "Enter a project name.";
        if (/[<>:"/\\|?*]/.test(trimmed) || trimmed === "." || trimmed === "..") {
          return "Enter a valid folder name.";
        }
        return undefined;
      },
    });
    if (!name) return;

    try {
      const branch = (await new GitCollector(root).collect()).branch;
      const response = await fetch(`${ContextController.backendUrl}/projects/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), repositoryPath: root, branch }),
      });
      if (!response.ok) {
        const responseBody = await response.text();
        if (response.status === 404 && responseBody.includes("Cannot POST")) {
          throw new Error(
            "The backend on port 3000 is outdated or is a different service. Restart it with npm run dev:backend, then verify GET /health lists /projects/create.",
          );
        }
        throw new Error(`${response.status} ${responseBody}`);
      }
      this.project = await response.json() as Project;
      await this.persistProject(this.project);
      await this.sendProjectState();
      await this.refreshContext();
    } catch (error) {
      await this.sendError(`Could not create context project: ${this.errorMessage(error)}`);
    }
  }

  public showPanel(): void {
    void vscode.commands.executeCommand("workbench.view.extension.portable-context");
  }

  public async refreshContext(ingestGraph = true): Promise<void> {
    if (this.refreshing) {
      return;
    }
    const root = this.getWorkspaceRoot();
    if (!root) {
      await this.sendError("Open a workspace folder before collecting context.");
      return;
    }
    if (!this.project) {
      await this.ensureProject(root);
    }
    if (!this.project) {
      return;
    }
    this.refreshing = true;
    await this.view?.webview.postMessage({ type: "refreshing" });
    const settings = {
      includeMarkdown: true,
      includeGitHistory: true,
      maxFiles: 5000,
      maxDocumentChars: 12000,
      backendUrl: ContextController.backendUrl,
    };

    if (!ingestGraph) {
      await this.view?.webview.postMessage({
        type: "progress",
        message: "Context saved. Automatic GraphRAG ingestion is disabled for this event.",
        state: "ready",
      });
    } else try {
      const files = await new WorkspaceCollector({
        rootPath: root,
        maxFiles: settings.maxFiles,
        includeMarkdown: settings.includeMarkdown,
      }).collect();
      await this.view?.webview.postMessage({
        type: "progress",
        message: `Workspace structure discovered: ${files.length} files`,
      });
      const gitState = await new GitCollector(root).collect();
      await this.view?.webview.postMessage({
        type: "progress",
        message: "Git and editor context collected",
      });
      const context = await new ContextBuilder({
        projectId: this.project.id,
        workspaceRoot: root,
        gitState,
        files,
        settings,
        activeFile: vscode.window.activeTextEditor?.document.uri.fsPath,
        openFiles: vscode.window.visibleTextEditors.map((editor) => editor.document.uri.fsPath),
        diagnostics: vscode.languages.getDiagnostics().map(([uri, diagnostics]) => {
          return `${uri.fsPath}: ${diagnostics.length} issue(s)`;
        }),
      }).build();

      const storagePath = vscode.Uri.joinPath(this.context.globalStorageUri, "portable-context");
      await vscode.workspace.fs.createDirectory(storagePath);
      const targetFile = vscode.Uri.joinPath(storagePath, "context-pack.json");
      await vscode.workspace.fs.writeFile(targetFile, Buffer.from(JSON.stringify(context, null, 2), "utf8"));

      let response = await this.uploadContext(settings.backendUrl, context);

      if (!response.ok) {
        if (response.status === 404) {
          await this.ensureProject(root);
          if (!this.project) {
            throw new Error("Project registration did not return a project.");
          }
          context.projectId = this.project.id;
          response = await this.uploadContext(settings.backendUrl, context);
        }
        if (!response.ok) {
          const responseBody = await response.text();
          throw new Error(`Backend rejected context upload (${response.status}): ${responseBody}`);
        }
      }
      const uploadResult = await response.json() as { updatedAt?: string; snapshotId?: string };
      if (uploadResult.updatedAt && this.project) {
        this.project = { ...this.project, updatedAt: uploadResult.updatedAt };
        await this.persistProject(this.project);
        await this.sendProjectState();
      }
      try {
        const ingestion = await fetch(
          `${settings.backendUrl}/projects/${this.project.id}/ingestion`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              repository_path: root,
              project_id: this.project.id,
              snapshot_id: uploadResult.snapshotId,
              mode: "full",
            }),
          },
        );
        if (ingestion.ok) {
          const job = await ingestion.json() as { jobId?: string };
          await this.view?.webview.postMessage({
            type: "progress",
            message: `GraphRAG ingestion queued${job.jobId ? ` (${job.jobId})` : ""}.`,
            state: "queued",
          });
          if (job.jobId) void this.pollIngestion(job.jobId);
        } else {
          const detail = await ingestion.text();
          console.warn("Portable Context GraphRAG ingestion request failed:", detail);
          await this.view?.webview.postMessage({
            type: "progress",
            message: `GraphRAG ingestion failed: ${detail}`,
            state: "error",
          });
        }
      } catch (error) {
        console.warn("Portable Context GraphRAG service unavailable:", error);
        await this.view?.webview.postMessage({
          type: "progress",
          message: `GraphRAG service unavailable: ${this.errorMessage(error)}`,
          state: "error",
        });
      }
      await this.view?.webview.postMessage({
        type: "context-updated",
        payload: context,
      });
    } catch (error) {
      await this.sendError(`Context collection failed: ${this.errorMessage(error)}`);
      return;
    } finally {
      this.refreshing = false;
    }

  }

  private async createProject(name: string): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) {
      await this.sendError("Open a workspace folder before creating a project.");
      return;
    }

    try {
      await this.registerProject(root, name.trim() || pathBasename(root));
      await this.refreshContext(
        vscode.workspace.getConfiguration("portableContext")
          .get("autoIngestOnWorkspaceOpen", true),
      );
    } catch (error) {
      await this.sendError(`Project creation failed: ${this.errorMessage(error)}`);
    }
  }

  private async initializeWorkspace(): Promise<void> {
    const root = this.getWorkspaceRoot();
    this.configureWorkspaceWatcher();
    if (!root) {
      this.project = undefined;
      await this.sendProjectState();
      await this.sendError("Open a folder/workspace in VS Code to start Portable Context.");
      return;
    }
    await this.sendProjectState();

    try {
      await this.ensureProject(root);
      await this.refreshContext();
    } catch (error) {
      await this.sendError(`Project synchronization failed: ${this.errorMessage(error)}`);
    }
  }

  private async ensureProject(root: string): Promise<void> {
    const defaultName = pathBasename(root);
    if (this.project?.repositoryPath === root) {
      try {
        await this.registerProject(root, this.project.name || defaultName);
        return;
      } catch {
        this.project = undefined;
      }
    }
    await this.registerProject(root, defaultName);
  }

  private async registerProject(root: string, name: string): Promise<void> {
    const branch = (await new GitCollector(root).collect()).branch;
    const response = await fetch(`${ContextController.backendUrl}/projects/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, repositoryPath: root, branch }),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`);
      }
      const project = await response.json() as Project;
      this.project = project;
      await this.persistProject(project);
      await this.sendProjectState();
  }

  private async fetchProjects(): Promise<Project[]> {
    const response = await fetch(`${ContextController.backendUrl}/projects`);
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    return await response.json() as Project[];
  }

  private async loadLatestProjectContext(): Promise<void> {
    if (!this.project) return;

    const response = await fetch(`${ContextController.backendUrl}/context/${this.project.id}`);
    if (response.status === 404) {
      await this.view?.webview.postMessage({
        type: "project-history",
        message: "No context snapshot has been collected for this project yet.",
      });
      return;
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    const context = await response.json() as ContextPack;
    await this.view?.webview.postMessage({
      type: "context-loaded",
      payload: context,
      project: this.project,
    });
  }

  private async persistProject(project: Project): Promise<void> {
    await this.context.globalState.update("portable-context.projectId", project.id);
    await this.context.globalState.update("portable-context.projectName", project.name);
    await this.context.globalState.update("portable-context.repositoryPath", project.repositoryPath);
  }

  private async uploadContext(backendUrl: string, context: object): Promise<Response> {
    return fetch(`${backendUrl}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    });
  }

  private configureWorkspaceWatcher(): void {
    this.workspaceWatcher?.dispose();
    this.workspaceWatcher = undefined;
    const root = this.getWorkspaceRoot();
    if (!root) return;

    const pattern = new vscode.RelativePattern(root, "**/*");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const schedule = () => {
      if (!vscode.workspace.getConfiguration("portableContext")
        .get("autoIngestOnFileChange", true)) {
        void this.view?.webview.postMessage({
          type: "progress",
          message: "Workspace changed. Automatic file-change ingestion is disabled.",
          state: "ready",
        });
        return;
      }
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        void this.refreshContext();
      }, 750);
    };
    watcher.onDidCreate(schedule, this.context.subscriptions);
    watcher.onDidChange(schedule, this.context.subscriptions);
    watcher.onDidDelete(schedule, this.context.subscriptions);
    this.workspaceWatcher = watcher;
    this.context.subscriptions.push(watcher);
  }

  private async pollIngestion(jobId: string): Promise<void> {
    if (this.ingestionPollTimer) clearTimeout(this.ingestionPollTimer);
    try {
      const response = await fetch(`${ContextController.backendUrl}/ingestion/${jobId}`);
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      const job = await response.json() as {
        status?: string;
        error?: string;
        result?: { graph?: { status?: string; nodes?: number; relationships?: number } };
      };
      const status = job.status ?? "unknown";
      const graph = job.result?.graph;
      const detail = graph?.status === "completed"
        ? ` (${graph.nodes ?? 0} nodes, ${graph.relationships ?? 0} relationships)`
        : "";
      await this.view?.webview.postMessage({
        type: "progress",
        message: status === "completed"
          ? `GraphRAG ingestion completed${detail}.`
          : status === "failed"
            ? `GraphRAG ingestion failed: ${job.error ?? graph?.status ?? "unknown error"}`
            : `GraphRAG ingestion ${status}...`,
        state: status === "failed" ? "error" : status === "completed" ? "ready" : "running",
      });
      if (status !== "completed" && status !== "failed") {
        this.ingestionPollTimer = setTimeout(() => void this.pollIngestion(jobId), 1000);
      }
    } catch (error) {
      await this.view?.webview.postMessage({
        type: "progress",
        message: `Could not read GraphRAG status: ${this.errorMessage(error)}`,
        state: "error",
      });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.createNonce();
    const cspSource = webview.cspSource;

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
          <style>
            body { padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); }
            h2 { margin: 0 0 4px; font-size: 16px; }
            .muted { color: var(--vscode-descriptionForeground); margin: 0 0 14px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
            .card { padding: 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
            .label { color: var(--vscode-descriptionForeground); font-size: 11px; }
            .value { display: block; margin-top: 3px; font-size: 13px; overflow-wrap: anywhere; }
            button { width: 100%; padding: 6px 10px; border: 0; border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
            button:hover { background: var(--vscode-button-hoverBackground); }
            button:disabled { opacity: .6; cursor: wait; }
            .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
            #status { margin-top: 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
            #progress-log { margin: 8px 0 0; padding-left: 18px; max-height: 140px; overflow: auto; font-size: 11px; }
            #progress-log li { margin: 4px 0; }
            .running { color: var(--vscode-charts-blue); }
            .ready { color: var(--vscode-testing-iconPassed); }
            .error { color: var(--vscode-testing-iconFailed); }
          </style>
        </head>
        <body>
          <h2>Portable Context</h2>
          <p class="muted" id="workspace">Detecting workspace...</p>
          <div class="actions">
            <button id="open-project" type="button">Open Project</button>
            <button id="new-project" type="button">New Project</button>
          </div>
          <button id="refresh" type="button">Refresh workspace context</button>
          <div class="grid">
            <div class="card"><span class="label">Project</span><span class="value" id="project">Not loaded</span></div>
            <div class="card"><span class="label">Location</span><span class="value" id="location">Not loaded</span></div>
            <div class="card"><span class="label">Files</span><span class="value" id="files">-</span></div>
            <div class="card"><span class="label">Directories</span><span class="value" id="directories">-</span></div>
            <div class="card"><span class="label">Branch</span><span class="value" id="branch">Not loaded</span></div>
            <div class="card"><span class="label">Markdown/docs</span><span class="value" id="docs">-</span></div>
            <div class="card"><span class="label">Source files</span><span class="value" id="source">-</span></div>
            <div class="card"><span class="label">Diagnostics</span><span class="value" id="diagnostics">-</span></div>
            <div class="card"><span class="label">Snapshot date</span><span class="value" id="snapshot-date">-</span></div>
            <div class="card"><span class="label">Project updated</span><span class="value" id="project-updated">-</span></div>
          </div>
          <h3>Collected context</h3>
          <ul id="documents"></ul>
          <h3>Live progress</h3>
          <ul id="progress-log"></ul>
          <div id="status">Waiting for context...</div>
          <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            document.getElementById('open-project').addEventListener('click', () => {
              vscode.postMessage({ type: 'open-project' });
            });
            document.getElementById('new-project').addEventListener('click', () => {
              vscode.postMessage({ type: 'new-project' });
            });
            const refreshButton = document.getElementById('refresh');
            refreshButton.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
            window.addEventListener('message', (event) => {
              const message = event.data;
              if (message.type === 'refreshing') {
                refreshButton.disabled = true;
                refreshButton.textContent = 'Analyzing workspace...';
                document.getElementById('status').textContent = 'Discovering files, documentation, configuration, and Git metadata...';
                return;
              }
              if (message.type === 'project-state') {
                if (message.project) {
                  document.getElementById('project').textContent = message.project.name;
                  document.getElementById('location').textContent = message.project.repositoryPath;
                  document.getElementById('project-updated').textContent = message.project.updatedAt
                    ? new Date(message.project.updatedAt).toLocaleString()
                    : '-';
                  document.getElementById('workspace').textContent =
                    message.workspaceType + ' workspace detected (' + message.workspaceFolderCount + ' folder' + (message.workspaceFolderCount === 1 ? '' : 's') + ')';
                } else {
                  document.getElementById('project').textContent = 'No workspace';
                  document.getElementById('location').textContent = '-';
                  document.getElementById('workspace').textContent = 'Open a folder/workspace in VS Code to start Portable Context.';
                }
                return;
              }
              if (message.type === 'error') {
                refreshButton.disabled = false;
                refreshButton.textContent = 'Refresh workspace context';
                document.getElementById('status').textContent = message.message;
                return;
              }
              if (message.type === 'project-history') {
                document.getElementById('status').textContent = message.message;
                return;
              }
              if (message.type === 'context-loaded') {
                renderContext(message.payload, 'Loaded saved context: ');
                return;
              }
              if (message.type === 'context-updated') {
                renderContext(message.payload, 'Updated context: ');
                return;
              }
              function renderContext(context, prefix) {
                document.getElementById('branch').textContent = context.repository.branch || 'Not a Git repository';
                document.getElementById('files').textContent = context.structure.totalFiles;
                document.getElementById('directories').textContent = context.structure.directories.length;
                document.getElementById('docs').textContent = context.structure.documentationFiles;
                document.getElementById('source').textContent = context.structure.sourceFiles;
                document.getElementById('diagnostics').textContent = context.activeContext.diagnostics.length;
                document.getElementById('snapshot-date').textContent = new Date(context.generatedAt).toLocaleString();
                const documents = document.getElementById('documents');
                documents.textContent = '';
                context.documents.slice(0, 10).forEach((document) => {
                  const item = document.createElement('li');
                  item.textContent = document.path;
                  documents.appendChild(item);
                });
                document.getElementById('status').textContent =
                  prefix + new Date(context.generatedAt).toLocaleString();
                refreshButton.disabled = false;
                refreshButton.textContent = 'Refresh workspace context';
              }
              if (message.type === 'progress') {
                document.getElementById('status').textContent = message.message;
                const progressLog = document.getElementById('progress-log');
                const item = document.createElement('li');
                item.textContent = new Date().toLocaleTimeString() + ' - ' + message.message;
                item.className = message.state || 'running';
                progressLog.prepend(item);
                while (progressLog.children.length > 12) progressLog.removeChild(progressLog.lastChild);
                return;
              }
            });
          </script>
        </body>
      </html>
    `;
  }

  private isMessage(message: unknown): message is {
    type: "refresh" | "create-project" | "open-project" | "new-project";
    name?: string;
  } {
    return typeof message === "object"
      && message !== null
      && "type" in message
      && (
        (message as { type?: unknown }).type === "refresh"
        || (message as { type?: unknown }).type === "open-project"
        || (message as { type?: unknown }).type === "new-project"
        || (
          (message as { type?: unknown }).type === "create-project"
          && typeof (message as { name?: unknown }).name === "string"
        )
      );
  }

  private async sendProjectState(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    await this.view?.webview.postMessage({
      type: "project-state",
      project: this.project ?? null,
      workspaceType: folders.length > 1 ? "multi-root" : folders.length === 1 ? "single-folder" : "none",
      workspaceFolderCount: folders.length,
    });
  }

  private async sendError(message: string): Promise<void> {
    console.error(`Portable Context: ${message}`);
    await this.view?.webview.postMessage({ type: "error", message });
  }

  private getWorkspaceRoot(): string | undefined {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return this.workspaceRoot;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private createNonce(): string {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let index = 0; index < 32; index += 1) {
      nonce += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return nonce;
  }

  private disposeViewListeners(): void {
    for (const disposable of this.viewDisposables) {
      disposable.dispose();
    }
    this.viewDisposables = [];
  }
}

type Project = {
  id: string;
  name: string;
  repositoryPath: string;
  branch?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function pathBasename(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return normalized.slice(separator + 1) || "Workspace";
}
