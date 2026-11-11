import { z } from "zod";
import { type ContentBlock, type UserMessage } from "@deepseek-ai/dsh-llm";
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection";
export declare const pathsSchema: z.ZodObject<{
    root: z.ZodString;
    context: z.ZodString;
    notes: z.ZodString;
    archived: z.ZodString;
    index: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const projectSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    id: z.ZodString;
    coordinatorSessionId: z.ZodString;
    workspaceId: z.ZodOptional<z.ZodString>;
    workspacePath: z.ZodString;
    paths: z.ZodObject<{
        root: z.ZodString;
        context: z.ZodString;
        notes: z.ZodString;
        archived: z.ZodString;
        index: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    mode: z.ZodEnum<{
        enabled: "enabled";
        disabled: "disabled";
    }>;
    modeLocked: z.ZodOptional<z.ZodBoolean>;
    revision: z.ZodNumber;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, z.core.$strip>;
export declare const workerSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    creationOperationId: z.ZodString;
    lifecycle: z.ZodEnum<{
        provisioning: "provisioning";
        active: "active";
        deleting: "deleting";
        deleted: "deleted";
        "provision-failed": "provision-failed";
    }>;
    createdAt: z.ZodNumber;
    deletedAt: z.ZodOptional<z.ZodNumber>;
    archivedByCoordinator: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const assignmentSchema: z.ZodObject<{
    id: z.ZodString;
    operationId: z.ZodString;
    workerId: z.ZodString;
    coordinatorTurn: z.ZodNumber;
    segmentStartSeq: z.ZodOptional<z.ZodNumber>;
    participationSeq: z.ZodOptional<z.ZodNumber>;
    participationKind: z.ZodOptional<z.ZodEnum<{
        spawn: "spawn";
        send: "send";
    }>>;
    delivery: z.ZodEnum<{
        steer: "steer";
        queue: "queue";
    }>;
    messageId: z.ZodOptional<z.ZodString>;
    admission: z.ZodEnum<{
        unknown: "unknown";
        rejected: "rejected";
        prepared: "prepared";
        accepted: "accepted";
    }>;
    rejection: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
    taskRef: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const messageSchema: z.ZodPipe<z.ZodUnknown, z.ZodTransform<UserMessage, unknown>>;
export declare const contentSchema: z.ZodPipe<z.ZodUnknown, z.ZodTransform<readonly ContentBlock[], unknown>>;
export declare const assistantSchema: z.ZodObject<{
    messageId: z.ZodString;
    seq: z.ZodNumber;
    content: z.ZodPipe<z.ZodUnknown, z.ZodTransform<readonly ContentBlock[], unknown>>;
}, z.core.$strip>;
export declare const completionSchema: z.ZodObject<{
    id: z.ZodString;
    workerId: z.ZodString;
    workerTurn: z.ZodNumber;
    turnEndSeq: z.ZodNumber;
    assignmentIds: z.ZodArray<z.ZodString>;
    outcome: z.ZodEnum<{
        error: "error";
        completed: "completed";
        aborted: "aborted";
        "max-tokens": "max-tokens";
        refusal: "refusal";
    }>;
    lastAssistant: z.ZodOptional<z.ZodObject<{
        messageId: z.ZodString;
        seq: z.ZodNumber;
        content: z.ZodPipe<z.ZodUnknown, z.ZodTransform<readonly ContentBlock[], unknown>>;
    }, z.core.$strip>>;
    settledAt: z.ZodNumber;
}, z.core.$strip>;
declare const nativeReceiptSchema: z.ZodObject<{
    messageId: z.ZodString;
    seq: z.ZodNumber;
    admissionSeq: z.ZodNumber;
    workerTurnEndSeq: z.ZodNumber;
}, z.core.$strip>;
export type NativeReceipt = z.infer<typeof nativeReceiptSchema>;
export declare const deliverySchema: z.ZodObject<{
    completionId: z.ZodString;
    targetId: z.ZodOptional<z.ZodString>;
    message: z.ZodPipe<z.ZodUnknown, z.ZodTransform<UserMessage, unknown>>;
    state: z.ZodEnum<{
        pending: "pending";
        admitted: "admitted";
        consumed: "consumed";
        suppressed: "suppressed";
    }>;
    attempts: z.ZodNumber;
    lastError: z.ZodOptional<z.ZodString>;
    nativeReceipt: z.ZodOptional<z.ZodObject<{
        messageId: z.ZodString;
        seq: z.ZodNumber;
        admissionSeq: z.ZodNumber;
        workerTurnEndSeq: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const membershipSchema: z.ZodObject<{
    projectId: z.ZodString;
    coordinatorSessionId: z.ZodString;
    coordinatorTurn: z.ZodNumber;
    segmentStartSeq: z.ZodOptional<z.ZodNumber>;
    participationSeq: z.ZodOptional<z.ZodNumber>;
    participationKind: z.ZodOptional<z.ZodEnum<{
        spawn: "spawn";
        send: "send";
        result: "result";
    }>>;
    completionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    workerId: z.ZodString;
    firstOperationId: z.ZodString;
    firstCallId: z.ZodString;
    order: z.ZodNumber;
}, z.core.$strip>;
export declare const outcomeSchema: z.ZodObject<{
    coordinatorSessionId: z.ZodString;
    coordinatorTurn: z.ZodNumber;
    segmentStartSeq: z.ZodOptional<z.ZodNumber>;
    workerId: z.ZodString;
    status: z.ZodEnum<{
        deleted: "deleted";
        completed: "completed";
        failed: "failed";
        stopped: "stopped";
        continued: "continued";
    }>;
    completionIds: z.ZodArray<z.ZodString>;
    lastResultMessageId: z.ZodOptional<z.ZodString>;
    lastResultSeq: z.ZodOptional<z.ZodNumber>;
    summary: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const recordSchema: z.ZodObject<{
    project: z.ZodObject<{
        version: z.ZodLiteral<1>;
        id: z.ZodString;
        coordinatorSessionId: z.ZodString;
        workspaceId: z.ZodOptional<z.ZodString>;
        workspacePath: z.ZodString;
        paths: z.ZodObject<{
            root: z.ZodString;
            context: z.ZodString;
            notes: z.ZodString;
            archived: z.ZodString;
            index: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        mode: z.ZodEnum<{
            enabled: "enabled";
            disabled: "disabled";
        }>;
        modeLocked: z.ZodOptional<z.ZodBoolean>;
        revision: z.ZodNumber;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, z.core.$strip>;
    workers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        creationOperationId: z.ZodString;
        lifecycle: z.ZodEnum<{
            provisioning: "provisioning";
            active: "active";
            deleting: "deleting";
            deleted: "deleted";
            "provision-failed": "provision-failed";
        }>;
        createdAt: z.ZodNumber;
        deletedAt: z.ZodOptional<z.ZodNumber>;
        archivedByCoordinator: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    assignments: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        operationId: z.ZodString;
        workerId: z.ZodString;
        coordinatorTurn: z.ZodNumber;
        segmentStartSeq: z.ZodOptional<z.ZodNumber>;
        participationSeq: z.ZodOptional<z.ZodNumber>;
        participationKind: z.ZodOptional<z.ZodEnum<{
            spawn: "spawn";
            send: "send";
        }>>;
        delivery: z.ZodEnum<{
            steer: "steer";
            queue: "queue";
        }>;
        messageId: z.ZodOptional<z.ZodString>;
        admission: z.ZodEnum<{
            unknown: "unknown";
            rejected: "rejected";
            prepared: "prepared";
            accepted: "accepted";
        }>;
        rejection: z.ZodOptional<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strip>>;
        taskRef: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    completions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        workerId: z.ZodString;
        workerTurn: z.ZodNumber;
        turnEndSeq: z.ZodNumber;
        assignmentIds: z.ZodArray<z.ZodString>;
        outcome: z.ZodEnum<{
            error: "error";
            completed: "completed";
            aborted: "aborted";
            "max-tokens": "max-tokens";
            refusal: "refusal";
        }>;
        lastAssistant: z.ZodOptional<z.ZodObject<{
            messageId: z.ZodString;
            seq: z.ZodNumber;
            content: z.ZodPipe<z.ZodUnknown, z.ZodTransform<readonly ContentBlock[], unknown>>;
        }, z.core.$strip>>;
        settledAt: z.ZodNumber;
    }, z.core.$strip>>;
    deliveries: z.ZodArray<z.ZodObject<{
        completionId: z.ZodString;
        targetId: z.ZodOptional<z.ZodString>;
        message: z.ZodPipe<z.ZodUnknown, z.ZodTransform<UserMessage, unknown>>;
        state: z.ZodEnum<{
            pending: "pending";
            admitted: "admitted";
            consumed: "consumed";
            suppressed: "suppressed";
        }>;
        attempts: z.ZodNumber;
        lastError: z.ZodOptional<z.ZodString>;
        nativeReceipt: z.ZodOptional<z.ZodObject<{
            messageId: z.ZodString;
            seq: z.ZodNumber;
            admissionSeq: z.ZodNumber;
            workerTurnEndSeq: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    memberships: z.ZodArray<z.ZodObject<{
        projectId: z.ZodString;
        coordinatorSessionId: z.ZodString;
        coordinatorTurn: z.ZodNumber;
        segmentStartSeq: z.ZodOptional<z.ZodNumber>;
        participationSeq: z.ZodOptional<z.ZodNumber>;
        participationKind: z.ZodOptional<z.ZodEnum<{
            spawn: "spawn";
            send: "send";
            result: "result";
        }>>;
        completionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        workerId: z.ZodString;
        firstOperationId: z.ZodString;
        firstCallId: z.ZodString;
        order: z.ZodNumber;
    }, z.core.$strip>>;
    outcomes: z.ZodArray<z.ZodObject<{
        coordinatorSessionId: z.ZodString;
        coordinatorTurn: z.ZodNumber;
        segmentStartSeq: z.ZodOptional<z.ZodNumber>;
        workerId: z.ZodString;
        status: z.ZodEnum<{
            deleted: "deleted";
            completed: "completed";
            failed: "failed";
            stopped: "stopped";
            continued: "continued";
        }>;
        completionIds: z.ZodArray<z.ZodString>;
        lastResultMessageId: z.ZodOptional<z.ZodString>;
        lastResultSeq: z.ZodOptional<z.ZodNumber>;
        summary: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    operations: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    toggles: z.ZodRecord<z.ZodString, z.ZodNumber>;
    reminders: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
}, z.core.$strip>;
/** Persisted Project aggregate; execution remains in native Session history. */
export type RecordState = z.infer<typeof recordSchema>;
/** One ended native Worker turn and its canonical final assistant payload. */
export type Completion = z.infer<typeof completionSchema>;
/** Project membership record, independent of a Worker's live execution status. */
export type Worker = z.infer<typeof workerSchema>;
export declare const domainSpec: {
    name: string;
    version: number;
    tables: {
        projects: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            project: {
                version: 1;
                id: string;
                coordinatorSessionId: string;
                workspacePath: string;
                paths: {
                    root: string;
                    context: string;
                    notes: string;
                    archived: string;
                    index?: string | undefined;
                };
                mode: "enabled" | "disabled";
                revision: number;
                createdAt: number;
                updatedAt: number;
                workspaceId?: string | undefined;
                modeLocked?: boolean | undefined;
            };
            workers: {
                id: string;
                name: string;
                description: string;
                creationOperationId: string;
                lifecycle: "provisioning" | "active" | "deleting" | "deleted" | "provision-failed";
                createdAt: number;
                deletedAt?: number | undefined;
                archivedByCoordinator?: boolean | undefined;
            }[];
            assignments: {
                id: string;
                operationId: string;
                workerId: string;
                coordinatorTurn: number;
                delivery: "steer" | "queue";
                admission: "unknown" | "rejected" | "prepared" | "accepted";
                segmentStartSeq?: number | undefined;
                participationSeq?: number | undefined;
                participationKind?: "spawn" | "send" | undefined;
                messageId?: string | undefined;
                rejection?: {
                    code: string;
                    message: string;
                } | undefined;
                taskRef?: string | undefined;
            }[];
            completions: {
                id: string;
                workerId: string;
                workerTurn: number;
                turnEndSeq: number;
                assignmentIds: string[];
                outcome: "error" | "completed" | "aborted" | "max-tokens" | "refusal";
                settledAt: number;
                lastAssistant?: {
                    messageId: string;
                    seq: number;
                    content: readonly ContentBlock[];
                } | undefined;
            }[];
            deliveries: {
                completionId: string;
                message: UserMessage;
                state: "pending" | "admitted" | "consumed" | "suppressed";
                attempts: number;
                targetId?: string | undefined;
                lastError?: string | undefined;
                nativeReceipt?: {
                    messageId: string;
                    seq: number;
                    admissionSeq: number;
                    workerTurnEndSeq: number;
                } | undefined;
            }[];
            memberships: {
                projectId: string;
                coordinatorSessionId: string;
                coordinatorTurn: number;
                workerId: string;
                firstOperationId: string;
                firstCallId: string;
                order: number;
                segmentStartSeq?: number | undefined;
                participationSeq?: number | undefined;
                participationKind?: "spawn" | "send" | "result" | undefined;
                completionIds?: string[] | undefined;
            }[];
            outcomes: {
                coordinatorSessionId: string;
                coordinatorTurn: number;
                workerId: string;
                status: "deleted" | "completed" | "failed" | "stopped" | "continued";
                completionIds: string[];
                segmentStartSeq?: number | undefined;
                lastResultMessageId?: string | undefined;
                lastResultSeq?: number | undefined;
                summary?: string | undefined;
            }[];
            operations: Record<string, z.core.util.JSONType>;
            toggles: Record<string, number>;
            reminders: Record<string, boolean>;
        }>;
    };
};
export declare const projectionSchema: z.ZodObject<{
    turn: z.ZodNumber;
    inheritedEventCount: z.ZodDefault<z.ZodNumber>;
    segmentStartSeq: z.ZodDefault<z.ZodNumber>;
    lastSeq: z.ZodDefault<z.ZodNumber>;
    resultAnchors: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        coordinatorTurn: z.ZodNumber;
        segmentStartSeq: z.ZodNumber;
        participationSeq: z.ZodNumber;
    }, z.core.$strip>>>;
    messageIds: z.ZodArray<z.ZodString>;
    handoffMessageIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    lastAssistant: z.ZodOptional<z.ZodObject<{
        messageId: z.ZodString;
        seq: z.ZodNumber;
        content: z.ZodPipe<z.ZodUnknown, z.ZodTransform<readonly ContentBlock[], unknown>>;
    }, z.core.$strip>>;
    finished: z.ZodArray<z.ZodObject<{
        turn: z.ZodNumber;
        seq: z.ZodNumber;
        reason: z.ZodEnum<{
            error: "error";
            completed: "completed";
            aborted: "aborted";
            "max-tokens": "max-tokens";
            refusal: "refusal";
        }>;
        time: z.ZodNumber;
        messageIds: z.ZodArray<z.ZodString>;
        lastAssistant: z.ZodOptional<z.ZodObject<{
            messageId: z.ZodString;
            seq: z.ZodNumber;
            content: z.ZodPipe<z.ZodUnknown, z.ZodTransform<readonly ContentBlock[], unknown>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    consumed: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type Projection = z.infer<typeof projectionSchema>;
declare module "@deepseek-ai/dsh-session-projection/types" {
    interface SessionProjectionStateMap {
        "project-mode-results": Projection;
    }
}
export declare const projection: ProjectionDefinition<"project-mode-results", Projection>;
export declare function normalizeReason(kind: string): Completion["outcome"];
export {};
