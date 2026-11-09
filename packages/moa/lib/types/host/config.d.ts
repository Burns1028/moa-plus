import z from "@deepseek-ai/schemastery";
export interface Config {
    dataDirectory: string;
    coordinatorHiddenTools: string[];
    progressTextMaxChars: number;
    retryInitialDelayMs: number;
    retryMaxDelayMs: number;
    retryMaxAttempts: number;
}
export declare const Config: z<Config>;
