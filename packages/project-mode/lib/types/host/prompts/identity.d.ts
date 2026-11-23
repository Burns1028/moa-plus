export interface MoAIdentity {
    id: string;
    workdir: string;
    isolated: boolean;
    reportTo: string;
    reportingInstructions: string;
}
/** Identity is dialogue content; it never personalizes the system prompt. */
export declare function identityMessage(identity: MoAIdentity): string;
export declare function workerReportingInstructions(contextIndex: string, notes: string, archived: string): string;
