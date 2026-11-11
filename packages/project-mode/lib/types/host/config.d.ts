import z from "@deepseek-ai/schemastery";
export interface Config {
    backgroundStrategy: "after-seconds" | "new-message" | "llm-judge";
    backgroundAfterSeconds: number;
    completionVerification: boolean | "on-demand";
    dataDirectory: string;
    coordinatorHiddenTools: string[];
    progressTextMaxChars: number;
    retryInitialDelayMs: number;
    retryMaxDelayMs: number;
    retryMaxAttempts: number;
}
export declare const Config: z<Config>;
