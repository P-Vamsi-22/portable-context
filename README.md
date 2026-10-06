# Portable Context

Portable Context is a VS Code extension prototype built to collect project context, summarize it, and send it to a backend for optimization and later retrieval.

This project follows the same high-level architecture as the Cline repo:

- VS Code activation and lifecycle
- extension host + webview split
- service/controller separation
- reusable core package for context gathering
- local storage for project state and session memory

## Architecture

```text
VS Code / Cursor / AI tooling
        |
        v
Portable Context extension
        |
        +--> ContextController
        |       +--> WorkspaceCollector
        |       +--> GitCollector
        |       +--> DocumentIndexer
        |       +--> ContextPackBuilder
        |
        +--> LocalStorage
        |
        +--> Backend API client
```

## Included in this prototype

- workspace file scanning
- README and Markdown discovery
- Git branch and recent commits capture
- project structure summary
- Activity Bar sidebar with project creation and context status
- backend context-project picker with Open Project and New Project actions
- Markdown-only context collection and upload
- SQLite-backed projects and context snapshots
- local JSON context snapshot export

## Run locally

```bash
npm install
npm run build
```

Start the backend in a separate terminal:

```bash
npm run dev:backend
```

Then open the extension in VS Code and press F5. In the Extension Development
Host, open a workspace, select the **Portable Context** Activity Bar icon,
enter a project name, and choose **Create project**. The project is associated
with the actual workspace path and Git branch. Use **Collect Markdown context**
to collect `.md` files from that workspace and upload the context snapshot.

The backend stores its SQLite database at the repository-level
`data/portable-context.sqlite`, regardless of whether it is started through
the workspace script or directly from the compiled backend. Check
`GET /health` to confirm the running process exposes `/projects/create`.

```text
data/portable-context.sqlite
```

The backend exposes:

```text
GET  /health
POST /projects
GET  /projects
POST /projects/create
POST /projects/register
POST /context
GET  /context/:projectId
POST /projects/:projectId/ingestion
POST /projects/:projectId/query
```

The optional GraphRAG service runs separately:

```powershell
cd "graphrag-pipeline"
python -m pip install -r requirements.txt
$env:PYTHONPATH = "src"
python -m api
```

It listens on `http://127.0.0.1:8000`. The Node backend proxies
`POST /projects/:projectId/ingestion` to the FastAPI service. Set
`GRAPHRAG_URL` if the service runs elsewhere.

FastAPI stores ingestion jobs and completed scan results in
`graphrag-pipeline/data/graphrag.sqlite`, so job status is retained across
service requests and can be queried with `GET /ingestion/{jobId}`. Each
completed scan includes deterministic repository facts using the initial
ontology types `Repository`, `Directory`, `File`, `Document`, and
`Configuration`, plus `CONTAINS`, `DOCUMENTS`, and `CONFIGURES` relationships.
The ontology is rooted at `SoftwareEntity`; unknown/custom extracted types are
preserved as `SoftwareEntity` with their original type retained in properties
and the `preserved` report.

Neo4j writes are opt-in. Set `NEO4J_INGEST_ENABLED=true` in
`graphrag-pipeline/.env` after configuring a reachable Neo4j instance. If
Neo4j is disabled, ingestion still completes with `graph.status=disabled`; if
it is enabled but unavailable, the job completes with
`graph.status=failed` and retains the error for diagnosis rather than hiding
the repository scan result.

Queries use the existing LangGraph pipeline through:

```text
POST /projects/:projectId/query
{ "question": "How is context ingestion organized?" }
```

The pipeline reuses the existing query rewriter, Neo4j graph retriever,
vector fallback, answer generator, and confidence loop. The repository
ontology is stored using the existing `Entity`/`RELATION` graph contract, with
stable IDs and ontology metadata preserved on each node.

Graph data is project-scoped. Every ontology node is written with a
`projectId`, relationship writes require both endpoints to have the same
project ID, and GraphRAG retrieval includes the requested project ID in every
Neo4j match. A query for one Portable Context project cannot retrieve entities
from another project. Existing unscoped graph data is intentionally excluded
from project-scoped queries; re-ingest a project after enabling graph writes
to populate its scoped graph.

Project-scoped IDs include the project ID as well as the repository path, so
two projects containing the same relative file path cannot overwrite each
other in Neo4j.

## Project layout

```text
portable-context/
  apps/
    vscode/
      src/
  packages/
    context-core/
      src/
```

## Next steps

- add pruning and summarization rules
- add backend upload API
- add MCP adapter for Claude/other tools
- add session memory and context retrieval
