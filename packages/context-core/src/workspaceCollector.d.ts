import type { WorkspaceFile } from "./types";
export type WorkspaceCollectorOptions = {
    rootPath: string;
    maxFiles?: number;
    includeMarkdown?: boolean;
};
export declare class WorkspaceCollector {
    private readonly options;
    constructor(options: WorkspaceCollectorOptions);
    collect(): WorkspaceFile[];
    private shouldInclude;
}
