export type WorkspaceFile = {
    path: string;
    size: number;
    modifiedAt: string;
};
export type GitState = {
    branch: string | null;
    status: string;
    recentCommits: string[];
};
export type ContextPack = {
    projectId: string;
    workspaceRoot: string;
    generatedAt: string;
    repository: {
        branch?: string | null;
        status?: string;
        recentCommits: string[];
        diffSummary?: string;
    };
    structure: {
        importantFiles: string[];
        directories: string[];
    };
    documents: {
        path: string;
        summary?: string;
        content?: string;
    }[];
    activeContext: {
        activeFile?: string;
        openFiles: string[];
        diagnostics: string[];
    };
    session: {
        goal?: string;
        summary?: string;
        decisions: string[];
        pendingTasks: string[];
    };
};
export type ContextSettings = {
    includeMarkdown: boolean;
    includeGitHistory: boolean;
    maxFiles: number;
    maxDocumentChars: number;
    backendUrl?: string;
};
