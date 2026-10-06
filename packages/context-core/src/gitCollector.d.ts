import type { GitState } from "./types";
export declare class GitCollector {
    private readonly workspaceRoot;
    constructor(workspaceRoot: string);
    collect(): GitState;
    private run;
}
