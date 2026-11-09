import { MessageId, createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm";
import { SubagentError } from "@deepseek-ai/dsh-subagent";
import { queueHostSubagentPrompt, steerHostSubagentPrompt } from "@deepseek-ai/dsh-subagent/internal";
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { SessionId, SessionSeq, snapshotSessionEvent } from "@deepseek-ai/dsh-session";
import { isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import z$1 from "@deepseek-ai/schemastery";
// src/host/state.ts
const id = z.string().min(1);
const pathsSchema = z.object({
	root: id,
	context: id,
	notes: id,
	archived: id
});
const moaSchema = z.object({
	version: z.literal(1),
	id,
	coordinatorSessionId: id,
	workspaceId: id.optional(),
	workspacePath: id,
	paths: pathsSchema,
	mode: z.enum(["enabled", "disabled"]),
	modeLocked: z.boolean().optional(),
	revision: z.number().int().nonnegative(),
	createdAt: z.number(),
	updatedAt: z.number()
});
const workerSchema = z.object({
	id,
	name: id,
	description: z.string(),
	creationOperationId: id,
	lifecycle: z.enum([
		"provisioning",
		"active",
		"deleting",
		"deleted",
		"provision-failed"
	]),
	createdAt: z.number(),
	deletedAt: z.number().optional(),
	archivedByCoordinator: z.boolean().optional()
});
const assignmentSchema = z.object({
	id,
	operationId: id,
	workerId: id,
	coordinatorTurn: z.number().int(),
	segmentStartSeq: z.number().int().nonnegative().optional(),
	participationSeq: z.number().int().nonnegative().optional(),
	participationKind: z.enum(["spawn", "send"]).optional(),
	delivery: z.enum(["steer", "queue"]),
	messageId: id.optional(),
	admission: z.enum([
		"prepared",
		"accepted",
		"unknown",
		"rejected"
	]),
	rejection: z.object({
		code: z.string(),
		message: z.string()
	}).optional(),
	taskRef: z.string().optional()
});
const messageSchema = z.unknown().transform((value, ctx) => {
	try {
		return snapshotSessionEvent({
			type: "user/message",
			surfaceOp: "append",
			seq: SessionSeq(0),
			time: 0,
			data: value
		}).data;
	} catch (e) {
		ctx.addIssue({
			code: "custom",
			message: String(e)
		});
		return z.NEVER;
	}
});
const contentSchema = z.unknown().transform((value, ctx) => {
	const result = messageSchema.safeParse({
		id: MessageId("validation"),
		role: "user",
		source: { kind: "user" },
		content: value
	});
	if (!result.success) {
		ctx.addIssue({
			code: "custom",
			message: result.error.message
		});
		return z.NEVER;
	}
	return result.data.content;
});
const assistantSchema = z.object({
	messageId: id,
	seq: z.number().int(),
	content: contentSchema
});
const completionSchema = z.object({
	id,
	workerId: id,
	workerTurn: z.number().int(),
	turnEndSeq: z.number().int(),
	assignmentIds: z.array(id),
	outcome: z.enum([
		"completed",
		"aborted",
		"error",
		"max-tokens",
		"refusal"
	]),
	lastAssistant: assistantSchema.optional(),
	settledAt: z.number()
});
const nativeReceiptSchema = z.object({
	messageId: id,
	seq: z.number().int().nonnegative(),
	admissionSeq: z.number().int().nonnegative(),
	workerTurnEndSeq: z.number().int().nonnegative()
});
const deliverySchema = z.object({
	completionId: id,
	message: messageSchema,
	state: z.enum([
		"pending",
		"admitted",
		"consumed",
		"suppressed"
	]),
	attempts: z.number().int(),
	lastError: z.string().optional(),
	nativeReceipt: nativeReceiptSchema.optional()
});
const membershipSchema = z.object({
	projectId: id,
	coordinatorSessionId: id,
	coordinatorTurn: z.number().int(),
	segmentStartSeq: z.number().int().nonnegative().optional(),
	participationSeq: z.number().int().nonnegative().optional(),
	participationKind: z.enum([
		"spawn",
		"send",
		"result"
	]).optional(),
	completionIds: z.array(id).optional(),
	workerId: id,
	firstOperationId: id,
	firstCallId: id,
	order: z.number().int()
});
const outcomeSchema = z.object({
	coordinatorSessionId: id,
	coordinatorTurn: z.number().int(),
	segmentStartSeq: z.number().int().nonnegative().optional(),
	workerId: id,
	status: z.enum([
		"completed",
		"failed",
		"stopped",
		"deleted"
	]),
	completionIds: z.array(id),
	lastResultMessageId: id.optional(),
	lastResultSeq: z.number().int().optional(),
	summary: z.string().optional()
});
const recordSchema = z.object({
	project: moaSchema,
	workers: z.array(workerSchema),
	assignments: z.array(assignmentSchema),
	completions: z.array(completionSchema),
	deliveries: z.array(deliverySchema),
	memberships: z.array(membershipSchema),
	outcomes: z.array(outcomeSchema),
	operations: z.record(z.string(), z.json()),
	toggles: z.record(z.string(), z.number()),
	reminders: z.record(z.string(), z.boolean()).default({})
});
const domainSpec = defineDomain({
	name: "project_mode",
	version: 1,
	tables: { projects: domainTable(recordSchema) }
});
const finishedSchema = z.object({
	turn: z.number().int(),
	seq: z.number().int(),
	reason: z.enum([
		"completed",
		"aborted",
		"error",
		"max-tokens",
		"refusal"
	]),
	time: z.number(),
	messageIds: z.array(id),
	lastAssistant: assistantSchema.optional()
});
const projection = {
	key: "project-mode-results",
	stateVersion: 2,
	stateSchema: z.object({
		turn: z.number().int(),
		segmentStartSeq: z.number().int().nonnegative().default(0),
		lastSeq: z.number().int().nonnegative().default(0),
		resultAnchors: z.record(z.string(), z.object({
			coordinatorTurn: z.number().int(),
			segmentStartSeq: z.number().int().nonnegative(),
			participationSeq: z.number().int().nonnegative()
		})).default({}),
		messageIds: z.array(id),
		lastAssistant: assistantSchema.optional(),
		finished: z.array(finishedSchema),
		consumed: z.array(id)
	}),
	init: () => ({
		turn: 0,
		segmentStartSeq: 0,
		lastSeq: 0,
		resultAnchors: {},
		messageIds: [],
		finished: [],
		consumed: []
	}),
	apply(state, event) {
		switch (event.type) {
			case "turn/start": return {
				...state,
				lastSeq: event.seq,
				turn: event.data.turn,
				segmentStartSeq: event.seq,
				messageIds: [],
				lastAssistant: void 0
			};
			case "user/message": return {
				...state,
				lastSeq: event.seq,
				messageIds: [...state.messageIds, event.data.id],
				consumed: [...state.consumed, event.data.id],
				...event.data.source.kind === "user" && event.surfaceOp === "append" ? { segmentStartSeq: event.seq } : {},
				...event.data.source.kind === "project-mode-result" ? { resultAnchors: {
					...state.resultAnchors,
					[event.data.id]: {
						coordinatorTurn: state.turn,
						segmentStartSeq: state.segmentStartSeq,
						participationSeq: event.seq
					}
				} } : {}
			};
			case "assistant/message": return event.data.turn !== state.turn ? state : {
				...state,
				lastSeq: event.seq,
				lastAssistant: {
					messageId: event.data.message.id,
					seq: event.seq,
					content: event.data.message.content
				}
			};
			case "turn/end": return {
				...state,
				lastSeq: event.seq,
				finished: [...state.finished, {
					turn: event.data.turn,
					seq: event.seq,
					time: event.time,
					reason: normalizeReason(event.data.reason.kind),
					messageIds: state.messageIds,
					...state.lastAssistant ? { lastAssistant: state.lastAssistant } : {}
				}]
			};
			case "step/start":
			case "tool/call":
			case "tool/result": return {
				...state,
				lastSeq: event.seq
			};
			default: return state;
		}
	}
};
function normalizeReason(kind) {
	return kind === "completed" || kind === "max-tokens" || kind === "error" ? kind : kind === "blocked" ? "refusal" : "aborted";
}
// src/host/native.ts
async function registerProjection(ctx) {
	await ctx.sessionProjections.register(projection);
}
function projected(ctx, session) {
	const value = ctx.sessionProjections.stateOf(session, "project-mode-results");
	if (!value) throw new Error("project-mode/projection-unavailable");
	return value;
}
/** Stop only this observer's wait; shared work keeps its own lifetime. */
function waitForTurn(work, signal, disposeLate) {
	return new Promise((resolve, reject) => {
		let aborted = false;
		const cancel = () => {
			aborted = true;
			signal.removeEventListener("abort", cancel);
			reject(signal.reason ?? /* @__PURE__ */ new Error("aborted"));
		};
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
		work.then((value) => {
			signal.removeEventListener("abort", cancel);
			if (aborted) disposeLate?.(value);
			else resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", cancel);
			reject(error);
		});
	});
}
/** A backend may finish after cancellation; release its observation lease too. */
function observeForTurn(ctx, id, signal) {
	signal?.throwIfAborted();
	const work = ctx.sessionQuery.observeSession(id, { signal });
	return signal ? waitForTurn(work, signal, (value) => value[Symbol.dispose]()) : work;
}
function abortableChange(listeners, signal) {
	return new Promise((resolve, reject) => {
		const clean = () => {
			listeners.delete(changed);
			signal.removeEventListener("abort", aborted);
		};
		const changed = () => {
			clean();
			resolve();
		};
		const aborted = () => {
			clean();
			reject(signal.reason ?? /* @__PURE__ */ new Error("aborted"));
		};
		listeners.add(changed);
		signal.addEventListener("abort", aborted, { once: true });
		if (signal.aborted) aborted();
	});
}
/** ToolCallId can repeat across turns; the committed root call is the identity boundary. */
function toolOperationId(exec) {
	const agent = exec.agent;
	if (!agent) throw new Error("project-mode/not-coordinator");
	const root = exec.rootCallId ?? exec.callId;
	const event = agent.session.snapshotEvents().findLast((event) => event.type === "tool/call" && event.data.callId === root);
	if (!event) throw new Error("project-mode/missing-native-tool-call");
	return `tool:${JSON.stringify([
		agent.id,
		event.seq,
		exec.callId
	])}`;
}
/** Published rc.3 failures whose native throw sites precede inbox acceptance.
* Generic failures, cancellation and catalog/flush failures remain uncertain.
* DUPLICATE_CHILD is intentionally excluded: its reserved identity needs reconciliation.
*/
function nativeAdmissionRejection(error) {
	if (!(error instanceof SubagentError)) return;
	return (/* @__PURE__ */ new Set([
		"ACTIVATION_LIMIT_REACHED",
		"DRAINING",
		"NO_PROVIDER",
		"UNSUPPORTED_CAPABILITY",
		"UNAUTHORIZED",
		"INPUT_CLOSED",
		"NOT_CONTINUABLE",
		"NOT_RESUMABLE",
		"PERSISTENCE_UNAVAILABLE",
		"CONTINUATION_UNAVAILABLE",
		"PRESET_UNAVAILABLE",
		"MODEL_DOES_NOT_SUPPORT_IMAGES",
		"ACTIVATION_CLOSING"
	])).has(error.code) ? {
		code: error.code,
		message: error.message
	} : void 0;
}
/** Public Host resolver. The native service key is sessionController, not its Remote namespace. */
function ordinarySessionResolver(ctx) {
	return ctx.get("sessionController");
}
/** Preserve native ownership/domain failures; this never admits model input. */
async function resolveOrdinaryAgent(ctx, sessionId) {
	const resolver = ordinarySessionResolver(ctx);
	if (!resolver) return ctx.agents.get(sessionId);
	const result = await resolver.resolveAgent(sessionId);
	if ("error" in result) throw result.error;
	return result.agent;
}
// src/host/moa-memory.ts
const contextIndexTemplate = "# MoA context\n\nRead this shared index first, then open only the context files needed for the task. Coordinator and Workers maintain reusable project knowledge here. Workers contribute valuable reusable findings; the Coordinator primarily organizes, consolidates and prunes context. Keep each entry's path and short description current.\n\n## Context files\n";
const contextIndexPath = (paths) => resolve(paths.context, "context.md");
/** Backfill only a missing index through the acting Agent's native filesystem. */
async function ensureContextIndex(ctx, agent, project, signal) {
	const presets = ctx.get("agentPresets");
	const fs = presets?.serviceFor(agent, "fs") ?? agent.ctx.get("fs");
	if (!fs) throw new Error("project-mode/filesystem-unavailable");
	const cwd = project.workspacePath;
	const workspace = await fs.resolve(cwd, { signal });
	const index = await fs.resolve(contextIndexPath(project.paths), {
		cwd,
		signal
	});
	if (!fs.contains(workspace, index)) throw new Error("project-mode/path-escape");
	if (await fs.stat(index, signal)) return;
	const directory = await fs.resolve(project.paths.context, {
		cwd,
		signal
	});
	const links = (await fs.stat(directory, signal) ? await fs.listDir(directory, signal) : []).filter((e) => e.name !== "context.md" && (e.type === "file" || e.type === "directory")).map((e) => {
		const name = e.name.replace(/[\[\]\\]/g, "\\$&");
		const href = encodeURIComponent(e.name).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
		return `- [${name}${e.type === "directory" ? "/" : ""}](./${href}) — Existing context ${e.type === "directory" ? "folder" : "file"}; add a short description.\n`;
	}).join("");
	const policy = (presets?.serviceFor(agent, "sandboxPolicy") ?? agent.ctx.get("sandboxPolicy"))?.resolve({ session: agent.session });
	if (fs.sandboxMode && !policy) throw new Error("project-mode/missing-filesystem-policy");
	await fs.writeText(index, contextIndexTemplate + links, { kind: "createIfAbsent" }, signal, policy);
}
// src/host/agent-events.ts
/** Bind native lifecycle notifications in their original registration order. */
function bindAgentEvents(host, options) {
	const { outbox, workers, progress } = options;
	host.ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
		const decision = await next();
		const project = host.record(agent.id) ?? host.owner(agent.id);
		if (decision.kind !== "enter" || project?.project.mode !== "enabled" || !decision.messages.some((m) => [
			"user",
			"project-mode-assignment",
			"project-mode-result",
			"subagent-settled",
			"agent-message"
		].includes(m.source.kind))) return decision;
		const control = AbortSignal.any([signal, host.closing.signal]);
		try {
			await ensureContextIndex(host.ctx, agent, project.project, control);
		} catch (error) {
			control.throwIfAborted();
			host.ctx.logger.warn(`project-mode: context index: ${String(error)}`);
		}
		return decision;
	});
	host.ctx.on("tools/change", options.reconcileTools);
	host.ctx.on("agent/created", async ({ agent }) => {
		options.attach(agent);
		if (host.record(agent.id)) host.enqueue(() => options.recover(agent.id));
		host.notify();
	});
	host.ctx.on("agent/status", () => host.notify());
	host.ctx.on("agent/assistant-stream", ({ agent, frame }) => {
		if (!host.owner(agent.id)) return;
		if (frame.type === "start") progress.delete(agent.id);
		if (frame.type === "chunk" && frame.chunk.type === "text-delta") progress.set(agent.id, ((progress.get(agent.id) ?? "") + frame.chunk.text).slice(-host.config.progressTextMaxChars));
		host.notify();
	});
	host.ctx.on("agent/inbox/inserted", () => host.notify());
	host.ctx.on("session/event", (session, event) => {
		if (event.type === "turn/start" && host.record(session.id)?.project.mode === "enabled") host.enqueue(async () => {
			const r = host.record(session.id);
			if (r?.project.mode === "enabled" && !r.project.modeLocked) await host.update(session.id, (current) => ({
				...current,
				project: {
					...current.project,
					modeLocked: true
				}
			}));
		});
		if (host.owner(session.id) && event.type === "turn/start") progress.delete(session.id);
		if (host.owner(session.id) && event.type === "turn/end") {
			outbox.workerCuts.set(session.id, projected(host.ctx, session));
			host.enqueue(() => host.ingest(session.id));
		}
		if (host.record(session.id) && event.type === "user/message") {
			outbox.claimed.get(session.id)?.delete(event.data.id);
			host.enqueue(() => outbox.consume(session.id, event.data.id));
		}
		if (host.record(session.id) && event.type === "turn/end") {
			outbox.claimed.delete(session.id);
			host.enqueue(() => options.freezeTurn(session.id, event.data.turn, event.data.reason.kind));
		}
		host.notify();
	});
	host.ctx.on("agent/turn-stopping", async ({ agent, turn, signal }) => {
		if (host.record(agent.id)?.project.mode === "enabled") await options.guardTurn(agent, turn, signal);
	});
	host.ctx.on("agent/pre-step", ({ agent, signal }, next) => normalizeCoordinatorStep(host, options, agent, signal, next));
	host.ctx.on("agent/disposed", ({ agent }) => options.disposeAgent(agent));
}
/** Replace managed native settlements with canonical persisted MoA results. */
async function normalizeCoordinatorStep(host, options, agent, signal, next) {
	const { outbox, workers } = options;
	if (!host.record(agent.id)) return next();
	const control = AbortSignal.any([signal, host.closing.signal]);
	control.throwIfAborted();
	outbox.normalizing.add(agent.id);
	try {
		const decision = await next();
		control.throwIfAborted();
		if (decision.kind !== "enter" || !host.record(agent.id)) return decision;
		if (host.record(agent.id)?.project.mode === "enabled" && decision.messages.some((m) => m.source.kind === "user")) await options.refreshWorkersForInput(agent, decision.messages.filter((m) => m.source.kind === "user").map((m) => m.id), control);
		const claimed = outbox.claimed.get(agent.id) ?? /* @__PURE__ */ new Set();
		outbox.claimed.set(agent.id, claimed);
		for (const message of decision.messages) if (message.source.kind === "project-mode-result") claimed.add(message.id);
		const managed = decision.messages.filter((m) => {
			const source = m.source;
			return source.kind === "subagent-settled" && host.record(agent.id).workers.some((w) => w.id === source.senderSessionId);
		});
		for (const message of managed) {
			if (message.source.kind !== "subagent-settled") continue;
			for (const assignment of host.record(agent.id).assignments) {
				if (assignment.workerId !== message.source.senderSessionId) continue;
				const admission = workers.operations.get(JSON.stringify([agent.id, assignment.operationId]));
				if (admission) await waitForTurn(admission, control);
				control.throwIfAborted();
			}
		}
		for (const message of managed) {
			if (message.source.kind === "subagent-settled") await waitForTurn(host.ingest(message.source.senderSessionId), control);
			control.throwIfAborted();
		}
		control.throwIfAborted();
		const messages = decision.messages.filter((m) => !managed.includes(m));
		const r = host.record(agent.id);
		for (const d of r.deliveries) if (d.state !== "consumed" && d.state !== "suppressed" && !messages.some((m) => m.id === d.message.id)) {
			agent.inbox.remove(d.message.id);
			messages.push(freezeMessage(d.message));
			claimed.add(d.message.id);
		}
		return managed.length > 0 && messages.length === 0 ? { kind: "reject" } : {
			...decision,
			messages
		};
	} finally {
		outbox.normalizing.delete(agent.id);
	}
}
// src/host/moa-views.ts
/** Assemble a transport view from already-observed native and durable facts. */
function buildMoASnapshot({ sessionId, record: r, workers, memberIds, boundary, waiting, pendingSteerCount, streamEpoch }) {
	const turn = boundary?.lastTurn ?? 0;
	const coordinatorTurn = boundary?.openTurnStartSeq !== null && boundary !== void 0 ? {
		sessionId,
		turn,
		phase: waiting ? "waiting-workers" : "working",
		workerIds: [...new Set(r.memberships.filter((m) => m.coordinatorTurn === turn && memberIds.has(m.workerId)).map((m) => SessionId(m.workerId)))],
		unresolvedOperationIds: r.assignments.filter((a) => a.admission === "unknown" || a.admission === "prepared").map((a) => a.operationId),
		pendingAssignmentIds: r.assignments.filter((a) => a.admission !== "rejected" && !r.completions.some((c) => c.assignmentIds.includes(a.id))).map((a) => a.id),
		runningWorkerIds: workers.filter((w) => w.status === "busy").map((w) => w.workerId),
		queuedWorkerIds: workers.filter((w) => w.queueLength).map((w) => w.workerId),
		undeliveredCompletionIds: r.deliveries.filter((d) => d.state === "pending").map((d) => d.completionId),
		unconsumedCompletionIds: r.deliveries.filter((d) => d.state !== "consumed" && d.state !== "suppressed").map((d) => d.completionId),
		pendingSteerCount,
		revision: r.project.revision
	} : null;
	return {
		project: {
			...r.project,
			coordinatorSessionId: SessionId(r.project.coordinatorSessionId)
		},
		workers,
		turnMemberships: r.memberships.filter((m) => memberIds.has(m.workerId)).map((m) => ({
			...m,
			coordinatorSessionId: SessionId(m.coordinatorSessionId),
			workerId: SessionId(m.workerId)
		})),
		closedTurnOutcomes: r.outcomes.filter((o) => memberIds.has(o.workerId)).map((o) => ({
			...o,
			coordinatorSessionId: SessionId(o.coordinatorSessionId),
			workerId: SessionId(o.workerId)
		})),
		coordinatorTurn,
		streamEpoch,
		revision: r.project.revision
	};
}
// src/shared/worker-membership.ts
/** Public membership excludes removed Workers and creation-only placeholders. */
function isVisibleWorker(worker) {
	return worker.lifecycle !== "deleted" && worker.lifecycle !== "provision-failed";
}
// src/host/moa-lifecycle.ts
function hasOwnTurn(events, inheritedEventCount) {
	return events.some((event) => event.type === "turn/start" && event.seq >= inheritedEventCount);
}
/** Owns MoA identity and draft enable/disable through native Agent maintenance. */
var MoALifecycle = class {
	host;
	options;
	constructor(host, options) {
		this.host = host;
		this.options = options;
	}
	mode(sessionId) {
		const worker = this.host.owner(sessionId), r = this.host.record(sessionId), agent = this.host.ctx.agents.get(sessionId);
		const modeLocked = this.modeLocked(r, agent);
		const blocked = worker ? "worker-session" : modeLocked ? "session-mode-locked" : !agent && !ordinarySessionResolver(this.host.ctx) ? "runtime-unavailable" : agent?.status === "running" ? "agent-running" : void 0;
		return {
			sessionId,
			role: worker ? "worker" : r ? "coordinator" : "ordinary",
			enabled: r?.project.mode === "enabled",
			modeLocked,
			revision: r?.project.revision ?? 0,
			canToggle: !blocked,
			...blocked ? { toggleBlockedReason: blocked } : {},
			...r ? {
				projectId: r.project.id,
				paths: r.project.paths
			} : {},
			...worker ? {
				projectId: worker.project.id,
				coordinatorSessionId: SessionId(worker.project.coordinatorSessionId)
			} : {}
		};
	}
	modeLocked(r, agent) {
		return r?.project.mode === "enabled" && (r.project.modeLocked !== false || !!agent && hasOwnTurn(agent.session.snapshotEvents(), agent.session.inheritedEventCount));
	}
	async setEnabled(sessionId, enabled, expectedRevision, requestId) {
		if (!requestId) throw new Error("requestId required");
		const old = this.host.record(sessionId);
		if (old?.toggles[requestId] !== void 0) return this.mode(sessionId);
		if (this.host.owner(sessionId)) throw new Error("project-mode/worker-session");
		if (!enabled && this.modeLocked(old, this.host.ctx.agents.get(sessionId))) throw new Error("project-mode/session-mode-locked");
		if ((old?.project.revision ?? 0) !== expectedRevision) throw new Error("project-mode/revision-conflict");
		const agent = await resolveOrdinaryAgent(this.host.ctx, sessionId);
		if (!agent) throw new Error("project-mode/runtime-unavailable");
		if (this.host.owner(sessionId)) throw new Error("project-mode/worker-session");
		if (!enabled && this.modeLocked(this.host.record(sessionId), agent)) throw new Error("project-mode/session-mode-locked");
		if (agent.status !== "idle") throw new Error("project-mode/agent-running");
		await agent.runMaintenance(async (signal) => {
			let r = this.host.record(sessionId);
			if (!enabled && this.modeLocked(r, agent)) throw new Error("project-mode/session-mode-locked");
			if ((r?.project.revision ?? 0) !== expectedRevision) throw new Error("project-mode/revision-conflict");
			if (!enabled && r) await this.requireCanDisable(r);
			if (!r) {
				if (!enabled) return;
				r = await this.createRecord(agent, signal);
			}
			r = {
				...r,
				project: {
					...r.project,
					mode: enabled ? "enabled" : "disabled",
					modeLocked: r.project.modeLocked === true || enabled && hasOwnTurn(agent.session.snapshotEvents(), agent.session.inheritedEventCount),
					revision: r.project.revision + 1,
					updatedAt: Date.now()
				},
				toggles: {
					...r.toggles,
					[requestId]: r.project.revision + 1
				}
			};
			await this.options.put(sessionId, recordSchema.parse(r));
			this.options.attach(agent);
			if (this.host.record(agent.id)) this.host.enqueue(() => this.options.recover(agent.id));
			this.host.notify();
		});
		return this.mode(sessionId);
	}
	async requireCanDisable(r) {
		if (r.deliveries.some((d) => d.state !== "consumed" && d.state !== "suppressed")) throw new Error("project-mode/results-pending");
		if ((await Promise.all(r.workers.filter(isVisibleWorker).map((w) => this.host.view(w)))).some((v) => v.status !== "idle" || v.queueLength || v.pendingSteerCount) || r.assignments.some((a) => a.admission === "prepared" || a.admission === "unknown")) throw new Error("project-mode/workers-active");
	}
	async createRecord(agent, signal) {
		const sessionId = agent.id;
		const cwd = await this.host.ctx.workingDirectory.ensure(agent, signal), id = randomUUID(), base = this.host.config.dataDirectory;
		if (isAbsolute(base) || relative(".", base).split(/[\\/]/).includes("..")) throw new Error("project-mode/invalid-directory");
		const root = resolve(cwd, base, id), paths = {
			root,
			context: resolve(root, "context"),
			notes: resolve(root, "notes.md"),
			archived: resolve(root, "archived.md")
		};
		const presets = this.host.ctx.get("agentPresets");
		const fs = presets?.serviceFor(agent, "fs") ?? agent.ctx.get("fs");
		if (!fs) throw new Error("project-mode/filesystem-unavailable");
		const cwdTarget = await fs.resolve(cwd);
		const policy = (presets?.serviceFor(agent, "sandboxPolicy") ?? agent.ctx.get("sandboxPolicy"))?.resolve({ session: agent.session });
		if (fs.sandboxMode && !policy) throw new Error("project-mode/missing-filesystem-policy");
		for (const [path, content] of [
			[paths.notes, "# Active tasks\n"],
			[paths.archived, "# Archived tasks\n"],
			[contextIndexPath(paths), contextIndexTemplate]
		]) {
			const target = await fs.resolve(path, {
				cwd,
				signal
			});
			if (!fs.contains(cwdTarget, target)) throw new Error("project-mode/path-escape");
			if (await fs.stat(target, signal) === void 0) await fs.writeText(target, content, { kind: "createIfAbsent" }, signal, policy);
		}
		const now = Date.now();
		return {
			project: {
				version: 1,
				id,
				coordinatorSessionId: sessionId,
				workspacePath: cwd,
				paths,
				mode: "disabled",
				modeLocked: false,
				revision: 0,
				createdAt: now,
				updatedAt: now
			},
			workers: [],
			assignments: [],
			completions: [],
			deliveries: [],
			memberships: [],
			outcomes: [],
			operations: {},
			toggles: {},
			reminders: {}
		};
	}
};
// src/host/capsule-participation.ts
/** Existing tool operation identity carries the committed root call's seq. */
function nativeOperationSeq(operationId, sessionId) {
	if (!operationId.startsWith("tool:")) return void 0;
	let identity;
	try {
		identity = JSON.parse(operationId.slice(5));
	} catch {
		return;
	}
	return Array.isArray(identity) && identity[0] === sessionId && Number.isSafeInteger(identity[1]) && identity[1] >= 0 ? identity[1] : void 0;
}
/** Only accepted assignments and canonical received results establish participation. */
function participatingMemberships(record, workerId, anchor, kind, identity, completionId) {
	const existing = record.memberships.find((m) => m.workerId === workerId && m.coordinatorTurn === anchor.coordinatorTurn && m.segmentStartSeq === anchor.segmentStartSeq);
	if (existing) {
		if (!completionId || existing.completionIds?.includes(completionId)) return record.memberships;
		return record.memberships.map((m) => m === existing ? {
			...m,
			completionIds: [...m.completionIds ?? [], completionId]
		} : m);
	}
	return [...record.memberships, {
		projectId: record.project.id,
		coordinatorSessionId: record.project.coordinatorSessionId,
		...anchor,
		workerId,
		participationKind: kind,
		...completionId ? { completionIds: [completionId] } : {},
		firstOperationId: identity,
		firstCallId: identity,
		order: record.memberships.length
	}];
}
/** Repair old records only from canonical coordinator dispatch/result evidence. */
function repairCapsuleOwnership(record, events) {
	const anchors = /* @__PURE__ */ new Map();
	const closedTurns = /* @__PURE__ */ new Map();
	const results = [];
	let coordinatorTurn = 0, segmentStartSeq = 0;
	for (const event of events) {
		if (event.type === "turn/start") {
			coordinatorTurn = event.data.turn;
			segmentStartSeq = event.seq;
		}
		if (event.type === "user/message" && event.data.source.kind === "user" && event.surfaceOp === "append") segmentStartSeq = event.seq;
		const anchor = {
			coordinatorTurn,
			segmentStartSeq,
			participationSeq: event.seq
		};
		if (event.type === "tool/call") anchors.set(event.seq, anchor);
		if (event.type === "turn/end") closedTurns.set(event.data.turn, event);
		if (event.type === "user/message" && event.data.source.kind === "project-mode-result") results.push({
			workerId: event.data.source.workerId,
			completionId: event.data.source.completionId,
			anchor
		});
	}
	const assignments = record.assignments.map((assignment) => {
		if (assignment.segmentStartSeq !== void 0 || !assignment.operationId.startsWith("tool:")) return assignment;
		const seq = nativeOperationSeq(assignment.operationId, record.project.coordinatorSessionId);
		const anchor = seq === void 0 ? void 0 : anchors.get(seq);
		if (!anchor || anchor.coordinatorTurn !== assignment.coordinatorTurn) return assignment;
		return {
			...assignment,
			...anchor,
			participationKind: record.workers.some((w) => w.id === assignment.workerId && w.creationOperationId === assignment.operationId) ? "spawn" : "send"
		};
	});
	let repaired = {
		...record,
		assignments,
		memberships: record.memberships.filter((m) => m.segmentStartSeq !== void 0 || !assignments.some((a) => a.operationId === m.firstOperationId && a.segmentStartSeq !== void 0))
	};
	for (const assignment of assignments) {
		if (assignment.admission !== "accepted" || assignment.segmentStartSeq === void 0 || assignment.participationSeq === void 0) continue;
		repaired = {
			...repaired,
			memberships: participatingMemberships(repaired, assignment.workerId, {
				coordinatorTurn: assignment.coordinatorTurn,
				segmentStartSeq: assignment.segmentStartSeq,
				participationSeq: assignment.participationSeq
			}, assignment.participationKind ?? "send", assignment.operationId)
		};
	}
	for (const result of results) {
		if (!record.completions.some((c) => c.id === result.completionId && c.workerId === result.workerId)) continue;
		repaired = {
			...repaired,
			memberships: participatingMemberships(repaired, result.workerId, result.anchor, "result", `result:${result.completionId}`, result.completionId)
		};
	}
	repaired = {
		...repaired,
		outcomes: record.outcomes.flatMap((outcome) => {
			if (outcome.segmentStartSeq !== void 0) return [outcome];
			const memberships = repaired.memberships.filter((m) => m.workerId === outcome.workerId && m.coordinatorTurn === outcome.coordinatorTurn && m.segmentStartSeq !== void 0);
			return memberships.length ? memberships.map((m) => ({
				...outcome,
				segmentStartSeq: m.segmentStartSeq
			})) : [outcome];
		})
	};
	const outcomes = [...repaired.outcomes];
	for (const membership of repaired.memberships) {
		const closing = closedTurns.get(membership.coordinatorTurn);
		if (!closing || membership.segmentStartSeq === void 0 || membership.participationSeq === void 0 || membership.participationSeq > closing.seq || outcomes.some((outcome) => outcome.coordinatorTurn === membership.coordinatorTurn && outcome.workerId === membership.workerId && outcome.segmentStartSeq === membership.segmentStartSeq)) continue;
		const receipts = results.filter((result) => result.workerId === membership.workerId && result.anchor.coordinatorTurn === membership.coordinatorTurn && result.anchor.participationSeq < closing.seq);
		const receiptSeqs = new Map(receipts.map((result) => [result.completionId, result.anchor.participationSeq]));
		const segmentResultIds = new Set(receipts.filter((result) => result.anchor.segmentStartSeq === membership.segmentStartSeq).map((result) => result.completionId));
		const assignments = repaired.assignments.filter((assignment) => assignment.workerId === membership.workerId && assignment.coordinatorTurn === membership.coordinatorTurn && assignment.segmentStartSeq === membership.segmentStartSeq && assignment.admission !== "rejected" && assignment.participationSeq !== void 0 && assignment.participationSeq < closing.seq);
		const completed = repaired.completions.filter((completion) => completion.workerId === membership.workerId && receiptSeqs.has(completion.id) && (segmentResultIds.has(completion.id) || completion.assignmentIds.some((id) => assignments.some((assignment) => assignment.id === id)))).sort((a, b) => receiptSeqs.get(a.id) - receiptSeqs.get(b.id));
		const last = completed.at(-1), pending = assignments.some((assignment) => !completed.some((completion) => completion.assignmentIds.includes(assignment.id)));
		const interrupted = closing.data.reason.kind !== "completed" || pending;
		outcomes.push({
			coordinatorSessionId: membership.coordinatorSessionId,
			coordinatorTurn: membership.coordinatorTurn,
			segmentStartSeq: membership.segmentStartSeq,
			workerId: membership.workerId,
			status: interrupted ? "stopped" : last?.outcome === "completed" ? "completed" : last?.outcome === "aborted" ? "stopped" : "failed",
			completionIds: completed.map((completion) => completion.id),
			...interrupted ? { summary: "Coordinator turn interrupted; worker work may continue." } : {},
			...last?.lastAssistant ? {
				lastResultMessageId: last.lastAssistant.messageId,
				lastResultSeq: last.lastAssistant.seq
			} : {}
		});
	}
	repaired = {
		...repaired,
		outcomes
	};
	return JSON.stringify(repaired) === JSON.stringify(record) ? record : repaired;
}
// src/host/native-receipt.ts
/**
* rc.3 native notices have no child turn ID. Bind a committed notice to the
* unique last child turn finished at its ORIGINAL inbox admission, then verify
* the complete native payload. Never use consumption time or text similarity
* to select a turn; queued notices can be read after another turn finishes.
*/
function consumedNativeReceipts(completions, events) {
	const admissions = /* @__PURE__ */ new Map();
	for (const e of events) if (e.type === "agent/inbox/spliced") {
		for (const message of e.data.inserted ?? []) if (!admissions.has(message.id)) admissions.set(message.id, {
			seq: e.seq,
			time: e.time
		});
	}
	const receipts = /* @__PURE__ */ new Map();
	for (const e of events) {
		if (e.type !== "user/message" || e.surfaceOp !== "append") continue;
		const source = e.data.source;
		if (source.kind !== "subagent-settled") continue;
		const admission = admissions.get(e.data.id);
		if (!admission || admission.seq >= e.seq) continue;
		const candidates = completions.filter((c) => c.workerId === source.senderSessionId && c.settledAt <= admission.time);
		const lastTime = Math.max(...candidates.map((c) => c.settledAt));
		const latest = candidates.filter((c) => c.settledAt === lastTime);
		if (latest.length !== 1) continue;
		const completion = latest[0];
		const blocks = completion.lastAssistant?.content;
		if (!blocks?.length || blocks.some((b) => b.type !== "text" && b.type !== "reasoning")) continue;
		const closing = blocks.filter((b) => b.type === "text" && b.text.length > 0);
		if (!closing.length) continue;
		const expected = [
			{
				type: "text",
				text: `${`Background subagent ${completion.workerId}`} ${{
					completed: "finished and will do no further work unless you send it more.",
					aborted: "was stopped before it finished.",
					error: "failed before it finished.",
					"max-tokens": "ran out of room before it finished.",
					refusal: "declined the task."
				}[completion.outcome]}`
			},
			{
				type: "text",
				text: "Its closing message:"
			},
			...closing
		];
		if (!isDeepStrictEqual(e.data.content, expected)) continue;
		if (!receipts.has(completion.id)) receipts.set(completion.id, {
			messageId: e.data.id,
			seq: e.seq,
			admissionSeq: admission.seq,
			workerTurnEndSeq: completion.turnEndSeq
		});
	}
	return receipts;
}
// \0@oxc-project+runtime@0.155.0/helpers/esm/usingCtx.js
function _usingCtx() {
	var r = "function" == typeof SuppressedError ? SuppressedError : function(r, e) {
		var n = Error();
		return n.name = "SuppressedError", n.error = r, n.suppressed = e, n;
	}, e = {}, n = [];
	function using(r, e) {
		if (null != e) {
			if (Object(e) !== e) throw new TypeError("using declarations can only be used with objects, functions, null, or undefined.");
			if (r) var o = e[Symbol.asyncDispose || Symbol["for"]("Symbol.asyncDispose")];
			if (void 0 === o && (o = e[Symbol.dispose || Symbol["for"]("Symbol.dispose")], r)) var t = o;
			if ("function" != typeof o) throw new TypeError("Object is not disposable.");
			t && (o = function o() {
				try {
					t.call(e);
				} catch (r) {
					return Promise.reject(r);
				}
			}), n.push({
				v: e,
				d: o,
				a: r
			});
		} else r && n.push({
			d: e,
			a: r
		});
		return e;
	}
	return {
		e,
		u: using.bind(null, !1),
		a: using.bind(null, !0),
		d: function d() {
			var o, t = this.e, s = 0;
			function next() {
				for (; o = n.pop();) try {
					if (!o.a && 1 === s) return s = 0, n.push(o), Promise.resolve().then(next);
					if (o.d) {
						var r = o.d.call(o.v);
						if (o.a) return s |= 2, Promise.resolve(r).then(next, err);
					} else s |= 1;
				} catch (r) {
					return err(r);
				}
				if (1 === s) return t !== e ? Promise.reject(t) : Promise.resolve();
				if (t !== e) throw t;
			}
			function err(n) {
				return t = t !== e ? new r(n, t) : n, next();
			}
			return next();
		}
	};
}
// src/host/completion-outbox.ts
/** Serializes result collection and durable native inbox admission. */
var CompletionOutbox = class {
	host;
	normalizing = /* @__PURE__ */ new Set();
	workerCuts = /* @__PURE__ */ new Map();
	claimed = /* @__PURE__ */ new Map();
	ingestions = /* @__PURE__ */ new Map();
	admissions = /* @__PURE__ */ new Map();
	retries = /* @__PURE__ */ new Map();
	constructor(host) {
		this.host = host;
	}
	dispose() {
		for (const timer of this.retries.values()) clearTimeout(timer);
	}
	ingest(workerId) {
		const work = (this.ingestions.get(workerId) ?? Promise.resolve()).then(() => this.ingestCompletion(workerId)).finally(() => {
			if (this.ingestions.get(workerId) === work) this.ingestions.delete(workerId);
		});
		this.ingestions.set(workerId, work);
		return work;
	}
	async ingestCompletion(workerId) {
		let r = this.host.owner(workerId);
		if (!r) return;
		const parentId = SessionId(r.project.coordinatorSessionId), agent = this.host.ctx.agents.get(workerId);
		let state;
		if (agent) state = projected(this.host.ctx, agent.session);
		else if (this.workerCuts.has(workerId)) state = this.workerCuts.get(workerId);
		else try {
			var _usingCtx$6 = _usingCtx();
			const observed = _usingCtx$6.u(await this.host.ctx.sessionQuery.observeSession(workerId));
			state = observed.events.reduce(projection.apply, projection.init(observed.header, observed.inheritedEventCount));
		} catch (_) {
			_usingCtx$6.e = _;
		} finally {
			_usingCtx$6.d();
		}
		if (r.assignments.some((a) => a.workerId === workerId && (a.admission === "prepared" || a.admission === "unknown"))) return;
		for (const finished of state.finished) {
			const id = `${r.project.id}:${workerId}:${finished.seq}`;
			if (this.host.record(parentId).completions.some((c) => c.id === id)) continue;
			const completion = {
				id,
				workerId,
				workerTurn: finished.turn,
				turnEndSeq: finished.seq,
				assignmentIds: r.assignments.filter((a) => a.messageId && finished.messageIds.includes(a.messageId)).map((a) => a.id),
				outcome: finished.reason,
				...finished.lastAssistant ? { lastAssistant: finished.lastAssistant } : {},
				settledAt: finished.time
			};
			const message = createUserMessage({
				source: {
					kind: "project-mode-result",
					form: "relay",
					completionId: id,
					workerId,
					workerTurn: finished.turn
				},
				content: [{
					type: "text",
					text: `Worker ${this.host.worker(r, workerId).name} (${workerId}), turn ${finished.turn}, outcome ${finished.reason}. Completion ${id}. ${finished.lastAssistant ? `Final assistant ${finished.lastAssistant.messageId} at seq ${finished.lastAssistant.seq}:` : "No final assistant message in this turn."}`
				}, ...finished.lastAssistant?.content ?? []]
			});
			await this.host.update(parentId, (r) => ({
				...r,
				completions: [...r.completions, completion],
				deliveries: [...r.deliveries, {
					completionId: id,
					message,
					state: (this.host.worker(r, workerId).lifecycle === "deleting" || this.host.worker(r, workerId).lifecycle === "deleted") && completion.outcome === "aborted" ? "suppressed" : "pending",
					attempts: 0
				}]
			}));
		}
		await this.deliver(parentId);
	}
	async consume(parentId, messageId) {
		const r = this.host.record(parentId);
		if (!r || !r.deliveries.some((d) => d.message.id === messageId && d.state !== "consumed")) return;
		const agent = this.host.ctx.agents.get(parentId);
		let anchor = agent ? projected(this.host.ctx, agent.session).resultAnchors[messageId] : void 0;
		if (!anchor) try {
			var _usingCtx3 = _usingCtx();
			const observed = _usingCtx3.u(await this.host.ctx.sessionQuery.observeSession(parentId));
			anchor = observed.events.reduce(projection.apply, projection.init(observed.header, observed.inheritedEventCount)).resultAnchors[messageId];
		} catch (_) {
			_usingCtx3.e = _;
		} finally {
			_usingCtx3.d();
		}
		await this.host.update(parentId, (r) => ({
			...r,
			deliveries: r.deliveries.map((d) => d.message.id === messageId ? {
				...d,
				state: "consumed"
			} : d),
			memberships: (() => {
				const delivery = r.deliveries.find((d) => d.message.id === messageId), completion = r.completions.find((c) => c.id === delivery?.completionId);
				return anchor && completion ? participatingMemberships(r, completion.workerId, anchor, "result", `result:${completion.id}`, completion.id) : r.memberships;
			})()
		}));
	}
	deliver(parentId) {
		const work = (this.admissions.get(parentId) ?? Promise.resolve()).then(() => this.admitDeliveries(parentId)).finally(() => {
			if (this.admissions.get(parentId) === work) this.admissions.delete(parentId);
		});
		this.admissions.set(parentId, work);
		return work;
	}
	async admitDeliveries(parentId) {
		if (this.normalizing.has(parentId)) return;
		if (!this.host.record(parentId).deliveries.some((delivery) => delivery.state !== "consumed" && delivery.state !== "suppressed")) return;
		let agent = this.host.ctx.agents.get(parentId);
		const events = agent ? agent.session.snapshotEvents() : await (async () => {
			try {
				var _usingCtx4 = _usingCtx();
				return _usingCtx4.u(await this.host.ctx.sessionQuery.observeSession(parentId)).events;
			} catch (_) {
				_usingCtx4.e = _;
			} finally {
				_usingCtx4.d();
			}
		})();
		const receipts = consumedNativeReceipts(this.host.record(parentId).completions, events);
		const adopted = this.host.record(parentId).deliveries.filter((d) => d.state !== "consumed" && d.state !== "suppressed" && receipts.has(d.completionId) && !this.claimed.get(parentId)?.has(d.message.id));
		if (adopted.length) {
			await this.host.update(parentId, (r) => ({
				...r,
				deliveries: r.deliveries.map((d) => adopted.some((a) => a.message.id === d.message.id) ? {
					...d,
					state: "consumed",
					nativeReceipt: receipts.get(d.completionId),
					lastError: void 0
				} : d)
			}));
			for (const delivery of adopted) agent?.inbox.remove(delivery.message.id);
		}
		if (!this.host.record(parentId).deliveries.some((d) => d.state !== "consumed" && d.state !== "suppressed")) return;
		if (!agent) agent = await resolveOrdinaryAgent(this.host.ctx, parentId);
		if (!agent) return;
		for (const d of this.host.record(parentId).deliveries) {
			if (this.normalizing.has(parentId)) return;
			if (d.state === "consumed" || d.state === "suppressed") continue;
			if (projected(this.host.ctx, agent.session).consumed.includes(d.message.id)) {
				await this.consume(parentId, d.message.id);
				continue;
			}
			if (this.claimed.get(parentId)?.has(d.message.id)) continue;
			if ([...agent.inbox.nextStep, ...agent.inbox.nextTurn].some((m) => m.id === d.message.id)) continue;
			try {
				if (agent.status === "running") agent.steer(freezeMessage(d.message));
				else agent.followup(freezeMessage(d.message));
				await this.host.ctx.sessions.flush(agent.session);
				await this.host.update(parentId, (r) => ({
					...r,
					deliveries: r.deliveries.map((x) => x.completionId === d.completionId && x.state !== "consumed" ? {
						...x,
						state: "admitted",
						attempts: x.attempts + 1,
						lastError: void 0
					} : x)
				}));
			} catch (error) {
				await this.host.update(parentId, (r) => ({
					...r,
					deliveries: r.deliveries.map((x) => x.completionId === d.completionId ? {
						...x,
						attempts: x.attempts + 1,
						lastError: String(error)
					} : x)
				}));
				if (d.attempts < this.host.config.retryMaxAttempts && !this.host.closing.signal.aborted && !this.retries.has(parentId)) this.retries.set(parentId, setTimeout(() => {
					this.retries.delete(parentId);
					this.host.enqueue(() => this.deliver(parentId));
				}, Math.min(this.host.config.retryMaxDelayMs, this.host.config.retryInitialDelayMs * 2 ** d.attempts)));
				this.host.notify();
			}
		}
	}
};
// src/host/control.ts
const worker_id = z.string().min(1).transform(SessionId);
const historySchema = z.object({
	action: z.literal("history"),
	worker_id,
	offset: z.number().int().nonnegative(),
	limit: z.number().int().nonnegative()
});
const controlSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("spawn"),
		name: z.string().min(1),
		task: z.string().min(1),
		task_ref: z.string().optional()
	}),
	z.object({ action: z.literal("list") }),
	z.object({
		action: z.literal("send"),
		worker_id,
		message: z.string().min(1),
		delivery: z.enum(["steer", "queue"]),
		task_ref: z.string().optional()
	}),
	z.object({
		action: z.literal("get"),
		worker_id
	}),
	z.object({
		action: z.literal("interrupt"),
		worker_id
	}),
	z.object({
		action: z.literal("delete"),
		worker_id
	}),
	historySchema
]);
/** Tool definition is separate from Agent-scoped registration and suppression. */
function createWorkerControlTool(control) {
	return defineTool({
		name: "control_workers",
		description: "Delegate tasks to workers with the same native tools and skills. spawn starts independent execution; send continues it; list/get/history inspect; interrupt/delete manage lifecycle. When waiting for workers, yield your response; results resume this coordinator turn automatically.",
		parameters: {
			action: {
				type: "string",
				required: true,
				description: "Action: spawn, list, send, get, history, interrupt, delete"
			},
			name: {
				type: "string",
				description: "Worker name"
			},
			task: {
				type: "string",
				description: "Initial task"
			},
			worker_id: {
				type: "string",
				description: "Worker session id"
			},
			message: {
				type: "string",
				description: "Follow-up"
			},
			delivery: {
				type: "string",
				enum: ["steer", "queue"],
				description: "Immediate step or next turn"
			},
			offset: {
				type: "integer",
				description: "History index from newest (0 = latest visible message)"
			},
			limit: {
				type: "integer",
				description: "History window length; returns user/assistant messages newest first"
			},
			task_ref: {
				type: "string",
				description: "Task reference"
			}
		},
		output: {
			schema: { type: "string" },
			render: (_a, value) => [{
				type: "text",
				text: value
			}]
		},
		execute: async (args, exec) => {
			if (!exec.agent) throw new Error("project-mode/not-coordinator");
			return JSON.stringify(await control(exec.agent, controlSchema.parse(args), toolOperationId(exec), exec.signal));
		}
	});
}
// src/host/worker-operations.ts
/** Native worker operations with durable operation identities. */
var WorkerOperations = class {
	host;
	operations = /* @__PURE__ */ new Map();
	workerQueues = /* @__PURE__ */ new Map();
	constructor(host) {
		this.host = host;
	}
	listWorkers(agent, signal) {
		const r = this.host.requireCoordinator(agent);
		return Promise.all(r.workers.filter(isVisibleWorker).map((w) => this.host.inspect(w, signal)));
	}
	async controlForAgent(agent, request, operationId, signal) {
		const req = controlSchema.parse(request), r = this.host.requireCoordinator(agent);
		if (!operationId) throw new Error("operationId required");
		if (req.action === "list") return this.listWorkers(agent, signal);
		if (req.action === "get") {
			const worker = this.host.worker(r, req.worker_id);
			if (worker.lifecycle === "deleted") throw new Error("project-mode/worker-inactive");
			return this.host.inspect(worker, signal, true);
		}
		if (req.action === "history") return this.host.readHistory(agent.id, req.worker_id, req.offset, req.limit, signal);
		if (r.operations[operationId]) return r.operations[operationId];
		const key = JSON.stringify([agent.id, operationId]), pending = this.operations.get(key);
		if (pending) return pending;
		const work = (req.action === "spawn" ? Promise.resolve() : this.workerQueues.get(req.worker_id) ?? Promise.resolve()).catch(() => {}).then(() => this.dispatch(agent, req, operationId, AbortSignal.any([signal, this.host.closing.signal]))).finally(() => {
			this.operations.delete(key);
			if (req.action !== "spawn" && this.workerQueues.get(req.worker_id) === work) this.workerQueues.delete(req.worker_id);
			this.host.notify();
		});
		this.operations.set(key, work);
		if (req.action !== "spawn") this.workerQueues.set(req.worker_id, work);
		this.host.notify();
		return work;
	}
	async dispatch(agent, req, operationId, signal) {
		signal.throwIfAborted();
		let r = this.host.requireCoordinator(agent);
		const placement = projected(this.host.ctx, agent.session);
		const turn = this.host.ctx.sessionProjections.stateOf(agent.session, "turnBoundary").lastTurn;
		if (req.action === "interrupt" || req.action === "delete") return this.interruptOrDelete(agent, req, operationId);
		let assignment = r.assignments.find((a) => a.operationId === operationId);
		const workerId = req.action === "spawn" ? SessionId(assignment?.workerId ?? randomUUID()) : req.worker_id;
		if (req.action === "send" && this.host.worker(r, workerId).lifecycle !== "active") throw new Error("project-mode/worker-inactive");
		if (assignment) {
			if (assignment.admission === "rejected") throw new SubagentError(assignment.rejection?.message ?? "MoA operation was not admitted", assignment.rejection?.code ?? "PROJECT_OPERATION_REJECTED");
			await this.reconcileAssignment(agent, assignment.id);
			r = this.host.record(agent.id);
			assignment = r.assignments.find((a) => a.operationId === operationId);
			if (assignment.admission === "accepted") return this.acceptReceipt(agent, operationId, workerId, assignment.id, assignment.messageId, assignment.coordinatorTurn, req.action === "spawn" ? void 0 : req.delivery);
			throw new Error("project-mode/admission-uncertain: reconcile before retry");
		}
		const assignmentId = randomUUID();
		await this.prepareAssignment(agent, req, operationId, workerId, assignmentId, turn, placement);
		let accepted = false;
		try {
			const messageId = await this.admitWorkerInput(agent, req, operationId, workerId, signal);
			accepted = true;
			const receipt = await this.acceptReceipt(agent, operationId, workerId, assignmentId, messageId, turn, req.action === "spawn" ? void 0 : req.delivery);
			this.host.enqueue(() => this.host.ingest(workerId));
			return receipt;
		} catch (error) {
			const rejection = accepted ? void 0 : nativeAdmissionRejection(error);
			await this.host.update(agent.id, (r) => ({
				...r,
				workers: rejection && req.action === "spawn" ? r.workers.map((w) => w.id === workerId && w.lifecycle === "provisioning" ? {
					...w,
					lifecycle: "provision-failed"
				} : w) : r.workers,
				assignments: r.assignments.map((a) => a.id === assignmentId ? {
					...a,
					admission: rejection ? "rejected" : "unknown",
					...rejection ? { rejection } : {}
				} : a)
			}));
			throw error;
		}
	}
	/** Stop/removal is independent from assigning another turn of work. */
	async interruptOrDelete(agent, req, operationId) {
		const r = this.host.requireCoordinator(agent);
		const worker = this.host.worker(r, req.worker_id);
		if (req.action === "interrupt" && worker.lifecycle === "deleted") throw new Error("project-mode/worker-inactive");
		if (req.action === "interrupt") this.host.ctx.subagents.interrupt(req.worker_id, {
			kind: "ancestor",
			agent
		});
		else if (worker.lifecycle !== "deleted") {
			await this.host.update(agent.id, (r) => ({
				...r,
				workers: r.workers.map((w) => w.id === worker.id ? {
					...w,
					lifecycle: "deleting"
				} : w)
			}));
			await this.host.ctx.subagents.drainChildren(agent, [req.worker_id]);
			await this.host.update(agent.id, (r) => ({
				...r,
				workers: r.workers.map((w) => w.id === worker.id ? {
					...w,
					lifecycle: "deleted",
					deletedAt: Date.now()
				} : w)
			}));
		}
		const receipt = {
			operationId,
			workerId: req.worker_id,
			accepted: true,
			...req.action === "delete" ? {
				lifecycle: "deleted",
				historyRetained: true
			} : { queuedWorkPolicy: "native-preserve" }
		};
		await this.host.update(agent.id, (r) => ({
			...r,
			operations: {
				...r.operations,
				[operationId]: JSON.parse(JSON.stringify(receipt))
			}
		}));
		return receipt;
	}
	/** Record operation intent before crossing native inbox admission. */
	async prepareAssignment(agent, req, operationId, workerId, assignmentId, turn, placement) {
		await this.host.update(agent.id, (r) => ({
			...r,
			workers: req.action === "spawn" ? [...r.workers, {
				id: workerId,
				name: req.name,
				description: req.task,
				creationOperationId: operationId,
				lifecycle: "provisioning",
				createdAt: Date.now()
			}] : r.workers,
			assignments: [...r.assignments, {
				id: assignmentId,
				operationId,
				workerId,
				coordinatorTurn: turn,
				segmentStartSeq: placement.segmentStartSeq,
				participationSeq: nativeOperationSeq(operationId, agent.id) ?? placement.lastSeq,
				participationKind: req.action === "spawn" ? "spawn" : "send",
				delivery: req.action === "spawn" ? "steer" : req.delivery,
				admission: "prepared",
				...req.task_ref ? { taskRef: req.task_ref } : {}
			}]
		}));
	}
	async admitWorkerInput(agent, req, operationId, workerId, signal) {
		if (req.action === "spawn") {
			const activation = await this.host.ctx.subagents.startActivation({
				provider: "spawn",
				label: req.name,
				childId: workerId,
				delivery: "caller",
				signal,
				request: {
					parent: agent,
					prompt: [{
						type: "text",
						text: req.task
					}],
					cwd: this.host.ctx.workingDirectory.get(agent.session)
				}
			});
			activation.result.catch((error) => {
				this.host.ctx.logger.warn(`project-mode: worker ${workerId}: ${String(error)}`);
				this.host.notify();
			});
			return activation.messageId;
		} else return (req.delivery === "queue" ? queueHostSubagentPrompt : steerHostSubagentPrompt)(this.host.ctx.subagents, agent, workerId, [{
			type: "text",
			text: req.message
		}], {
			kind: "project-mode-assignment",
			form: "relay",
			operationId,
			coordinatorSessionId: agent.id
		}, signal);
	}
	async acceptReceipt(agent, operationId, workerId, assignmentId, messageId, turn, delivery) {
		const receipt = {
			operationId,
			workerId,
			assignmentId,
			messageId,
			coordinatorTurn: turn,
			accepted: true,
			...delivery ? { delivery } : {}
		};
		await this.host.update(agent.id, (r) => ({
			...r,
			workers: r.workers.map((w) => w.id === workerId ? {
				...w,
				lifecycle: "active"
			} : w),
			assignments: r.assignments.map((a) => a.id === assignmentId ? {
				...a,
				messageId,
				admission: "accepted"
			} : a),
			operations: {
				...r.operations,
				[operationId]: JSON.parse(JSON.stringify(receipt))
			},
			memberships: participatingMemberships(r, workerId, {
				coordinatorTurn: turn,
				segmentStartSeq: r.assignments.find((a) => a.id === assignmentId)?.segmentStartSeq ?? 0,
				participationSeq: r.assignments.find((a) => a.id === assignmentId)?.participationSeq ?? 0
			}, r.assignments.find((a) => a.id === assignmentId)?.participationKind ?? "send", operationId)
		}));
		return receipt;
	}
	async reconcileAssignment(agent, assignmentId) {
		try {
			var _usingCtx$5 = _usingCtx();
			const r = this.host.record(agent.id), assignment = r.assignments.find((a) => a.id === assignmentId);
			if (assignment.admission === "accepted") return;
			if (!(await this.host.ctx.subagents.listChildren(agent.id)).some((c) => c.id === assignment.workerId)) return;
			const observed = _usingCtx$5.u(await this.host.ctx.sessionQuery.observeSession(SessionId(assignment.workerId)));
			const first = r.workers.find((w) => w.id === assignment.workerId)?.creationOperationId === assignment.operationId;
			const message = observed.events.find((e) => e.type === "user/message" && (first || e.data.source.kind === "project-mode-assignment" && e.data.source.operationId === assignment.operationId));
			const inbox = observed.projections?.values.inbox;
			const pending = [...inbox?.["next-step"] ?? [], ...inbox?.["next-turn"] ?? []].map((m) => messageSchema.parse(m)).find((m) => first || m.source.kind === "project-mode-assignment" && m.source.operationId === assignment.operationId);
			const id = message?.type === "user/message" ? message.data.id : pending?.id;
			if (id) await this.acceptReceipt(agent, assignment.operationId, SessionId(assignment.workerId), assignment.id, id, assignment.coordinatorTurn, assignment.delivery);
		} catch (_) {
			_usingCtx$5.e = _;
		} finally {
			_usingCtx$5.d();
		}
	}
};
// src/host/turn-coordination.ts
/** Event-driven native turn closure. No worker lock is held while waiting. */
var TurnCoordination = class {
	host;
	waiting = /* @__PURE__ */ new Set();
	constructor(host) {
		this.host = host;
	}
	async guardTurn(agent, turn, signal) {
		const lifetime = AbortSignal.any([signal, this.host.closing.signal]);
		const inputReady = new AbortController();
		const control = AbortSignal.any([lifetime, inputReady.signal]);
		const wakeForInput = () => {
			if (agent.inbox.nextStep.length) inputReady.abort();
		};
		this.host.listeners.add(wakeForInput);
		this.waiting.add(agent.id);
		try {
			wakeForInput();
			for (;;) {
				control.throwIfAborted();
				const iteration = new AbortController();
				const change = abortableChange(this.host.listeners, AbortSignal.any([control, iteration.signal]));
				try {
					change.catch(() => {});
					await waitForTurn(this.host.settledJobs(), control);
					control.throwIfAborted();
					if (agent.inbox.nextStep.length) return;
					const r = this.host.record(agent.id), views = await waitForTurn(Promise.all(r.workers.filter((w) => w.lifecycle !== "deleted" && w.lifecycle !== "provision-failed").map((w) => this.host.view(w, control))), control);
					control.throwIfAborted();
					if (this.host.record(agent.id).project.revision !== r.project.revision) continue;
					if (views.some((v) => v.status === null)) throw new Error("project-mode/worker-activity-unavailable");
					const pending = r.assignments.filter((a) => a.admission !== "rejected" && !r.completions.some((c) => c.assignmentIds.includes(a.id)) && r.workers.some((w) => w.id === a.workerId && w.lifecycle !== "deleted"));
					const uncertain = r.assignments.find((a) => a.admission === "unknown");
					if (uncertain) throw new Error(`project-mode/admission-uncertain: ${uncertain.operationId}`);
					const failed = r.deliveries.find((d) => d.lastError && d.attempts > this.host.config.retryMaxAttempts);
					if (failed) throw new Error(`project-mode/result-admission-failed: ${failed.completionId}: ${failed.lastError}`);
					const results = r.deliveries.filter((d) => d.state !== "consumed" && d.state !== "suppressed");
					if (!pending.length && !results.length && !views.some((v) => v.status === "busy" || v.queueLength || v.pendingSteerCount) && !this.host.pendingOperations(agent.id)) return;
					const parked = views.find((v) => v.status === "idle" && (v.queueLength || v.pendingSteerCount));
					if (parked) {
						const worker = this.host.ctx.agents.get(parked.workerId);
						let ids;
						if (worker) ids = [...worker.inbox.nextStep, ...worker.inbox.nextTurn].map((m) => m.id);
						else try {
							var _usingCtx$4 = _usingCtx();
							const inbox = _usingCtx$4.u(await observeForTurn(this.host.ctx, parked.workerId, control)).projections?.values.inbox;
							if (!inbox) throw new Error("project-mode/worker-activity-unavailable");
							ids = [...inbox["next-step"], ...inbox["next-turn"]].map((m) => messageSchema.parse(m).id);
						} catch (_) {
							_usingCtx$4.e = _;
						} finally {
							_usingCtx$4.d();
						}
						control.throwIfAborted();
						const identity = JSON.stringify([parked.workerId, ...ids]);
						if (r.reminders[identity]) throw new Error(`project-mode/parked-worker-input: ${parked.workerId}; continue, delete, or ask the user`);
						await waitForTurn(this.host.update(agent.id, (record) => {
							control.throwIfAborted();
							return {
								...record,
								reminders: {
									...record.reminders,
									[identity]: true
								}
							};
						}), control);
						control.throwIfAborted();
						agent.steer(createUserMessage({
							source: {
								kind: "project-mode-notice",
								form: "notice",
								summary: "parked worker input"
							},
							content: [{
								type: "text",
								text: `MoA has parked worker input: ${parked.name} (${parked.workerId}) is stopped with ${ids.length} pending inputs. Continue the worker, delete it, or ask the user how to proceed.`
							}]
						}));
						return;
					}
					await change;
				} finally {
					iteration.abort();
				}
			}
		} catch (error) {
			lifetime.throwIfAborted();
			if (inputReady.signal.aborted && error === inputReady.signal.reason) return;
			throw error;
		} finally {
			this.host.listeners.delete(wakeForInput);
			this.waiting.delete(agent.id);
		}
	}
	async freezeTurn(parentId, turn, parentReason) {
		await this.host.update(parentId, (r) => ({
			...r,
			outcomes: [...r.outcomes, ...r.memberships.filter((m) => m.coordinatorTurn === turn && !r.outcomes.some((o) => o.coordinatorTurn === turn && o.workerId === m.workerId && o.segmentStartSeq === m.segmentStartSeq)).map((m) => {
				const worker = this.host.worker(r, SessionId(m.workerId)), completed = r.completions.filter((c) => c.workerId === m.workerId && (m.completionIds?.includes(c.id) || c.assignmentIds.some((id) => r.assignments.some((a) => a.id === id && a.coordinatorTurn === turn && a.segmentStartSeq === m.segmentStartSeq)))), last = completed.at(-1);
				const pending = r.assignments.some((a) => a.workerId === m.workerId && a.coordinatorTurn === turn && a.segmentStartSeq === m.segmentStartSeq && a.admission !== "rejected" && !completed.some((c) => c.assignmentIds.includes(a.id)));
				const interrupted = parentReason !== "completed" || pending;
				return {
					coordinatorSessionId: parentId,
					coordinatorTurn: turn,
					...m.segmentStartSeq === void 0 ? {} : { segmentStartSeq: m.segmentStartSeq },
					workerId: m.workerId,
					status: worker.lifecycle === "deleted" ? "deleted" : interrupted ? "stopped" : last?.outcome === "completed" ? "completed" : last?.outcome === "aborted" ? "stopped" : "failed",
					completionIds: completed.map((c) => c.id),
					...interrupted ? { summary: "Coordinator turn interrupted; worker work may continue." } : {},
					...last?.lastAssistant ? {
						lastResultMessageId: last.lastAssistant.messageId,
						lastResultSeq: last.lastAssistant.seq
					} : {}
				};
			})]
		}));
	}
};
// src/host/history.ts
/** A relative window over committed dialogue, indexed from its newest message. */
async function readHistory(host, parentId, workerId, offset, limit, signal) {
	try {
		var _usingCtx$3 = _usingCtx();
		const r = host.record(parentId);
		if (!r) throw new Error("project-mode/not-found");
		const worker = host.worker(r, workerId);
		if (worker.lifecycle === "deleted") throw new Error("project-mode/worker-inactive");
		const observed = _usingCtx$3.u(await host.ctx.sessionQuery.observeSession(workerId, { signal }));
		let turn = 0;
		const messages = [];
		for (const event of observed.events) {
			if (event.type === "turn/start") turn = event.data.turn;
			if (event.seq < observed.inheritedEventCount) continue;
			const message = event.type === "assistant/message" ? event.data.message : event.type === "user/message" && (event.data.source.kind === "user" || event.data.source.kind === "project-mode-assignment") ? event.data : void 0;
			if (!message) continue;
			const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
			if (message.role === "assistant" && !text) continue;
			messages.push({
				id: message.id,
				seq: event.seq,
				turn,
				role: message.role === "assistant" ? "assistant" : "user",
				text
			});
		}
		return {
			workerId,
			status: (await host.view(worker, signal)).status,
			offset,
			limit,
			total: messages.length,
			messages: messages.reverse().slice(offset, offset + limit).map((message, i) => ({
				...message,
				index: offset + i
			})),
			observedThroughSeq: observed.cursor
		};
	} catch (_) {
		_usingCtx$3.e = _;
	} finally {
		_usingCtx$3.d();
	}
}
// src/host/worker-timeline.ts
async function readWorkerTimeline(host, parentId, workerId, limit, signal) {
	try {
		var _usingCtx$2 = _usingCtx();
		const record = host.record(parentId);
		if (!record) throw new Error("project-mode/not-found");
		const worker = host.worker(record, workerId);
		if (worker.lifecycle === "deleted") throw new Error("project-mode/worker-inactive");
		const observed = _usingCtx$2.u(await host.ctx.sessionQuery.observeSession(workerId, { signal }));
		const assignments = new Set(record.assignments.filter((a) => a.workerId === workerId).map((a) => a.messageId));
		const turns = [];
		let current;
		for (const event of observed.events) {
			if (event.seq < observed.inheritedEventCount) continue;
			if (event.type === "turn/start") {
				current = {
					turn: event.data.turn,
					startedAt: event.time,
					outcome: null,
					inputs: [],
					outputs: [],
					artifacts: []
				};
				turns.push(current);
			}
			if (!current) continue;
			if (event.type === "turn/end" && event.data.turn === current.turn) {
				current.outcome = event.data.reason.kind;
				current.finishedAt = event.time;
			}
			if (event.type === "user/message" && (event.data.source.kind === "user" || event.data.source.kind === "project-mode-assignment")) current.inputs.push({
				id: event.data.id,
				seq: event.seq,
				time: event.time,
				text: event.data.content.filter((b) => b.type === "text").map((b) => b.text).join(""),
				actor: assignments.has(event.data.id) || event.data.source.kind === "project-mode-assignment" ? "coordinator" : "user"
			});
			if (event.type === "assistant/message" && event.data.turn === current.turn) {
				const text = event.data.message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
				current.outputs = text ? [{
					id: event.data.message.id,
					seq: event.seq,
					time: event.time,
					text
				}] : [];
			}
			if (event.type === "deliverables/presented" && event.data.turn === current.turn) for (const file of event.data.files) current.artifacts.push({
				...file,
				kind: "presented",
				seq: event.seq,
				time: event.time
			});
			if (event.type === "tool/result" && !event.data.message.isError && event.data.turn === current.turn) {
				const meta = event.data.meta;
				if (meta && typeof meta === "object" && !Array.isArray(meta) && Array.isArray(meta.diffs)) {
					const paths = /* @__PURE__ */ new Set();
					if (typeof meta.path === "string") paths.add(meta.path);
					for (const diff of meta.diffs) if (diff && typeof diff === "object" && !Array.isArray(diff) && typeof diff.path === "string") paths.add(diff.path);
					for (const path of paths) current.artifacts.push({
						path,
						kind: "changed",
						seq: event.seq,
						time: event.time
					});
				}
			}
		}
		for (const turn of turns) {
			if (turn.outcome === null) turn.outputs = [];
			const files = /* @__PURE__ */ new Map();
			for (const artifact of turn.artifacts) {
				const previous = files.get(artifact.path);
				if (!previous || previous.kind !== "presented") files.set(artifact.path, artifact);
			}
			turn.artifacts = [...files.values()];
		}
		return {
			workerId,
			cwd: observed.header.cwd,
			status: (await host.view(worker, signal)).status,
			total: turns.length,
			hasMore: turns.length > limit,
			observedThroughSeq: observed.cursor,
			turns: turns.reverse().slice(0, limit)
		};
	} catch (_) {
		_usingCtx$2.e = _;
	} finally {
		_usingCtx$2.d();
	}
}
/** A UI-only native-event subscription. It never resumes or prompts an Agent. */
async function* followWorkerTimeline(host, parentId, workerId, limit, signal) {
	const control = AbortSignal.any([signal, host.closing.signal]);
	const listeners = /* @__PURE__ */ new Set();
	const off = host.ctx.on("session/event", (session) => {
		if (session.id === workerId) for (const changed of listeners) changed();
	});
	try {
		while (!control.aborted) {
			const iteration = new AbortController();
			const next = abortableChange(listeners, AbortSignal.any([control, iteration.signal]));
			next.catch(() => {});
			try {
				yield await readWorkerTimeline(host, parentId, workerId, limit, control);
				await next;
			} catch (error) {
				if (control.aborted) return;
				throw error;
			} finally {
				iteration.abort();
			}
		}
	} finally {
		off();
	}
}
// src/host/moa-archive.ts
/** Mirror MoA archival through the native registry, including native Undo. */
function bindMoAArchives(ctx, domain, update) {
	return ctx.inject(["workspaceRegistry"], (ctx) => {
		const registry = ctx.workspaceRegistry;
		let archived = new Set(registry.archivedSessionIds);
		let stopped = false;
		let scheduled = false;
		let tail = Promise.resolve();
		const mark = (parent, child, value) => update(parent, (record) => ({
			...record,
			workers: record.workers.map((worker) => worker.id === child ? {
				...worker,
				archivedByCoordinator: value || void 0
			} : worker)
		}));
		const reconcile = async () => {
			for (const [id, record] of domain.table("projects").entries()) {
				const parent = SessionId(id);
				for (const worker of record.workers) {
					if (stopped) return;
					const child = SessionId(worker.id);
					try {
						if (archived.has(parent)) {
							if (archived.has(child)) continue;
							if (!worker.archivedByCoordinator) await mark(parent, child, true);
							if (!stopped && archived.has(parent)) await registry.archiveSession(child, { stopActivity: true });
						} else if (worker.archivedByCoordinator) {
							if (archived.has(child)) await registry.unarchiveSession(child);
							if (!stopped && !archived.has(parent)) await mark(parent, child, false);
						}
					} catch (error) {
						ctx.logger.warn(`project-mode: archive sync ${parent}/${child}: ${String(error)}`);
					}
				}
			}
		};
		const schedule = () => {
			if (stopped || scheduled) return;
			scheduled = true;
			tail = tail.then(async () => {
				scheduled = false;
				if (!stopped) await reconcile();
			});
		};
		ctx.on("domain/changed", (change) => {
			if (change.domain === "workspace" && change.table === "" && change.operation === "put") {
				archived = new Set(change.value.archivedSessionIds);
				schedule();
			} else if (change.domain === domainSpec.name && change.table === "projects") schedule();
		});
		ctx.effect(() => async () => {
			stopped = true;
			await tail;
		});
		schedule();
	});
}
// src/host/config.ts
const Config = z$1.object({
	dataDirectory: z$1.string().default(".dsh/project-mode"),
	coordinatorHiddenTools: z$1.array(z$1.string()).default([
		"subagent",
		"subagent_fork",
		"list_agents",
		"send_message",
		"interrupt_agent",
		"list_subagent_models",
		"workflow"
	]),
	progressTextMaxChars: z$1.number().min(1).default(100),
	retryInitialDelayMs: z$1.number().min(10).default(1e3),
	retryMaxDelayMs: z$1.number().min(10).default(3e4),
	retryMaxAttempts: z$1.number().min(0).step(1).default(5)
});
// src/host/coordinator-prompt.ts
/** Shared by the actual system message and the required preset fallback. */
const coordinatorPrompt = `You are the MoA coordinator for this persistent team of workers. Your goal is to keep the project moving by managing workers, maintaining project memory, making coordination decisions and communicating with the user in their language.

You carry the coordination work a human would otherwise do: understand the goal, choose who should work on it, supply relevant context, guide ongoing work, review results and decide what happens next. Delegate substantive investigation and execution as whole tasks. Clarification, coordination, synthesis, project records and simple self-contained actions are your own work. Judge ownership for the whole task, even when its steps are simple. If an initial check develops into an investigation, hand off the findings and remaining goal.

MoA memory
- You maintain notes.md: goals, todos, assignments, progress, blockers and next actions. Keep it useful for understanding where the project stands.
- You maintain archived.md: completed or concluded work, results, evidence and remaining follow-up. Save results there before removing active notes entries.
- context/context.md is the shared index of reusable project knowledge, with file paths and short descriptions. Read it first, then open relevant files on demand.
- You and workers maintain the context files and shared index together. Workers contribute valuable, reusable findings. You primarily organize and consolidate knowledge, remove outdated or duplicate material, and keep the index navigable. Keep routine task progress in the work records.

Usual coordination flow
1. At each new user message, first call control_workers list. Users can operate workers directly, so check current state and latest user input before relying on earlier assignments. Use get for details and history with the offset and length you need.
2. Orient yourself using the work records and context index. Choose an existing worker when its context fits, or spawn a new worker for a separate responsibility. Give it a complete goal, relevant context references, constraints and the expected result. Dispatch before doing the assigned investigation yourself, then update notes.md.
3. Decide whether a new instruction belongs in current work or a later turn. Use send with delivery steer to guide current work at the next safe step; use delivery queue for work after the current turn. Use interrupt to stop execution, and delete to remove a worker from the team. These are separate coordination decisions.
4. Keep the user informed and yield when waiting. Each worker turn\'s complete last AI message returns automatically and resumes coordination; there is no need to poll for completion. You can handle new user input and adjust assignments while workers run.
5. Review results against the goal and evidence. Follow up with the same worker on specific gaps, create another worker for a different responsibility, or ask the user for a decision when needed. Review returned evidence rather than repeating the whole investigation.
6. Update notes.md and archived.md, curate reusable context, and report outcomes and limitations. Finish after relevant results have been received and reviewed and no further coordination is needed.

Use control_workers for worker management. Preserve native DSH permissions, approvals, stopping and message-delivery behavior. Exact project paths are supplied below.`;
// src/host/worker-prompt.ts
/** Shared worker responsibilities; native DSH still owns execution. */
const workerPrompt = `You are a MoA worker. Complete your assigned responsibility and give the coordinator a result it can use to decide the next step.

Read context.md, the shared index, first; then open only context files relevant to the assignment. Work from the current goal, constraints and latest instructions. Users can also guide your conversation directly.

Carry the assigned investigation or execution through to a result. Use the native tools and skills available to you, and report concrete blockers or decisions you need. Steer guides ongoing work at a safe step; queued input belongs to a subsequent turn. Follow DSH's permissions and approvals.

You and the coordinator maintain shared context together. Contribute valuable findings reusable in future work to the relevant context files, then update the shared index with paths and short descriptions. The coordinator primarily organizes, consolidates and prunes context. It maintains notes.md and archived.md as the project's work records.

End with a self-contained AI message describing what you did, the result and evidence, changed files or artifacts, reusable context added, and remaining issues. This turn's complete last AI message is returned to the coordinator automatically. The coordinator reviews it and decides whether to continue, reassign or conclude. Your coordinator and exact project paths are supplied below.`;
// src/host/worker-activity.ts
/** Read native committed messages and the native Inbox; no shadow task queue. */
async function readWorkerActivity(host, workerId, signal, previewChars = host.config.progressTextMaxChars) {
	try {
		var _usingCtx$1 = _usingCtx();
		signal?.throwIfAborted();
		const coordinatorInputs = new Set(host.owner(workerId)?.assignments.filter((a) => a.workerId === workerId).flatMap((a) => a.messageId ? [a.messageId] : []));
		const agent = host.ctx.agents.get(workerId);
		if (agent) return summarize(agent.session.snapshotEvents(), agent.session.inheritedEventCount, agent.inbox.nextStep, agent.inbox.nextTurn, coordinatorInputs, previewChars);
		const observed = _usingCtx$1.u(await observeForTurn(host.ctx, workerId, signal));
		const inbox = observed.projections?.values.inbox;
		if (!inbox) throw new Error("project-mode/worker-inbox-unavailable");
		return summarize(observed.events, observed.inheritedEventCount, inbox["next-step"].map((value) => messageSchema.parse(value)), inbox["next-turn"].map((value) => messageSchema.parse(value)), coordinatorInputs, previewChars);
	} catch (_) {
		_usingCtx$1.e = _;
	} finally {
		_usingCtx$1.d();
	}
}
function summarize(events, inherited, nextStep, nextTurn, coordinatorInputs, previewChars) {
	const admissions = /* @__PURE__ */ new Map();
	const committed = [];
	const actor = (message) => {
		if (coordinatorInputs.has(message.id) || message.source.kind === "project-mode-assignment") return "coordinator";
		if (message.source.kind === "user") return "user";
		if ("form" in message.source && message.source.form === "relay") return "other";
	};
	const input = (message, state, position) => {
		const by = actor(message);
		if (!by) return;
		const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
		return {
			messageId: message.id,
			actor: by,
			text: text.slice(0, previewChars),
			truncated: text.length > previewChars,
			state,
			...position
		};
	};
	for (const event of events) {
		if (event.seq < inherited) continue;
		if (event.type === "agent/inbox/spliced") for (const message of event.data.inserted) admissions.set(message.id, {
			seq: event.seq,
			time: event.time
		});
		if (event.type === "user/message") {
			const value = input(event.data, "committed", admissions.get(event.data.id) ?? {
				seq: event.seq,
				time: event.time
			});
			if (value) committed.push(value);
		}
	}
	const pending = [];
	for (const [messages, state] of [[nextStep, "pending-steer"], [nextTurn, "pending-queue"]]) for (const message of messages) {
		const position = admissions.get(message.id);
		if (!position) throw new Error("project-mode/worker-admission-unavailable");
		const value = input(message, state, position);
		if (value?.actor === "user") pending.push(value);
	}
	pending.sort((a, b) => a.seq - b.seq);
	const users = [...committed.filter((m) => m.actor === "user"), ...pending].sort((a, b) => a.seq - b.seq);
	return {
		observedThroughSeq: events.at(-1)?.seq ?? -1,
		...committed.length ? { latestInput: committed.at(-1) } : {},
		...users.length ? { lastUserInput: users.at(-1) } : {},
		pendingUserInputs: pending.slice(-3),
		pendingUserInputCount: pending.length
	};
}
// src/host/index.ts
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
var __addDisposableResource = function(env, value, async) {
	if (value !== null && value !== void 0) {
		if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
		var dispose, inner;
		if (async) {
			if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
			dispose = value[Symbol.asyncDispose];
		}
		if (dispose === void 0) {
			if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
			dispose = value[Symbol.dispose];
			if (async) inner = dispose;
		}
		if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
		if (inner) dispose = function() {
			try {
				inner.call(this);
			} catch (e) {
				return Promise.reject(e);
			}
		};
		env.stack.push({
			value,
			dispose,
			async
		});
	} else if (async) env.stack.push({ async: true });
	return value;
};
var __disposeResources = (function(SuppressedError) {
	return function(env) {
		function fail(e) {
			env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
			env.hasError = true;
		}
		var r, s = 0;
		function next() {
			while (r = env.stack.pop()) try {
				if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
				if (r.dispose) {
					var result = r.dispose.call(r.value);
					if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) {
						fail(e);
						return next();
					});
				} else s |= 1;
			} catch (e) {
				fail(e);
			}
			if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
			if (env.hasError) throw env.error;
		}
		return next();
	};
})(typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
	var e = new Error(message);
	return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
let MoAPlugin = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _snapshot_decorators;
	let _follow_decorators;
	let _catalog_decorators;
	let _control_decorators;
	let _history_decorators;
	let _timeline_decorators;
	let _mode_decorators;
	let _setEnabled_decorators;
	return class MoAPlugin extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_snapshot_decorators = [Remote("snapshot")];
			_follow_decorators = [Remote({
				name: "follow",
				mode: "stream"
			})];
			_catalog_decorators = [Remote("catalog")];
			_control_decorators = [Remote("control")];
			_history_decorators = [Remote("history")];
			_timeline_decorators = [Remote({
				name: "timeline",
				mode: "stream"
			})];
			_mode_decorators = [Remote("mode")];
			_setEnabled_decorators = [Remote("setEnabled")];
			__esDecorate(this, null, _snapshot_decorators, {
				kind: "method",
				name: "snapshot",
				static: false,
				private: false,
				access: {
					has: (obj) => "snapshot" in obj,
					get: (obj) => obj.snapshot
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _follow_decorators, {
				kind: "method",
				name: "follow",
				static: false,
				private: false,
				access: {
					has: (obj) => "follow" in obj,
					get: (obj) => obj.follow
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _catalog_decorators, {
				kind: "method",
				name: "catalog",
				static: false,
				private: false,
				access: {
					has: (obj) => "catalog" in obj,
					get: (obj) => obj.catalog
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _control_decorators, {
				kind: "method",
				name: "control",
				static: false,
				private: false,
				access: {
					has: (obj) => "control" in obj,
					get: (obj) => obj.control
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _history_decorators, {
				kind: "method",
				name: "history",
				static: false,
				private: false,
				access: {
					has: (obj) => "history" in obj,
					get: (obj) => obj.history
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _timeline_decorators, {
				kind: "method",
				name: "timeline",
				static: false,
				private: false,
				access: {
					has: (obj) => "timeline" in obj,
					get: (obj) => obj.timeline
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _mode_decorators, {
				kind: "method",
				name: "mode",
				static: false,
				private: false,
				access: {
					has: (obj) => "mode" in obj,
					get: (obj) => obj.mode
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _setEnabled_decorators, {
				kind: "method",
				name: "setEnabled",
				static: false,
				private: false,
				access: {
					has: (obj) => "setEnabled" in obj,
					get: (obj) => obj.setEnabled
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		config = __runInitializers(this, _instanceExtraInitializers);
		static Config = Config;
		static inject = [
			"agents",
			"tools",
			"systemPrompt",
			"sessionProjections",
			"sessions",
			"subagents",
			"sessionQuery",
			"storage",
			"storageDomain",
			"workingDirectory",
			"fs"
		];
		domain;
		outbox;
		workers;
		turns;
		lifecycle;
		get access() {
			return {
				ctx: this.ctx,
				config: this.config,
				closing: this.closing,
				listeners: this.listeners,
				record: (id) => this.record(id),
				owner: (id) => this.owner(id),
				worker: (r, id) => this.worker(r, id),
				update: (id, fn) => this.update(id, fn),
				requireCoordinator: (agent) => this.requireCoordinator(agent),
				view: (worker, signal) => this.view(worker, signal),
				inspect: (worker, signal, details) => this.inspect(worker, signal, details),
				readHistory: (...args) => this.readHistory(...args),
				enqueue: (work) => this.enqueue(work),
				notify: () => this.notify(),
				ingest: (id) => this.ingest(id),
				settledJobs: () => this.jobs,
				pendingOperations: (id) => [...this.workers.operations.keys()].filter((key) => JSON.parse(key)[0] === id).length
			};
		}
		mounted = /* @__PURE__ */ new Map();
		reconcilingTools = false;
		toolsChangedDuringReconciliation = false;
		controlTool;
		jobs = Promise.resolve();
		listeners = /* @__PURE__ */ new Set();
		progress = /* @__PURE__ */ new Map();
		workerInputSnapshots = /* @__PURE__ */ new Map();
		epoch = randomUUID();
		available = false;
		closing = new AbortController();
		constructor(ctx, config) {
			super(ctx, "projectMode");
			this.config = config;
		}
		async [Service.init]() {
			if (typeof this.ctx.tools.suppress !== "function") throw new Error("project-mode/native-compatibility-required: install the rc.3 MoA Mode tool-suppression compatibility patch");
			this.domain = await this.ctx.storage.domain.open(domainSpec);
			const archives = bindMoAArchives(this.ctx, this.domain, (id, fn) => this.update(id, fn));
			this.outbox = new CompletionOutbox(this.access);
			this.workers = new WorkerOperations(this.access);
			this.turns = new TurnCoordination(this.access);
			this.lifecycle = new MoALifecycle(this.access, {
				put: (id, record) => this.domain.table("projects").put(id, record),
				attach: (agent) => this.attach(agent),
				recover: (id) => this.recover(id)
			});
			await registerProjection(this.ctx);
			const hiddenToolSections = new Set(this.config.coordinatorHiddenTools.map((name) => `tool:${name}`));
			this.ctx.on("system-prompt/assemble", async (_assembly, { agent }, next) => {
				const prompt = await next();
				if (!agent || this.record(agent.id)?.project.mode !== "enabled") return prompt;
				return {
					...prompt,
					sections: prompt.sections.filter((s) => !hiddenToolSections.has(s.name))
				};
			});
			this.ctx.systemPrompt.context({
				name: "project-mode:role",
				order: 650,
				required: true,
				interpolate: false,
				text: ({ agent }) => agent ? this.roleText(agent) : ""
			});
			this.ctx.systemPrompt.context({
				name: "project-mode:worker-state",
				order: 660,
				required: true,
				interpolate: false,
				text: ({ agent }) => agent && this.record(agent.id)?.project.mode === "enabled" ? this.workerInputSnapshots.get(agent.id) ?? "" : ""
			});
			this.ctx.systemPrompt.section({
				name: "project-mode:coordination",
				order: 11e3,
				interpolate: false,
				text: ({ agent }) => agent && this.record(agent.id)?.project.mode === "enabled" ? coordinatorPrompt : ""
			});
			this.controlTool = createWorkerControlTool((...args) => this.controlForAgent(...args));
			bindAgentEvents(this.access, {
				outbox: this.outbox,
				workers: this.workers,
				progress: this.progress,
				reconcileTools: () => this.reconcileTools(),
				attach: (agent) => this.attach(agent),
				disposeAgent: (agent) => {
					this.workerInputSnapshots.delete(agent.id);
					this.mounted.get(agent)?.dispose();
					this.mounted.delete(agent);
				},
				recover: (id) => this.recover(id),
				guardTurn: (agent, turn, signal) => this.guardTurn(agent, turn, signal),
				freezeTurn: (id, turn, reason) => this.freezeTurn(id, turn, reason),
				refreshWorkersForInput: (agent, ids, signal) => this.refreshWorkersForInput(agent, ids, signal)
			});
			this.ctx.effect(() => async () => {
				this.available = false;
				this.closing.abort();
				this.notify();
				this.outbox.dispose();
				await Promise.allSettled([...this.workers.operations.values()]);
				await Promise.all(this.ctx.agents.list().map(async (parent) => {
					const record = this.record(parent.id);
					if (record) await this.ctx.subagents.drainChildren(parent, record.workers.map((worker) => SessionId(worker.id)));
				}));
				await this.jobs;
				for (const value of this.mounted.values()) value.dispose();
				this.mounted.clear();
				await archives.dispose();
				await this.domain.close();
			}, "project-mode.lifecycle");
			this.available = true;
			for (const agent of this.ctx.agents.list()) this.attach(agent);
			for (const [id] of this.domain.table("projects").entries()) this.enqueue(() => this.recover(SessionId(id)));
		}
		async recover(parentId) {
			{
				const env_1 = {
					stack: [],
					error: void 0,
					hasError: false
				};
				try {
					const observed = __addDisposableResource(env_1, await this.ctx.sessionQuery.observeSession(parentId), false);
					const before = this.record(parentId);
					const modeLocked = before.project.modeLocked === true || before.project.mode === "enabled" && hasOwnTurn(observed.events, observed.inheritedEventCount);
					if (before.project.modeLocked !== modeLocked) await this.update(parentId, (current) => ({
						...current,
						project: {
							...current.project,
							modeLocked
						}
					}));
					if (repairCapsuleOwnership(before, observed.events) !== before) await this.update(parentId, (current) => repairCapsuleOwnership(current, observed.events));
				} catch (e_1) {
					env_1.error = e_1;
					env_1.hasError = true;
				} finally {
					__disposeResources(env_1);
				}
			}
			let parent = this.ctx.agents.get(parentId);
			const r = this.record(parentId);
			if (!parent && r.assignments.some((a) => a.admission === "prepared" || a.admission === "unknown")) parent = await resolveOrdinaryAgent(this.ctx, parentId);
			if (parent) {
				for (const a of r.assignments) if (a.admission === "prepared" || a.admission === "unknown") await this.reconcileAssignment(parent, a.id);
				for (const w of r.workers) if (w.lifecycle === "deleting") {
					await this.ctx.subagents.drainChildren(parent, [SessionId(w.id)]);
					await this.update(parentId, (state) => ({
						...state,
						workers: state.workers.map((worker) => worker.id === w.id ? {
							...worker,
							lifecycle: "deleted",
							deletedAt: Date.now()
						} : worker)
					}));
				}
			}
			for (const w of this.record(parentId).workers) if (w.lifecycle === "active" || w.lifecycle === "deleted") await this.ingest(SessionId(w.id));
			await this.deliver(parentId);
		}
		record(id) {
			return this.domain.table("projects").get(id);
		}
		owner(id) {
			return [...this.domain.table("projects").entries()].map(([, r]) => r).find((r) => r.workers.some((w) => w.id === id));
		}
		authorize(id) {
			if (!this.available) throw new Error("project-mode/runtime-unavailable");
			if (this.ctx.invocation && !this.ctx.get("remoteAccess")?.allows({
				kind: "session",
				id
			})) throw new Error("project-mode/unauthorized: Session access denied");
		}
		reconcileTools() {
			if (this.closing.signal.aborted) return;
			if (this.reconcilingTools) {
				this.toolsChangedDuringReconciliation = true;
				return;
			}
			for (const agent of this.ctx.agents.list()) this.attach(agent);
		}
		attach(agent) {
			const enabled = this.record(agent.id)?.project.mode === "enabled";
			if (this.reconcilingTools || this.closing.signal.aborted) return;
			const deny = enabled ? [...new Set(this.config.coordinatorHiddenTools)].sort() : [];
			const key = JSON.stringify([enabled, deny]);
			const old = this.mounted.get(agent);
			if (old?.key === key) return;
			this.reconcilingTools = true;
			try {
				this.mounted.delete(agent);
				old?.dispose();
				if (enabled) {
					const restrictions = deny.length ? agent.ctx.tools.suppress({ deny }) : () => {};
					try {
						const tool = agent.ctx.tools.register(this.controlTool);
						this.mounted.set(agent, {
							key,
							dispose: () => {
								tool();
								restrictions();
							}
						});
					} catch (error) {
						restrictions();
						throw error;
					}
				}
			} finally {
				this.reconcilingTools = false;
			}
			if (this.toolsChangedDuringReconciliation) {
				this.toolsChangedDuringReconciliation = false;
				for (const subject of this.ctx.agents.list()) this.attach(subject);
			}
		}
		roleText(agent) {
			const own = this.record(agent.id);
			if (own?.project.mode === "enabled") return `${coordinatorPrompt}\nPaths: ${JSON.stringify({
				...own.project.paths,
				contextIndex: contextIndexPath(own.project.paths)
			})}`;
			const parent = this.owner(agent.id);
			return parent ? `${workerPrompt}\nCoordinator: ${parent.project.coordinatorSessionId}\nPaths: ${JSON.stringify({
				...parent.project.paths,
				contextIndex: contextIndexPath(parent.project.paths)
			})}` : "";
		}
		notify() {
			for (const fn of [...this.listeners]) fn();
		}
		enqueue(work) {
			this.jobs = this.jobs.then(work).catch((error) => {
				this.ctx.logger.warn(String(error));
			}).then(() => this.notify());
		}
		async update(id, fn) {
			await this.domain.table("projects").update(id, (r) => {
				const next = fn(r);
				return recordSchema.parse({
					...next,
					project: {
						...next.project,
						revision: r.project.revision + 1,
						updatedAt: Date.now()
					}
				});
			});
			this.notify();
		}
		worker(r, id) {
			const w = r.workers.find((w) => w.id === id);
			if (!w) throw new Error("project-mode/not-owned");
			return w;
		}
		requireCoordinator(agent) {
			if (!this.available || this.ctx.agents.get(agent.id) !== agent || this.record(agent.id)?.project.mode !== "enabled") throw new Error("project-mode/not-coordinator");
			return this.record(agent.id);
		}
		async controlForAgent(agent, request, operationId, signal) {
			return this.workers.controlForAgent(agent, request, operationId, signal);
		}
		reconcileAssignment(agent, assignmentId) {
			return this.workers.reconcileAssignment(agent, assignmentId);
		}
		async refreshWorkersForInput(agent, inputMessageIds, signal) {
			const superseded = new AbortController();
			const wake = () => {
				if (agent.inbox.nextStep.some((message) => message.source.kind === "user")) superseded.abort(/* @__PURE__ */ new Error("project-mode/worker-refresh-superseded"));
			};
			this.listeners.add(wake);
			try {
				wake();
				let workers;
				try {
					workers = await this.workers.listWorkers(agent, AbortSignal.any([signal, superseded.signal]));
				} catch (error) {
					signal.throwIfAborted();
					if (!superseded.signal.aborted) throw error;
					workers = null;
				}
				signal.throwIfAborted();
				this.workerInputSnapshots.set(agent.id, `Worker state sampled for this user input (null means unavailable).\n${JSON.stringify({
					sampledAt: Date.now(),
					inputMessageIds,
					workers
				})}`);
			} finally {
				this.listeners.delete(wake);
			}
		}
		async inspect(worker, signal, details = false) {
			const view = await this.view(worker, signal);
			try {
				return {
					...view,
					activity: await readWorkerActivity(this.access, SessionId(worker.id), signal, details ? Number.MAX_SAFE_INTEGER : this.config.progressTextMaxChars)
				};
			} catch {
				signal?.throwIfAborted();
				return {
					...view,
					activity: null
				};
			}
		}
		async view(worker, signal) {
			const id = SessionId(worker.id), agent = this.ctx.agents.get(id);
			let status = null, availability = "unavailable", queueLength = null, pendingSteerCount = null;
			try {
				if (agent) {
					status = agent.status === "running" ? "busy" : "idle";
					availability = "live";
					queueLength = agent.inbox.nextTurn.length;
					pendingSteerCount = agent.inbox.nextStep.length;
				} else {
					const env_2 = {
						stack: [],
						error: void 0,
						hasError: false
					};
					try {
						const inbox = __addDisposableResource(env_2, await observeForTurn(this.ctx, id, signal), false).projections?.values.inbox;
						if (!inbox) throw new Error("inbox unavailable");
						status = "idle";
						availability = "cold";
						queueLength = inbox["next-turn"].length;
						pendingSteerCount = inbox["next-step"].length;
					} catch (e_2) {
						env_2.error = e_2;
						env_2.hasError = true;
					} finally {
						__disposeResources(env_2);
					}
				}
			} catch {
				signal?.throwIfAborted();
			}
			const last = this.owner(id)?.completions.filter((c) => c.workerId === id).at(-1);
			const text = this.progress.get(id) ?? (status !== "busy" ? last?.lastAssistant?.content.filter((b) => b.type === "text").map((b) => b.text).join("") : void 0);
			return {
				workerId: id,
				name: worker.name,
				lifecycle: worker.lifecycle,
				status,
				availability,
				queueLength,
				pendingSteerCount,
				phase: worker.lifecycle === "provision-failed" ? "failed" : worker.lifecycle === "provisioning" ? "starting" : availability === "unavailable" ? "disconnected" : status === "busy" ? "working" : last?.outcome === "aborted" ? "stopped" : last?.outcome === "error" ? "failed" : "idle",
				...text ? { progressText: text.slice(0, this.config.progressTextMaxChars) } : {},
				updatedAt: Date.now()
			};
		}
		ingest(id) {
			return this.outbox.ingest(id);
		}
		consume(id, messageId) {
			return this.outbox.consume(id, messageId);
		}
		deliver(id) {
			return this.outbox.deliver(id);
		}
		guardTurn(agent, turn, signal) {
			return this.turns.guardTurn(agent, turn, signal);
		}
		freezeTurn(id, turn, reason) {
			return this.turns.freezeTurn(id, turn, reason);
		}
		async snapshot(sessionId) {
			this.authorize(sessionId);
			await this.jobs;
			const r = this.record(sessionId);
			if (!r) return null;
			const members = r.workers.filter(isVisibleWorker), memberIds = new Set(members.map((w) => w.id)), workers = await Promise.all(members.map((w) => this.view(w))), agent = this.ctx.agents.get(sessionId);
			return buildMoASnapshot({
				sessionId,
				record: r,
				workers,
				memberIds,
				boundary: agent ? this.ctx.sessionProjections.stateOf(agent.session, "turnBoundary") : void 0,
				waiting: this.turns.waiting.has(sessionId),
				pendingSteerCount: agent?.inbox.nextStep.length ?? 0,
				streamEpoch: this.epoch
			});
		}
		async *follow(sessionId, signal) {
			const control = AbortSignal.any([signal, this.closing.signal]);
			while (!control.aborted) {
				const iteration = new AbortController();
				const next = abortableChange(this.listeners, AbortSignal.any([control, iteration.signal]));
				next.catch(() => {});
				try {
					const value = await this.snapshot(sessionId);
					if (value) yield {
						type: "baseline",
						value
					};
					try {
						await next;
					} catch {
						return;
					}
				} finally {
					iteration.abort();
				}
			}
		}
		async catalog() {
			if (!this.available) throw new Error("project-mode/runtime-unavailable");
			const result = [];
			for (const [id] of this.domain.table("projects").entries()) if (!this.ctx.invocation || this.ctx.get("remoteAccess")?.allows({
				kind: "session",
				id: SessionId(id)
			})) {
				const snapshot = await this.snapshot(SessionId(id));
				if (snapshot) result.push(snapshot);
			}
			return result;
		}
		async control(sessionId, request, requestId, signal) {
			this.authorize(sessionId);
			const agent = this.ctx.agents.get(sessionId);
			if (!agent) throw new Error("project-mode/coordinator-unavailable");
			return this.controlForAgent(agent, request, `remote:${requestId}`, signal);
		}
		async history(sessionId, workerId, offset, limit, signal) {
			this.authorize(sessionId);
			const request = historySchema.parse({
				action: "history",
				worker_id: workerId,
				offset,
				limit
			});
			return this.readHistory(sessionId, request.worker_id, request.offset, request.limit, signal);
		}
		async *timeline(sessionId, workerId, limit, signal) {
			this.authorize(sessionId);
			const request = historySchema.parse({
				action: "history",
				worker_id: workerId,
				offset: 0,
				limit
			});
			yield* followWorkerTimeline(this.access, sessionId, request.worker_id, request.limit, signal);
		}
		readHistory(parentId, workerId, offset, limit, signal) {
			return readHistory(this.access, parentId, workerId, offset, limit, signal);
		}
		mode(sessionId) {
			this.authorize(sessionId);
			return this.lifecycle.mode(sessionId);
		}
		async setEnabled(sessionId, enabled, expectedRevision, requestId) {
			this.authorize(sessionId);
			return this.lifecycle.setEnabled(sessionId, enabled, expectedRevision, requestId);
		}
	};
})();
export { Config, MoAPlugin as default };
