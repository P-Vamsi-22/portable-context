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
export declare class ContextBuilder {
    private readonly options;
    constructor(options: ContextBuilderOptions);
    build(): ContextPack;
    private collectDirectories;
    private createSummary;
    private readSnippet;
    private toRelativePath;
}
