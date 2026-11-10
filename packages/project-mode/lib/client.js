window.__ModuleLoader__.load({
	id: "dsh-plugin-project-mode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		let react = require("react");
		react = __toESM(react, 1);
		let zod = require("zod");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		// ../../node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/remote-info.js
		/** Lazy assembly of generated Remote definitions using caller-supplied Zod; no runtime imports. */
		/**
		* Retain one generated definition per endpoint without constructing parsers or projections.
		* The class instance builds its shared descriptor/method index on first access;
		* input schemas and JSON Schema projections are cached only when requested.
		* @param spec - compiler-produced method facts and Zod factories.
		* @param zod - the generated artifact's Zod runtime for named-input parsers.
		* @returns a lazy, mountable info instance with no registration or transport effects.
		*/
		function createTypertRemoteInfo(spec, zod) {
			return new RemoteInfo(spec, zod);
		}
		var RemoteInfo = class {
			spec;
			zod;
			index;
			constructor(spec, zod) {
				this.spec = spec;
				this.zod = zod;
			}
			get package() {
				return this.spec.package;
			}
			get descriptors() {
				return this.resolve().descriptors;
			}
			get methods() {
				return this.resolve().methods;
			}
			resolve() {
				if (this.index !== void 0) return this.index;
				const zod = this.zod;
				const descriptors = [];
				const methods = Object.create(null);
				for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
					const separator = endpoint.indexOf("/");
					const namespace = endpoint.slice(0, separator);
					const method = endpoint.slice(separator + 1);
					const parameters = definition.parameters.map((parameter) => ({
						...parameter,
						wire: parameter.wire ?? parameter.name
					}));
					const descriptor = {
						...definition,
						id: `${this.spec.package}#${endpoint}`,
						namespace,
						method,
						parameters,
						result: definition.result.description === void 0 ? definition.result : new ResultValue(definition.result)
					};
					if (definition.invocation.kind === "direct") {
						const inputs = [];
						methods[endpoint] = Object.assign(descriptor, {
							input(options) {
								const strict = options?.strict === true;
								return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod);
							},
							invoke(remote, input, signal) {
								const named = input;
								const values = parameters.map((parameter) => named[parameter.wire]);
								if (definition.cancellation !== void 0) values.push(signal);
								const receiver = Reflect.get(remote, namespace);
								return Reflect.get(receiver, method).apply(receiver, values);
							}
						});
					}
					descriptors.push(descriptor);
				}
				return this.index = {
					descriptors,
					methods
				};
			}
		};
		function optional(parameter) {
			return parameter.source === "json" && parameter.acceptsUndefined === true;
		}
		var NamedInput = class {
			parameters;
			strict;
			zod;
			schema;
			projection;
			constructor(parameters, strict, zod) {
				this.parameters = parameters;
				this.strict = strict;
				this.zod = zod;
			}
			codec(parameter) {
				return this.strict ? parameter.strictCodec : parameter.codec;
			}
			create = () => this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map((parameter) => {
				const value = this.codec(parameter).create();
				return [parameter.wire, optional(parameter) ? value.optional() : value.nonoptional()];
			})));
			get jsonSchema() {
				return this.project().jsonSchema;
			}
			get jsonSchemaError() {
				return this.project().jsonSchemaError;
			}
			project() {
				if (this.projection !== void 0) return this.projection;
				const unavailable = this.parameters.find((parameter) => this.codec(parameter).jsonSchema === void 0);
				if (unavailable !== void 0) return this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}` };
				return this.projection = { jsonSchema: {
					type: "object",
					properties: Object.fromEntries(this.parameters.map((parameter) => [parameter.wire, {
						...this.codec(parameter).jsonSchema,
						...parameter.description === void 0 ? {} : { description: parameter.description }
					}])),
					required: this.parameters.filter((parameter) => !optional(parameter)).map((parameter) => parameter.wire),
					additionalProperties: false
				} };
			}
		};
		var ResultValue = class {
			spec;
			projection;
			constructor(spec) {
				this.spec = spec;
			}
			get mode() {
				return this.spec.mode;
			}
			get typeSymbol() {
				return this.spec.typeSymbol;
			}
			get create() {
				return this.spec.create;
			}
			get decode() {
				return this.spec.decode;
			}
			get encode() {
				return this.spec.encode;
			}
			get description() {
				return this.spec.description;
			}
			get jsonSchemaError() {
				return this.spec.jsonSchemaError;
			}
			get jsonSchema() {
				if (this.projection === void 0) {
					const schema = this.spec.jsonSchema;
					this.projection = { value: schema === void 0 ? void 0 : {
						...schema,
						description: this.spec.description
					} };
				}
				return this.projection.value;
			}
		};
		// lib/typert.remote-client.js
		let dsh_plugin_project_mode_projectMode_catalog_result$schema$value;
		const dsh_plugin_project_mode_projectMode_catalog_result$schema = () => dsh_plugin_project_mode_projectMode_catalog_result$schema$value ??= zod.z.array(zod.z.object({
			"project": zod.z.object({
				"version": zod.z.literal(1),
				"id": zod.z.string(),
				"coordinatorSessionId": zod.z.string(),
				"workspaceId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"workspacePath": zod.z.string(),
				"paths": zod.z.object({
					"root": zod.z.string(),
					"context": zod.z.string(),
					"notes": zod.z.string(),
					"archived": zod.z.string(),
					"index": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("New index; older records are resolved without rewriting their documents.")
				}),
				"mode": zod.z.union([zod.z.literal("enabled"), zod.z.literal("disabled")]),
				"modeLocked": zod.z.union([
					zod.z.undefined(),
					zod.z.literal(false),
					zod.z.literal(true)
				]).optional().describe("Project identity becomes permanent when this Session starts a turn."),
				"revision": zod.z.number(),
				"createdAt": zod.z.number(),
				"updatedAt": zod.z.number()
			}),
			"workers": zod.z.array(zod.z.object({
				"workerId": zod.z.string(),
				"parentSessionId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("Actual native direct parent; older direct-child snapshots omit this field."),
				"name": zod.z.string(),
				"lifecycle": zod.z.union([
					zod.z.literal("provisioning"),
					zod.z.literal("active"),
					zod.z.literal("deleting"),
					zod.z.literal("deleted"),
					zod.z.literal("provision-failed")
				]),
				"status": zod.z.union([
					zod.z.literal(null),
					zod.z.literal("busy"),
					zod.z.literal("idle")
				]),
				"availability": zod.z.union([
					zod.z.literal("live"),
					zod.z.literal("cold"),
					zod.z.literal("unavailable")
				]),
				"queueLength": zod.z.union([zod.z.literal(null), zod.z.number()]),
				"pendingSteerCount": zod.z.union([zod.z.literal(null), zod.z.number()]),
				"phase": zod.z.union([
					zod.z.literal("idle"),
					zod.z.literal("starting"),
					zod.z.literal("working"),
					zod.z.literal("waiting-user"),
					zod.z.literal("stopping"),
					zod.z.literal("failed"),
					zod.z.literal("stopped"),
					zod.z.literal("disconnected")
				]),
				"progressText": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"updatedAt": zod.z.number(),
				"activity": zod.z.union([
					zod.z.undefined(),
					zod.z.literal(null),
					zod.z.object({
						"observedThroughSeq": zod.z.number(),
						"latestInput": zod.z.union([zod.z.undefined(), zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})]).optional().describe("Latest committed task/dialogue input, not a guessed task summary."),
						"lastUserInput": zod.z.union([zod.z.undefined(), zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})]).optional().describe("Most recent committed or still-pending human input; excludes withdrawn input."),
						"pendingUserInputs": zod.z.array(zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})),
						"pendingUserInputCount": zod.z.number()
					})
				]).optional().describe("Present on list/get; null means native activity could not be observed.")
			})),
			"turnMemberships": zod.z.array(zod.z.object({
				"projectId": zod.z.string(),
				"coordinatorSessionId": zod.z.string(),
				"coordinatorTurn": zod.z.number(),
				"segmentStartSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional().describe("Native human user/message (or turn/start fallback) seq; never a business turn."),
				"participationSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional().describe("Native coordinator evidence at the first accepted assignment/result."),
				"participationKind": zod.z.union([
					zod.z.undefined(),
					zod.z.literal("spawn"),
					zod.z.literal("send"),
					zod.z.literal("result")
				]).optional(),
				"completionIds": zod.z.union([zod.z.undefined(), zod.z.array(zod.z.string())]).optional(),
				"workerId": zod.z.string(),
				"firstOperationId": zod.z.string(),
				"firstCallId": zod.z.string(),
				"order": zod.z.number()
			})),
			"closedTurnOutcomes": zod.z.array(zod.z.object({
				"coordinatorSessionId": zod.z.string(),
				"coordinatorTurn": zod.z.number(),
				"segmentStartSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional(),
				"workerId": zod.z.string(),
				"status": zod.z.union([
					zod.z.literal("deleted"),
					zod.z.literal("failed"),
					zod.z.literal("stopped"),
					zod.z.literal("completed"),
					zod.z.literal("continued")
				]),
				"completionIds": zod.z.array(zod.z.string()),
				"lastResultMessageId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"lastResultSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional(),
				"summary": zod.z.union([zod.z.undefined(), zod.z.string()]).optional()
			})),
			"coordinatorTurn": zod.z.union([zod.z.literal(null), zod.z.object({
				"sessionId": zod.z.string(),
				"turn": zod.z.number(),
				"phase": zod.z.union([
					zod.z.literal("working"),
					zod.z.literal("failed"),
					zod.z.literal("waiting-workers"),
					zod.z.literal("reviewing-results"),
					zod.z.literal("closing"),
					zod.z.literal("closed"),
					zod.z.literal("interrupted")
				]),
				"workerIds": zod.z.array(zod.z.string()),
				"unresolvedOperationIds": zod.z.array(zod.z.string()),
				"pendingAssignmentIds": zod.z.array(zod.z.string()),
				"runningWorkerIds": zod.z.array(zod.z.string()),
				"queuedWorkerIds": zod.z.array(zod.z.string()),
				"undeliveredCompletionIds": zod.z.array(zod.z.string()),
				"unconsumedCompletionIds": zod.z.array(zod.z.string()),
				"pendingSteerCount": zod.z.number(),
				"revision": zod.z.number()
			})]),
			"streamEpoch": zod.z.string(),
			"revision": zod.z.number()
		}));
		let dsh_plugin_project_mode_projectMode_control_parameter_0$schema$value;
		const dsh_plugin_project_mode_projectMode_control_parameter_0$schema = () => dsh_plugin_project_mode_projectMode_control_parameter_0$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_control_parameter_1$schema$value;
		const dsh_plugin_project_mode_projectMode_control_parameter_1$schema = () => dsh_plugin_project_mode_projectMode_control_parameter_1$schema$value ??= zod.z.union([
			zod.z.object({
				"action": zod.z.literal("spawn"),
				"name": zod.z.string(),
				"task": zod.z.string(),
				"task_ref": zod.z.union([zod.z.undefined(), zod.z.string()]).optional()
			}),
			zod.z.object({ "action": zod.z.literal("list") }),
			zod.z.object({
				"action": zod.z.literal("send"),
				"worker_id": zod.z.string(),
				"message": zod.z.string(),
				"delivery": zod.z.union([zod.z.literal("steer"), zod.z.literal("queue")]),
				"task_ref": zod.z.union([zod.z.undefined(), zod.z.string()]).optional()
			}),
			zod.z.object({
				"action": zod.z.literal("get"),
				"worker_id": zod.z.string()
			}),
			zod.z.object({
				"action": zod.z.literal("interrupt"),
				"worker_id": zod.z.string()
			}),
			zod.z.object({
				"action": zod.z.literal("delete"),
				"worker_id": zod.z.string()
			}),
			zod.z.object({
				"action": zod.z.literal("history"),
				"worker_id": zod.z.string(),
				"offset": zod.z.number(),
				"limit": zod.z.number()
			})
		]);
		let dsh_plugin_project_mode_projectMode_control_parameter_2$schema$value;
		const dsh_plugin_project_mode_projectMode_control_parameter_2$schema = () => dsh_plugin_project_mode_projectMode_control_parameter_2$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_control_result$schema$value;
		const dsh_plugin_project_mode_projectMode_control_result$schema = () => dsh_plugin_project_mode_projectMode_control_result$schema$value ??= zod.z.union([
			zod.z.object({
				"workerId": zod.z.string(),
				"parentSessionId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("Actual native direct parent; older direct-child snapshots omit this field."),
				"name": zod.z.string(),
				"lifecycle": zod.z.union([
					zod.z.literal("provisioning"),
					zod.z.literal("active"),
					zod.z.literal("deleting"),
					zod.z.literal("deleted"),
					zod.z.literal("provision-failed")
				]),
				"status": zod.z.union([
					zod.z.literal(null),
					zod.z.literal("busy"),
					zod.z.literal("idle")
				]),
				"availability": zod.z.union([
					zod.z.literal("live"),
					zod.z.literal("cold"),
					zod.z.literal("unavailable")
				]),
				"queueLength": zod.z.union([zod.z.literal(null), zod.z.number()]),
				"pendingSteerCount": zod.z.union([zod.z.literal(null), zod.z.number()]),
				"phase": zod.z.union([
					zod.z.literal("idle"),
					zod.z.literal("starting"),
					zod.z.literal("working"),
					zod.z.literal("waiting-user"),
					zod.z.literal("stopping"),
					zod.z.literal("failed"),
					zod.z.literal("stopped"),
					zod.z.literal("disconnected")
				]),
				"progressText": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"updatedAt": zod.z.number(),
				"activity": zod.z.union([
					zod.z.undefined(),
					zod.z.literal(null),
					zod.z.object({
						"observedThroughSeq": zod.z.number(),
						"latestInput": zod.z.union([zod.z.undefined(), zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})]).optional().describe("Latest committed task/dialogue input, not a guessed task summary."),
						"lastUserInput": zod.z.union([zod.z.undefined(), zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})]).optional().describe("Most recent committed or still-pending human input; excludes withdrawn input."),
						"pendingUserInputs": zod.z.array(zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})),
						"pendingUserInputCount": zod.z.number()
					})
				]).optional().describe("Present on list/get; null means native activity could not be observed.")
			}),
			zod.z.array(zod.z.object({
				"workerId": zod.z.string(),
				"parentSessionId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("Actual native direct parent; older direct-child snapshots omit this field."),
				"name": zod.z.string(),
				"lifecycle": zod.z.union([
					zod.z.literal("provisioning"),
					zod.z.literal("active"),
					zod.z.literal("deleting"),
					zod.z.literal("deleted"),
					zod.z.literal("provision-failed")
				]),
				"status": zod.z.union([
					zod.z.literal(null),
					zod.z.literal("busy"),
					zod.z.literal("idle")
				]),
				"availability": zod.z.union([
					zod.z.literal("live"),
					zod.z.literal("cold"),
					zod.z.literal("unavailable")
				]),
				"queueLength": zod.z.union([zod.z.literal(null), zod.z.number()]),
				"pendingSteerCount": zod.z.union([zod.z.literal(null), zod.z.number()]),
				"phase": zod.z.union([
					zod.z.literal("idle"),
					zod.z.literal("starting"),
					zod.z.literal("working"),
					zod.z.literal("waiting-user"),
					zod.z.literal("stopping"),
					zod.z.literal("failed"),
					zod.z.literal("stopped"),
					zod.z.literal("disconnected")
				]),
				"progressText": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"updatedAt": zod.z.number(),
				"activity": zod.z.union([
					zod.z.undefined(),
					zod.z.literal(null),
					zod.z.object({
						"observedThroughSeq": zod.z.number(),
						"latestInput": zod.z.union([zod.z.undefined(), zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})]).optional().describe("Latest committed task/dialogue input, not a guessed task summary."),
						"lastUserInput": zod.z.union([zod.z.undefined(), zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})]).optional().describe("Most recent committed or still-pending human input; excludes withdrawn input."),
						"pendingUserInputs": zod.z.array(zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})),
						"pendingUserInputCount": zod.z.number()
					})
				]).optional().describe("Present on list/get; null means native activity could not be observed.")
			})),
			zod.z.object({
				"operationId": zod.z.string(),
				"workerId": zod.z.string(),
				"accepted": zod.z.literal(true),
				"assignmentId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"messageId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"coordinatorTurn": zod.z.union([zod.z.undefined(), zod.z.number()]).optional(),
				"delivery": zod.z.union([
					zod.z.undefined(),
					zod.z.literal("steer"),
					zod.z.literal("queue")
				]).optional(),
				"queuedWorkPolicy": zod.z.union([zod.z.undefined(), zod.z.literal("native-preserve")]).optional(),
				"lifecycle": zod.z.union([zod.z.undefined(), zod.z.literal("deleted")]).optional(),
				"historyRetained": zod.z.union([zod.z.undefined(), zod.z.literal(true)]).optional()
			}),
			zod.z.object({
				"workerId": zod.z.string(),
				"status": zod.z.union([
					zod.z.literal(null),
					zod.z.literal("busy"),
					zod.z.literal("idle")
				]),
				"offset": zod.z.number(),
				"limit": zod.z.number(),
				"total": zod.z.number(),
				"messages": zod.z.array(zod.z.object({
					"index": zod.z.number().describe("Zero-based position from newest in this observed dialogue."),
					"id": zod.z.string(),
					"seq": zod.z.number(),
					"turn": zod.z.number(),
					"role": zod.z.union([zod.z.literal("user"), zod.z.literal("assistant")]),
					"text": zod.z.string()
				})),
				"observedThroughSeq": zod.z.number()
			})
		]);
		let dsh_plugin_project_mode_projectMode_follow_parameter_0$schema$value;
		const dsh_plugin_project_mode_projectMode_follow_parameter_0$schema = () => dsh_plugin_project_mode_projectMode_follow_parameter_0$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_follow_result$schema$value;
		const dsh_plugin_project_mode_projectMode_follow_result$schema = () => dsh_plugin_project_mode_projectMode_follow_result$schema$value ??= zod.z.object({
			"type": zod.z.literal("baseline"),
			"value": zod.z.object({
				"project": zod.z.object({
					"version": zod.z.literal(1),
					"id": zod.z.string(),
					"coordinatorSessionId": zod.z.string(),
					"workspaceId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
					"workspacePath": zod.z.string(),
					"paths": zod.z.object({
						"root": zod.z.string(),
						"context": zod.z.string(),
						"notes": zod.z.string(),
						"archived": zod.z.string(),
						"index": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("New index; older records are resolved without rewriting their documents.")
					}),
					"mode": zod.z.union([zod.z.literal("enabled"), zod.z.literal("disabled")]),
					"modeLocked": zod.z.union([
						zod.z.undefined(),
						zod.z.literal(false),
						zod.z.literal(true)
					]).optional().describe("Project identity becomes permanent when this Session starts a turn."),
					"revision": zod.z.number(),
					"createdAt": zod.z.number(),
					"updatedAt": zod.z.number()
				}),
				"workers": zod.z.array(zod.z.object({
					"workerId": zod.z.string(),
					"parentSessionId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("Actual native direct parent; older direct-child snapshots omit this field."),
					"name": zod.z.string(),
					"lifecycle": zod.z.union([
						zod.z.literal("provisioning"),
						zod.z.literal("active"),
						zod.z.literal("deleting"),
						zod.z.literal("deleted"),
						zod.z.literal("provision-failed")
					]),
					"status": zod.z.union([
						zod.z.literal(null),
						zod.z.literal("busy"),
						zod.z.literal("idle")
					]),
					"availability": zod.z.union([
						zod.z.literal("live"),
						zod.z.literal("cold"),
						zod.z.literal("unavailable")
					]),
					"queueLength": zod.z.union([zod.z.literal(null), zod.z.number()]),
					"pendingSteerCount": zod.z.union([zod.z.literal(null), zod.z.number()]),
					"phase": zod.z.union([
						zod.z.literal("idle"),
						zod.z.literal("starting"),
						zod.z.literal("working"),
						zod.z.literal("waiting-user"),
						zod.z.literal("stopping"),
						zod.z.literal("failed"),
						zod.z.literal("stopped"),
						zod.z.literal("disconnected")
					]),
					"progressText": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
					"updatedAt": zod.z.number(),
					"activity": zod.z.union([
						zod.z.undefined(),
						zod.z.literal(null),
						zod.z.object({
							"observedThroughSeq": zod.z.number(),
							"latestInput": zod.z.union([zod.z.undefined(), zod.z.object({
								"messageId": zod.z.string(),
								"actor": zod.z.union([
									zod.z.literal("user"),
									zod.z.literal("coordinator"),
									zod.z.literal("other")
								]),
								"text": zod.z.string(),
								"truncated": zod.z.boolean(),
								"state": zod.z.union([
									zod.z.literal("committed"),
									zod.z.literal("pending-steer"),
									zod.z.literal("pending-queue")
								]),
								"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
								"time": zod.z.number()
							})]).optional().describe("Latest committed task/dialogue input, not a guessed task summary."),
							"lastUserInput": zod.z.union([zod.z.undefined(), zod.z.object({
								"messageId": zod.z.string(),
								"actor": zod.z.union([
									zod.z.literal("user"),
									zod.z.literal("coordinator"),
									zod.z.literal("other")
								]),
								"text": zod.z.string(),
								"truncated": zod.z.boolean(),
								"state": zod.z.union([
									zod.z.literal("committed"),
									zod.z.literal("pending-steer"),
									zod.z.literal("pending-queue")
								]),
								"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
								"time": zod.z.number()
							})]).optional().describe("Most recent committed or still-pending human input; excludes withdrawn input."),
							"pendingUserInputs": zod.z.array(zod.z.object({
								"messageId": zod.z.string(),
								"actor": zod.z.union([
									zod.z.literal("user"),
									zod.z.literal("coordinator"),
									zod.z.literal("other")
								]),
								"text": zod.z.string(),
								"truncated": zod.z.boolean(),
								"state": zod.z.union([
									zod.z.literal("committed"),
									zod.z.literal("pending-steer"),
									zod.z.literal("pending-queue")
								]),
								"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
								"time": zod.z.number()
							})),
							"pendingUserInputCount": zod.z.number()
						})
					]).optional().describe("Present on list/get; null means native activity could not be observed.")
				})),
				"turnMemberships": zod.z.array(zod.z.object({
					"projectId": zod.z.string(),
					"coordinatorSessionId": zod.z.string(),
					"coordinatorTurn": zod.z.number(),
					"segmentStartSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional().describe("Native human user/message (or turn/start fallback) seq; never a business turn."),
					"participationSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional().describe("Native coordinator evidence at the first accepted assignment/result."),
					"participationKind": zod.z.union([
						zod.z.undefined(),
						zod.z.literal("spawn"),
						zod.z.literal("send"),
						zod.z.literal("result")
					]).optional(),
					"completionIds": zod.z.union([zod.z.undefined(), zod.z.array(zod.z.string())]).optional(),
					"workerId": zod.z.string(),
					"firstOperationId": zod.z.string(),
					"firstCallId": zod.z.string(),
					"order": zod.z.number()
				})),
				"closedTurnOutcomes": zod.z.array(zod.z.object({
					"coordinatorSessionId": zod.z.string(),
					"coordinatorTurn": zod.z.number(),
					"segmentStartSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional(),
					"workerId": zod.z.string(),
					"status": zod.z.union([
						zod.z.literal("deleted"),
						zod.z.literal("failed"),
						zod.z.literal("stopped"),
						zod.z.literal("completed"),
						zod.z.literal("continued")
					]),
					"completionIds": zod.z.array(zod.z.string()),
					"lastResultMessageId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
					"lastResultSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional(),
					"summary": zod.z.union([zod.z.undefined(), zod.z.string()]).optional()
				})),
				"coordinatorTurn": zod.z.union([zod.z.literal(null), zod.z.object({
					"sessionId": zod.z.string(),
					"turn": zod.z.number(),
					"phase": zod.z.union([
						zod.z.literal("working"),
						zod.z.literal("failed"),
						zod.z.literal("waiting-workers"),
						zod.z.literal("reviewing-results"),
						zod.z.literal("closing"),
						zod.z.literal("closed"),
						zod.z.literal("interrupted")
					]),
					"workerIds": zod.z.array(zod.z.string()),
					"unresolvedOperationIds": zod.z.array(zod.z.string()),
					"pendingAssignmentIds": zod.z.array(zod.z.string()),
					"runningWorkerIds": zod.z.array(zod.z.string()),
					"queuedWorkerIds": zod.z.array(zod.z.string()),
					"undeliveredCompletionIds": zod.z.array(zod.z.string()),
					"unconsumedCompletionIds": zod.z.array(zod.z.string()),
					"pendingSteerCount": zod.z.number(),
					"revision": zod.z.number()
				})]),
				"streamEpoch": zod.z.string(),
				"revision": zod.z.number()
			})
		});
		let dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_0$schema$value;
		const dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_0$schema = () => dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_0$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_1$schema$value;
		const dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_1$schema = () => dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_1$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_followWorkerParent_result$schema$value;
		const dsh_plugin_project_mode_projectMode_followWorkerParent_result$schema = () => dsh_plugin_project_mode_projectMode_followWorkerParent_result$schema$value ??= zod.z.object({
			"workerId": zod.z.string(),
			"parentSessionId": zod.z.string()
		});
		let dsh_plugin_project_mode_projectMode_history_parameter_0$schema$value;
		const dsh_plugin_project_mode_projectMode_history_parameter_0$schema = () => dsh_plugin_project_mode_projectMode_history_parameter_0$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_history_parameter_1$schema$value;
		const dsh_plugin_project_mode_projectMode_history_parameter_1$schema = () => dsh_plugin_project_mode_projectMode_history_parameter_1$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_history_parameter_2$schema$value;
		const dsh_plugin_project_mode_projectMode_history_parameter_2$schema = () => dsh_plugin_project_mode_projectMode_history_parameter_2$schema$value ??= zod.z.number();
		let dsh_plugin_project_mode_projectMode_history_parameter_3$schema$value;
		const dsh_plugin_project_mode_projectMode_history_parameter_3$schema = () => dsh_plugin_project_mode_projectMode_history_parameter_3$schema$value ??= zod.z.number();
		let dsh_plugin_project_mode_projectMode_history_result$schema$value;
		const dsh_plugin_project_mode_projectMode_history_result$schema = () => dsh_plugin_project_mode_projectMode_history_result$schema$value ??= zod.z.object({
			"workerId": zod.z.string(),
			"status": zod.z.union([
				zod.z.literal(null),
				zod.z.literal("busy"),
				zod.z.literal("idle")
			]),
			"offset": zod.z.number(),
			"limit": zod.z.number(),
			"total": zod.z.number(),
			"messages": zod.z.array(zod.z.object({
				"index": zod.z.number().describe("Zero-based position from newest in this observed dialogue."),
				"id": zod.z.string(),
				"seq": zod.z.number(),
				"turn": zod.z.number(),
				"role": zod.z.union([zod.z.literal("user"), zod.z.literal("assistant")]),
				"text": zod.z.string()
			})),
			"observedThroughSeq": zod.z.number()
		});
		let dsh_plugin_project_mode_projectMode_mode_parameter_0$schema$value;
		const dsh_plugin_project_mode_projectMode_mode_parameter_0$schema = () => dsh_plugin_project_mode_projectMode_mode_parameter_0$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_mode_result$schema$value;
		const dsh_plugin_project_mode_projectMode_mode_result$schema = () => dsh_plugin_project_mode_projectMode_mode_result$schema$value ??= zod.z.object({
			"sessionId": zod.z.string(),
			"role": zod.z.union([
				zod.z.literal("coordinator"),
				zod.z.literal("ordinary"),
				zod.z.literal("worker")
			]),
			"enabled": zod.z.boolean(),
			"modeLocked": zod.z.union([
				zod.z.undefined(),
				zod.z.literal(false),
				zod.z.literal(true)
			]).optional(),
			"projectId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
			"coordinatorSessionId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
			"paths": zod.z.union([zod.z.undefined(), zod.z.object({
				"root": zod.z.string(),
				"context": zod.z.string(),
				"notes": zod.z.string(),
				"archived": zod.z.string(),
				"index": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("New index; older records are resolved without rewriting their documents.")
			})]).optional(),
			"revision": zod.z.number(),
			"canToggle": zod.z.boolean(),
			"toggleBlockedReason": zod.z.union([
				zod.z.undefined(),
				zod.z.literal("session-mode-locked"),
				zod.z.literal("agent-running"),
				zod.z.literal("workers-active"),
				zod.z.literal("results-pending"),
				zod.z.literal("worker-session"),
				zod.z.literal("runtime-unavailable")
			]).optional()
		});
		let dsh_plugin_project_mode_projectMode_setEnabled_parameter_0$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_parameter_0$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_parameter_0$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_setEnabled_parameter_1$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_parameter_1$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_parameter_1$schema$value ??= zod.z.boolean();
		let dsh_plugin_project_mode_projectMode_setEnabled_parameter_2$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_parameter_2$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_parameter_2$schema$value ??= zod.z.number();
		let dsh_plugin_project_mode_projectMode_setEnabled_parameter_3$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_parameter_3$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_parameter_3$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_setEnabled_result$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_result$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_result$schema$value ??= zod.z.object({
			"sessionId": zod.z.string(),
			"role": zod.z.union([
				zod.z.literal("coordinator"),
				zod.z.literal("ordinary"),
				zod.z.literal("worker")
			]),
			"enabled": zod.z.boolean(),
			"modeLocked": zod.z.union([
				zod.z.undefined(),
				zod.z.literal(false),
				zod.z.literal(true)
			]).optional(),
			"projectId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
			"coordinatorSessionId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
			"paths": zod.z.union([zod.z.undefined(), zod.z.object({
				"root": zod.z.string(),
				"context": zod.z.string(),
				"notes": zod.z.string(),
				"archived": zod.z.string(),
				"index": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("New index; older records are resolved without rewriting their documents.")
			})]).optional(),
			"revision": zod.z.number(),
			"canToggle": zod.z.boolean(),
			"toggleBlockedReason": zod.z.union([
				zod.z.undefined(),
				zod.z.literal("session-mode-locked"),
				zod.z.literal("agent-running"),
				zod.z.literal("workers-active"),
				zod.z.literal("results-pending"),
				zod.z.literal("worker-session"),
				zod.z.literal("runtime-unavailable")
			]).optional()
		});
		let dsh_plugin_project_mode_projectMode_snapshot_parameter_0$schema$value;
		const dsh_plugin_project_mode_projectMode_snapshot_parameter_0$schema = () => dsh_plugin_project_mode_projectMode_snapshot_parameter_0$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_snapshot_result$schema$value;
		const dsh_plugin_project_mode_projectMode_snapshot_result$schema = () => dsh_plugin_project_mode_projectMode_snapshot_result$schema$value ??= zod.z.union([zod.z.literal(null), zod.z.object({
			"project": zod.z.object({
				"version": zod.z.literal(1),
				"id": zod.z.string(),
				"coordinatorSessionId": zod.z.string(),
				"workspaceId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"workspacePath": zod.z.string(),
				"paths": zod.z.object({
					"root": zod.z.string(),
					"context": zod.z.string(),
					"notes": zod.z.string(),
					"archived": zod.z.string(),
					"index": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("New index; older records are resolved without rewriting their documents.")
				}),
				"mode": zod.z.union([zod.z.literal("enabled"), zod.z.literal("disabled")]),
				"modeLocked": zod.z.union([
					zod.z.undefined(),
					zod.z.literal(false),
					zod.z.literal(true)
				]).optional().describe("Project identity becomes permanent when this Session starts a turn."),
				"revision": zod.z.number(),
				"createdAt": zod.z.number(),
				"updatedAt": zod.z.number()
			}),
			"workers": zod.z.array(zod.z.object({
				"workerId": zod.z.string(),
				"parentSessionId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional().describe("Actual native direct parent; older direct-child snapshots omit this field."),
				"name": zod.z.string(),
				"lifecycle": zod.z.union([
					zod.z.literal("provisioning"),
					zod.z.literal("active"),
					zod.z.literal("deleting"),
					zod.z.literal("deleted"),
					zod.z.literal("provision-failed")
				]),
				"status": zod.z.union([
					zod.z.literal(null),
					zod.z.literal("busy"),
					zod.z.literal("idle")
				]),
				"availability": zod.z.union([
					zod.z.literal("live"),
					zod.z.literal("cold"),
					zod.z.literal("unavailable")
				]),
				"queueLength": zod.z.union([zod.z.literal(null), zod.z.number()]),
				"pendingSteerCount": zod.z.union([zod.z.literal(null), zod.z.number()]),
				"phase": zod.z.union([
					zod.z.literal("idle"),
					zod.z.literal("starting"),
					zod.z.literal("working"),
					zod.z.literal("waiting-user"),
					zod.z.literal("stopping"),
					zod.z.literal("failed"),
					zod.z.literal("stopped"),
					zod.z.literal("disconnected")
				]),
				"progressText": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"updatedAt": zod.z.number(),
				"activity": zod.z.union([
					zod.z.undefined(),
					zod.z.literal(null),
					zod.z.object({
						"observedThroughSeq": zod.z.number(),
						"latestInput": zod.z.union([zod.z.undefined(), zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})]).optional().describe("Latest committed task/dialogue input, not a guessed task summary."),
						"lastUserInput": zod.z.union([zod.z.undefined(), zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})]).optional().describe("Most recent committed or still-pending human input; excludes withdrawn input."),
						"pendingUserInputs": zod.z.array(zod.z.object({
							"messageId": zod.z.string(),
							"actor": zod.z.union([
								zod.z.literal("user"),
								zod.z.literal("coordinator"),
								zod.z.literal("other")
							]),
							"text": zod.z.string(),
							"truncated": zod.z.boolean(),
							"state": zod.z.union([
								zod.z.literal("committed"),
								zod.z.literal("pending-steer"),
								zod.z.literal("pending-queue")
							]),
							"seq": zod.z.number().describe("Native admission/edit position, or committed message position."),
							"time": zod.z.number()
						})),
						"pendingUserInputCount": zod.z.number()
					})
				]).optional().describe("Present on list/get; null means native activity could not be observed.")
			})),
			"turnMemberships": zod.z.array(zod.z.object({
				"projectId": zod.z.string(),
				"coordinatorSessionId": zod.z.string(),
				"coordinatorTurn": zod.z.number(),
				"segmentStartSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional().describe("Native human user/message (or turn/start fallback) seq; never a business turn."),
				"participationSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional().describe("Native coordinator evidence at the first accepted assignment/result."),
				"participationKind": zod.z.union([
					zod.z.undefined(),
					zod.z.literal("spawn"),
					zod.z.literal("send"),
					zod.z.literal("result")
				]).optional(),
				"completionIds": zod.z.union([zod.z.undefined(), zod.z.array(zod.z.string())]).optional(),
				"workerId": zod.z.string(),
				"firstOperationId": zod.z.string(),
				"firstCallId": zod.z.string(),
				"order": zod.z.number()
			})),
			"closedTurnOutcomes": zod.z.array(zod.z.object({
				"coordinatorSessionId": zod.z.string(),
				"coordinatorTurn": zod.z.number(),
				"segmentStartSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional(),
				"workerId": zod.z.string(),
				"status": zod.z.union([
					zod.z.literal("deleted"),
					zod.z.literal("failed"),
					zod.z.literal("stopped"),
					zod.z.literal("completed"),
					zod.z.literal("continued")
				]),
				"completionIds": zod.z.array(zod.z.string()),
				"lastResultMessageId": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
				"lastResultSeq": zod.z.union([zod.z.undefined(), zod.z.number()]).optional(),
				"summary": zod.z.union([zod.z.undefined(), zod.z.string()]).optional()
			})),
			"coordinatorTurn": zod.z.union([zod.z.literal(null), zod.z.object({
				"sessionId": zod.z.string(),
				"turn": zod.z.number(),
				"phase": zod.z.union([
					zod.z.literal("working"),
					zod.z.literal("failed"),
					zod.z.literal("waiting-workers"),
					zod.z.literal("reviewing-results"),
					zod.z.literal("closing"),
					zod.z.literal("closed"),
					zod.z.literal("interrupted")
				]),
				"workerIds": zod.z.array(zod.z.string()),
				"unresolvedOperationIds": zod.z.array(zod.z.string()),
				"pendingAssignmentIds": zod.z.array(zod.z.string()),
				"runningWorkerIds": zod.z.array(zod.z.string()),
				"queuedWorkerIds": zod.z.array(zod.z.string()),
				"undeliveredCompletionIds": zod.z.array(zod.z.string()),
				"unconsumedCompletionIds": zod.z.array(zod.z.string()),
				"pendingSteerCount": zod.z.number(),
				"revision": zod.z.number()
			})]),
			"streamEpoch": zod.z.string(),
			"revision": zod.z.number()
		})]);
		let dsh_plugin_project_mode_projectMode_timeline_parameter_0$schema$value;
		const dsh_plugin_project_mode_projectMode_timeline_parameter_0$schema = () => dsh_plugin_project_mode_projectMode_timeline_parameter_0$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_timeline_parameter_1$schema$value;
		const dsh_plugin_project_mode_projectMode_timeline_parameter_1$schema = () => dsh_plugin_project_mode_projectMode_timeline_parameter_1$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_timeline_parameter_2$schema$value;
		const dsh_plugin_project_mode_projectMode_timeline_parameter_2$schema = () => dsh_plugin_project_mode_projectMode_timeline_parameter_2$schema$value ??= zod.z.number();
		let dsh_plugin_project_mode_projectMode_timeline_result$schema$value;
		const dsh_plugin_project_mode_projectMode_timeline_result$schema = () => dsh_plugin_project_mode_projectMode_timeline_result$schema$value ??= zod.z.object({
			"workerId": zod.z.string(),
			"cwd": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
			"status": zod.z.union([
				zod.z.literal(null),
				zod.z.literal("busy"),
				zod.z.literal("idle")
			]),
			"total": zod.z.number(),
			"hasMore": zod.z.boolean(),
			"observedThroughSeq": zod.z.number(),
			"turns": zod.z.array(zod.z.object({
				"turn": zod.z.number(),
				"startedAt": zod.z.number(),
				"finishedAt": zod.z.union([zod.z.undefined(), zod.z.number()]).optional(),
				"outcome": zod.z.union([zod.z.literal(null), zod.z.string()]),
				"inputs": zod.z.array(zod.z.object({
					"id": zod.z.string(),
					"seq": zod.z.number(),
					"time": zod.z.number(),
					"text": zod.z.string(),
					"actor": zod.z.union([
						zod.z.undefined(),
						zod.z.literal("user"),
						zod.z.literal("coordinator"),
						zod.z.literal("agent")
					]).optional()
				})),
				"outputs": zod.z.array(zod.z.object({
					"id": zod.z.string(),
					"seq": zod.z.number(),
					"time": zod.z.number(),
					"text": zod.z.string(),
					"actor": zod.z.union([
						zod.z.undefined(),
						zod.z.literal("user"),
						zod.z.literal("coordinator"),
						zod.z.literal("agent")
					]).optional()
				})),
				"artifacts": zod.z.array(zod.z.object({
					"path": zod.z.string(),
					"description": zod.z.union([zod.z.undefined(), zod.z.string()]).optional(),
					"kind": zod.z.union([zod.z.literal("presented"), zod.z.literal("changed")]),
					"seq": zod.z.number(),
					"time": zod.z.number()
				}))
			}))
		});
		let dsh_plugin_project_mode_projectMode_control_parameter_0_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_control_parameter_0_strict$schema = () => dsh_plugin_project_mode_projectMode_control_parameter_0_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_control_parameter_1_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_control_parameter_1_strict$schema = () => dsh_plugin_project_mode_projectMode_control_parameter_1_strict$schema$value ??= zod.z.union([
			zod.z.strictObject({
				"action": zod.z.literal("spawn"),
				"name": zod.z.string(),
				"task": zod.z.string(),
				"task_ref": zod.z.union([zod.z.undefined(), zod.z.string()]).optional()
			}),
			zod.z.strictObject({ "action": zod.z.literal("list") }),
			zod.z.strictObject({
				"action": zod.z.literal("send"),
				"worker_id": zod.z.string(),
				"message": zod.z.string(),
				"delivery": zod.z.union([zod.z.literal("steer"), zod.z.literal("queue")]),
				"task_ref": zod.z.union([zod.z.undefined(), zod.z.string()]).optional()
			}),
			zod.z.strictObject({
				"action": zod.z.literal("get"),
				"worker_id": zod.z.string()
			}),
			zod.z.strictObject({
				"action": zod.z.literal("interrupt"),
				"worker_id": zod.z.string()
			}),
			zod.z.strictObject({
				"action": zod.z.literal("delete"),
				"worker_id": zod.z.string()
			}),
			zod.z.strictObject({
				"action": zod.z.literal("history"),
				"worker_id": zod.z.string(),
				"offset": zod.z.number(),
				"limit": zod.z.number()
			})
		]);
		let dsh_plugin_project_mode_projectMode_control_parameter_2_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_control_parameter_2_strict$schema = () => dsh_plugin_project_mode_projectMode_control_parameter_2_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_follow_parameter_0_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_follow_parameter_0_strict$schema = () => dsh_plugin_project_mode_projectMode_follow_parameter_0_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_0_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_0_strict$schema = () => dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_0_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_1_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_1_strict$schema = () => dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_1_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_history_parameter_0_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_history_parameter_0_strict$schema = () => dsh_plugin_project_mode_projectMode_history_parameter_0_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_history_parameter_1_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_history_parameter_1_strict$schema = () => dsh_plugin_project_mode_projectMode_history_parameter_1_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_history_parameter_2_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_history_parameter_2_strict$schema = () => dsh_plugin_project_mode_projectMode_history_parameter_2_strict$schema$value ??= zod.z.number();
		let dsh_plugin_project_mode_projectMode_history_parameter_3_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_history_parameter_3_strict$schema = () => dsh_plugin_project_mode_projectMode_history_parameter_3_strict$schema$value ??= zod.z.number();
		let dsh_plugin_project_mode_projectMode_mode_parameter_0_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_mode_parameter_0_strict$schema = () => dsh_plugin_project_mode_projectMode_mode_parameter_0_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_setEnabled_parameter_0_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_parameter_0_strict$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_parameter_0_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_setEnabled_parameter_1_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_parameter_1_strict$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_parameter_1_strict$schema$value ??= zod.z.boolean();
		let dsh_plugin_project_mode_projectMode_setEnabled_parameter_2_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_parameter_2_strict$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_parameter_2_strict$schema$value ??= zod.z.number();
		let dsh_plugin_project_mode_projectMode_setEnabled_parameter_3_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_setEnabled_parameter_3_strict$schema = () => dsh_plugin_project_mode_projectMode_setEnabled_parameter_3_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_snapshot_parameter_0_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_snapshot_parameter_0_strict$schema = () => dsh_plugin_project_mode_projectMode_snapshot_parameter_0_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_timeline_parameter_0_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_timeline_parameter_0_strict$schema = () => dsh_plugin_project_mode_projectMode_timeline_parameter_0_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_timeline_parameter_1_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_timeline_parameter_1_strict$schema = () => dsh_plugin_project_mode_projectMode_timeline_parameter_1_strict$schema$value ??= zod.z.string();
		let dsh_plugin_project_mode_projectMode_timeline_parameter_2_strict$schema$value;
		const dsh_plugin_project_mode_projectMode_timeline_parameter_2_strict$schema = () => dsh_plugin_project_mode_projectMode_timeline_parameter_2_strict$schema$value ??= zod.z.number();
		const TYPERT_REMOTE = createTypertRemoteInfo({
			package: "dsh-plugin-project-mode",
			methods: {
				"projectMode/catalog": {
					service: "projectMode",
					invocation: { kind: "direct" },
					parameters: [],
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode#projectMode/catalog:result",
						create: dsh_plugin_project_mode_projectMode_catalog_result$schema,
						jsonSchema: {
							"type": "array",
							"items": {
								"type": "object",
								"properties": {
									"project": {
										"type": "object",
										"properties": {
											"version": {
												"type": "number",
												"const": 1
											},
											"id": { "type": "string" },
											"coordinatorSessionId": { "type": "string" },
											"workspaceId": { "type": "string" },
											"workspacePath": { "type": "string" },
											"paths": {
												"type": "object",
												"properties": {
													"root": { "type": "string" },
													"context": { "type": "string" },
													"notes": { "type": "string" },
													"archived": { "type": "string" },
													"index": {
														"type": "string",
														"description": "New index; older records are resolved without rewriting their documents."
													}
												},
												"required": [
													"root",
													"context",
													"notes",
													"archived"
												],
												"additionalProperties": true
											},
											"mode": {
												"type": "string",
												"enum": ["enabled", "disabled"]
											},
											"modeLocked": {
												"type": "boolean",
												"enum": [false, true],
												"description": "Project identity becomes permanent when this Session starts a turn."
											},
											"revision": { "type": "number" },
											"createdAt": { "type": "number" },
											"updatedAt": { "type": "number" }
										},
										"required": [
											"version",
											"id",
											"coordinatorSessionId",
											"workspacePath",
											"paths",
											"mode",
											"revision",
											"createdAt",
											"updatedAt"
										],
										"additionalProperties": true
									},
									"workers": {
										"type": "array",
										"items": {
											"type": "object",
											"properties": {
												"workerId": { "type": "string" },
												"parentSessionId": {
													"type": "string",
													"description": "Actual native direct parent; older direct-child snapshots omit this field."
												},
												"name": { "type": "string" },
												"lifecycle": {
													"type": "string",
													"enum": [
														"provisioning",
														"active",
														"deleting",
														"deleted",
														"provision-failed"
													]
												},
												"status": { "oneOf": [{
													"type": "null",
													"const": null
												}, {
													"type": "string",
													"enum": ["busy", "idle"]
												}] },
												"availability": {
													"type": "string",
													"enum": [
														"live",
														"cold",
														"unavailable"
													]
												},
												"queueLength": { "oneOf": [{
													"type": "null",
													"const": null
												}, { "type": "number" }] },
												"pendingSteerCount": { "oneOf": [{
													"type": "null",
													"const": null
												}, { "type": "number" }] },
												"phase": {
													"type": "string",
													"enum": [
														"idle",
														"starting",
														"working",
														"waiting-user",
														"stopping",
														"failed",
														"stopped",
														"disconnected"
													]
												},
												"progressText": { "type": "string" },
												"updatedAt": { "type": "number" },
												"activity": {
													"oneOf": [{
														"type": "null",
														"const": null
													}, {
														"type": "object",
														"properties": {
															"observedThroughSeq": { "type": "number" },
															"latestInput": {
																"type": "object",
																"properties": {
																	"messageId": { "type": "string" },
																	"actor": {
																		"type": "string",
																		"enum": [
																			"user",
																			"coordinator",
																			"other"
																		]
																	},
																	"text": { "type": "string" },
																	"truncated": { "type": "boolean" },
																	"state": {
																		"type": "string",
																		"enum": [
																			"committed",
																			"pending-steer",
																			"pending-queue"
																		]
																	},
																	"seq": {
																		"type": "number",
																		"description": "Native admission/edit position, or committed message position."
																	},
																	"time": { "type": "number" }
																},
																"required": [
																	"messageId",
																	"actor",
																	"text",
																	"truncated",
																	"state",
																	"seq",
																	"time"
																],
																"additionalProperties": true,
																"description": "Latest committed task/dialogue input, not a guessed task summary."
															},
															"lastUserInput": {
																"type": "object",
																"properties": {
																	"messageId": { "type": "string" },
																	"actor": {
																		"type": "string",
																		"enum": [
																			"user",
																			"coordinator",
																			"other"
																		]
																	},
																	"text": { "type": "string" },
																	"truncated": { "type": "boolean" },
																	"state": {
																		"type": "string",
																		"enum": [
																			"committed",
																			"pending-steer",
																			"pending-queue"
																		]
																	},
																	"seq": {
																		"type": "number",
																		"description": "Native admission/edit position, or committed message position."
																	},
																	"time": { "type": "number" }
																},
																"required": [
																	"messageId",
																	"actor",
																	"text",
																	"truncated",
																	"state",
																	"seq",
																	"time"
																],
																"additionalProperties": true,
																"description": "Most recent committed or still-pending human input; excludes withdrawn input."
															},
															"pendingUserInputs": {
																"type": "array",
																"items": {
																	"type": "object",
																	"properties": {
																		"messageId": { "type": "string" },
																		"actor": {
																			"type": "string",
																			"enum": [
																				"user",
																				"coordinator",
																				"other"
																			]
																		},
																		"text": { "type": "string" },
																		"truncated": { "type": "boolean" },
																		"state": {
																			"type": "string",
																			"enum": [
																				"committed",
																				"pending-steer",
																				"pending-queue"
																			]
																		},
																		"seq": {
																			"type": "number",
																			"description": "Native admission/edit position, or committed message position."
																		},
																		"time": { "type": "number" }
																	},
																	"required": [
																		"messageId",
																		"actor",
																		"text",
																		"truncated",
																		"state",
																		"seq",
																		"time"
																	],
																	"additionalProperties": true
																}
															},
															"pendingUserInputCount": { "type": "number" }
														},
														"required": [
															"observedThroughSeq",
															"pendingUserInputs",
															"pendingUserInputCount"
														],
														"additionalProperties": true
													}],
													"description": "Present on list/get; null means native activity could not be observed."
												}
											},
											"required": [
												"workerId",
												"name",
												"lifecycle",
												"status",
												"availability",
												"queueLength",
												"pendingSteerCount",
												"phase",
												"updatedAt"
											],
											"additionalProperties": true
										}
									},
									"turnMemberships": {
										"type": "array",
										"items": {
											"type": "object",
											"properties": {
												"projectId": { "type": "string" },
												"coordinatorSessionId": { "type": "string" },
												"coordinatorTurn": { "type": "number" },
												"segmentStartSeq": {
													"type": "number",
													"description": "Native human user/message (or turn/start fallback) seq; never a business turn."
												},
												"participationSeq": {
													"type": "number",
													"description": "Native coordinator evidence at the first accepted assignment/result."
												},
												"participationKind": {
													"type": "string",
													"enum": [
														"spawn",
														"send",
														"result"
													]
												},
												"completionIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"workerId": { "type": "string" },
												"firstOperationId": { "type": "string" },
												"firstCallId": { "type": "string" },
												"order": { "type": "number" }
											},
											"required": [
												"projectId",
												"coordinatorSessionId",
												"coordinatorTurn",
												"workerId",
												"firstOperationId",
												"firstCallId",
												"order"
											],
											"additionalProperties": true
										}
									},
									"closedTurnOutcomes": {
										"type": "array",
										"items": {
											"type": "object",
											"properties": {
												"coordinatorSessionId": { "type": "string" },
												"coordinatorTurn": { "type": "number" },
												"segmentStartSeq": { "type": "number" },
												"workerId": { "type": "string" },
												"status": {
													"type": "string",
													"enum": [
														"deleted",
														"failed",
														"stopped",
														"completed",
														"continued"
													]
												},
												"completionIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"lastResultMessageId": { "type": "string" },
												"lastResultSeq": { "type": "number" },
												"summary": { "type": "string" }
											},
											"required": [
												"coordinatorSessionId",
												"coordinatorTurn",
												"workerId",
												"status",
												"completionIds"
											],
											"additionalProperties": true
										}
									},
									"coordinatorTurn": { "oneOf": [{
										"type": "null",
										"const": null
									}, {
										"type": "object",
										"properties": {
											"sessionId": { "type": "string" },
											"turn": { "type": "number" },
											"phase": {
												"type": "string",
												"enum": [
													"working",
													"failed",
													"waiting-workers",
													"reviewing-results",
													"closing",
													"closed",
													"interrupted"
												]
											},
											"workerIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"unresolvedOperationIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"pendingAssignmentIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"runningWorkerIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"queuedWorkerIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"undeliveredCompletionIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"unconsumedCompletionIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"pendingSteerCount": { "type": "number" },
											"revision": { "type": "number" }
										},
										"required": [
											"sessionId",
											"turn",
											"phase",
											"workerIds",
											"unresolvedOperationIds",
											"pendingAssignmentIds",
											"runningWorkerIds",
											"queuedWorkerIds",
											"undeliveredCompletionIds",
											"unconsumedCompletionIds",
											"pendingSteerCount",
											"revision"
										],
										"additionalProperties": true
									}] },
									"streamEpoch": { "type": "string" },
									"revision": { "type": "number" }
								},
								"required": [
									"project",
									"workers",
									"turnMemberships",
									"closedTurnOutcomes",
									"coordinatorTurn",
									"streamEpoch",
									"revision"
								],
								"additionalProperties": true
							}
						}
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 849,
						"column": 9
					}
				},
				"projectMode/control": {
					service: "projectMode",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "sessionId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_control_parameter_0$schema,
								jsonSchema: { "type": "string" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_control_parameter_0_strict$schema,
								jsonSchema: { "type": "string" }
							}
						},
						{
							name: "request",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode/shared#ControlWorkersRequest",
								create: dsh_plugin_project_mode_projectMode_control_parameter_1$schema,
								jsonSchema: { "oneOf": [
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "spawn"
											},
											"name": { "type": "string" },
											"task": { "type": "string" },
											"task_ref": { "type": "string" }
										},
										"required": [
											"action",
											"name",
											"task"
										],
										"additionalProperties": true
									},
									{
										"type": "object",
										"properties": { "action": {
											"type": "string",
											"const": "list"
										} },
										"required": ["action"],
										"additionalProperties": true
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "send"
											},
											"worker_id": { "type": "string" },
											"message": { "type": "string" },
											"delivery": {
												"type": "string",
												"enum": ["steer", "queue"]
											},
											"task_ref": { "type": "string" }
										},
										"required": [
											"action",
											"worker_id",
											"message",
											"delivery"
										],
										"additionalProperties": true
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "get"
											},
											"worker_id": { "type": "string" }
										},
										"required": ["action", "worker_id"],
										"additionalProperties": true
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "interrupt"
											},
											"worker_id": { "type": "string" }
										},
										"required": ["action", "worker_id"],
										"additionalProperties": true
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "delete"
											},
											"worker_id": { "type": "string" }
										},
										"required": ["action", "worker_id"],
										"additionalProperties": true
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "history"
											},
											"worker_id": { "type": "string" },
											"offset": { "type": "number" },
											"limit": { "type": "number" }
										},
										"required": [
											"action",
											"worker_id",
											"offset",
											"limit"
										],
										"additionalProperties": true
									}
								] }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode/shared#ControlWorkersRequest",
								create: dsh_plugin_project_mode_projectMode_control_parameter_1_strict$schema,
								jsonSchema: { "oneOf": [
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "spawn"
											},
											"name": { "type": "string" },
											"task": { "type": "string" },
											"task_ref": { "type": "string" }
										},
										"required": [
											"action",
											"name",
											"task"
										],
										"additionalProperties": false
									},
									{
										"type": "object",
										"properties": { "action": {
											"type": "string",
											"const": "list"
										} },
										"required": ["action"],
										"additionalProperties": false
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "send"
											},
											"worker_id": { "type": "string" },
											"message": { "type": "string" },
											"delivery": {
												"type": "string",
												"enum": ["steer", "queue"]
											},
											"task_ref": { "type": "string" }
										},
										"required": [
											"action",
											"worker_id",
											"message",
											"delivery"
										],
										"additionalProperties": false
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "get"
											},
											"worker_id": { "type": "string" }
										},
										"required": ["action", "worker_id"],
										"additionalProperties": false
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "interrupt"
											},
											"worker_id": { "type": "string" }
										},
										"required": ["action", "worker_id"],
										"additionalProperties": false
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "delete"
											},
											"worker_id": { "type": "string" }
										},
										"required": ["action", "worker_id"],
										"additionalProperties": false
									},
									{
										"type": "object",
										"properties": {
											"action": {
												"type": "string",
												"const": "history"
											},
											"worker_id": { "type": "string" },
											"offset": { "type": "number" },
											"limit": { "type": "number" }
										},
										"required": [
											"action",
											"worker_id",
											"offset",
											"limit"
										],
										"additionalProperties": false
									}
								] }
							}
						},
						{
							name: "requestId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/control:requestId",
								create: dsh_plugin_project_mode_projectMode_control_parameter_2$schema,
								jsonSchema: { "type": "string" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/control:requestId",
								create: dsh_plugin_project_mode_projectMode_control_parameter_2_strict$schema,
								jsonSchema: { "type": "string" }
							}
						}
					],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode/shared#ControlResult",
						create: dsh_plugin_project_mode_projectMode_control_result$schema,
						jsonSchemaError: "typert tool schema: selected union branches overlap or have no required discriminator"
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 865,
						"column": 9
					}
				},
				"projectMode/follow": {
					service: "projectMode",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [{
						name: "sessionId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_follow_parameter_0$schema,
							jsonSchema: { "type": "string" }
						},
						strictCodec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_follow_parameter_0_strict$schema,
							jsonSchema: { "type": "string" }
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode/shared#ProjectFrame",
						create: dsh_plugin_project_mode_projectMode_follow_result$schema,
						jsonSchema: {
							"type": "object",
							"properties": {
								"type": {
									"type": "string",
									"const": "baseline"
								},
								"value": {
									"type": "object",
									"properties": {
										"project": {
											"type": "object",
											"properties": {
												"version": {
													"type": "number",
													"const": 1
												},
												"id": { "type": "string" },
												"coordinatorSessionId": { "type": "string" },
												"workspaceId": { "type": "string" },
												"workspacePath": { "type": "string" },
												"paths": {
													"type": "object",
													"properties": {
														"root": { "type": "string" },
														"context": { "type": "string" },
														"notes": { "type": "string" },
														"archived": { "type": "string" },
														"index": {
															"type": "string",
															"description": "New index; older records are resolved without rewriting their documents."
														}
													},
													"required": [
														"root",
														"context",
														"notes",
														"archived"
													],
													"additionalProperties": true
												},
												"mode": {
													"type": "string",
													"enum": ["enabled", "disabled"]
												},
												"modeLocked": {
													"type": "boolean",
													"enum": [false, true],
													"description": "Project identity becomes permanent when this Session starts a turn."
												},
												"revision": { "type": "number" },
												"createdAt": { "type": "number" },
												"updatedAt": { "type": "number" }
											},
											"required": [
												"version",
												"id",
												"coordinatorSessionId",
												"workspacePath",
												"paths",
												"mode",
												"revision",
												"createdAt",
												"updatedAt"
											],
											"additionalProperties": true
										},
										"workers": {
											"type": "array",
											"items": {
												"type": "object",
												"properties": {
													"workerId": { "type": "string" },
													"parentSessionId": {
														"type": "string",
														"description": "Actual native direct parent; older direct-child snapshots omit this field."
													},
													"name": { "type": "string" },
													"lifecycle": {
														"type": "string",
														"enum": [
															"provisioning",
															"active",
															"deleting",
															"deleted",
															"provision-failed"
														]
													},
													"status": { "oneOf": [{
														"type": "null",
														"const": null
													}, {
														"type": "string",
														"enum": ["busy", "idle"]
													}] },
													"availability": {
														"type": "string",
														"enum": [
															"live",
															"cold",
															"unavailable"
														]
													},
													"queueLength": { "oneOf": [{
														"type": "null",
														"const": null
													}, { "type": "number" }] },
													"pendingSteerCount": { "oneOf": [{
														"type": "null",
														"const": null
													}, { "type": "number" }] },
													"phase": {
														"type": "string",
														"enum": [
															"idle",
															"starting",
															"working",
															"waiting-user",
															"stopping",
															"failed",
															"stopped",
															"disconnected"
														]
													},
													"progressText": { "type": "string" },
													"updatedAt": { "type": "number" },
													"activity": {
														"oneOf": [{
															"type": "null",
															"const": null
														}, {
															"type": "object",
															"properties": {
																"observedThroughSeq": { "type": "number" },
																"latestInput": {
																	"type": "object",
																	"properties": {
																		"messageId": { "type": "string" },
																		"actor": {
																			"type": "string",
																			"enum": [
																				"user",
																				"coordinator",
																				"other"
																			]
																		},
																		"text": { "type": "string" },
																		"truncated": { "type": "boolean" },
																		"state": {
																			"type": "string",
																			"enum": [
																				"committed",
																				"pending-steer",
																				"pending-queue"
																			]
																		},
																		"seq": {
																			"type": "number",
																			"description": "Native admission/edit position, or committed message position."
																		},
																		"time": { "type": "number" }
																	},
																	"required": [
																		"messageId",
																		"actor",
																		"text",
																		"truncated",
																		"state",
																		"seq",
																		"time"
																	],
																	"additionalProperties": true,
																	"description": "Latest committed task/dialogue input, not a guessed task summary."
																},
																"lastUserInput": {
																	"type": "object",
																	"properties": {
																		"messageId": { "type": "string" },
																		"actor": {
																			"type": "string",
																			"enum": [
																				"user",
																				"coordinator",
																				"other"
																			]
																		},
																		"text": { "type": "string" },
																		"truncated": { "type": "boolean" },
																		"state": {
																			"type": "string",
																			"enum": [
																				"committed",
																				"pending-steer",
																				"pending-queue"
																			]
																		},
																		"seq": {
																			"type": "number",
																			"description": "Native admission/edit position, or committed message position."
																		},
																		"time": { "type": "number" }
																	},
																	"required": [
																		"messageId",
																		"actor",
																		"text",
																		"truncated",
																		"state",
																		"seq",
																		"time"
																	],
																	"additionalProperties": true,
																	"description": "Most recent committed or still-pending human input; excludes withdrawn input."
																},
																"pendingUserInputs": {
																	"type": "array",
																	"items": {
																		"type": "object",
																		"properties": {
																			"messageId": { "type": "string" },
																			"actor": {
																				"type": "string",
																				"enum": [
																					"user",
																					"coordinator",
																					"other"
																				]
																			},
																			"text": { "type": "string" },
																			"truncated": { "type": "boolean" },
																			"state": {
																				"type": "string",
																				"enum": [
																					"committed",
																					"pending-steer",
																					"pending-queue"
																				]
																			},
																			"seq": {
																				"type": "number",
																				"description": "Native admission/edit position, or committed message position."
																			},
																			"time": { "type": "number" }
																		},
																		"required": [
																			"messageId",
																			"actor",
																			"text",
																			"truncated",
																			"state",
																			"seq",
																			"time"
																		],
																		"additionalProperties": true
																	}
																},
																"pendingUserInputCount": { "type": "number" }
															},
															"required": [
																"observedThroughSeq",
																"pendingUserInputs",
																"pendingUserInputCount"
															],
															"additionalProperties": true
														}],
														"description": "Present on list/get; null means native activity could not be observed."
													}
												},
												"required": [
													"workerId",
													"name",
													"lifecycle",
													"status",
													"availability",
													"queueLength",
													"pendingSteerCount",
													"phase",
													"updatedAt"
												],
												"additionalProperties": true
											}
										},
										"turnMemberships": {
											"type": "array",
											"items": {
												"type": "object",
												"properties": {
													"projectId": { "type": "string" },
													"coordinatorSessionId": { "type": "string" },
													"coordinatorTurn": { "type": "number" },
													"segmentStartSeq": {
														"type": "number",
														"description": "Native human user/message (or turn/start fallback) seq; never a business turn."
													},
													"participationSeq": {
														"type": "number",
														"description": "Native coordinator evidence at the first accepted assignment/result."
													},
													"participationKind": {
														"type": "string",
														"enum": [
															"spawn",
															"send",
															"result"
														]
													},
													"completionIds": {
														"type": "array",
														"items": { "type": "string" }
													},
													"workerId": { "type": "string" },
													"firstOperationId": { "type": "string" },
													"firstCallId": { "type": "string" },
													"order": { "type": "number" }
												},
												"required": [
													"projectId",
													"coordinatorSessionId",
													"coordinatorTurn",
													"workerId",
													"firstOperationId",
													"firstCallId",
													"order"
												],
												"additionalProperties": true
											}
										},
										"closedTurnOutcomes": {
											"type": "array",
											"items": {
												"type": "object",
												"properties": {
													"coordinatorSessionId": { "type": "string" },
													"coordinatorTurn": { "type": "number" },
													"segmentStartSeq": { "type": "number" },
													"workerId": { "type": "string" },
													"status": {
														"type": "string",
														"enum": [
															"deleted",
															"failed",
															"stopped",
															"completed",
															"continued"
														]
													},
													"completionIds": {
														"type": "array",
														"items": { "type": "string" }
													},
													"lastResultMessageId": { "type": "string" },
													"lastResultSeq": { "type": "number" },
													"summary": { "type": "string" }
												},
												"required": [
													"coordinatorSessionId",
													"coordinatorTurn",
													"workerId",
													"status",
													"completionIds"
												],
												"additionalProperties": true
											}
										},
										"coordinatorTurn": { "oneOf": [{
											"type": "null",
											"const": null
										}, {
											"type": "object",
											"properties": {
												"sessionId": { "type": "string" },
												"turn": { "type": "number" },
												"phase": {
													"type": "string",
													"enum": [
														"working",
														"failed",
														"waiting-workers",
														"reviewing-results",
														"closing",
														"closed",
														"interrupted"
													]
												},
												"workerIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"unresolvedOperationIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"pendingAssignmentIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"runningWorkerIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"queuedWorkerIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"undeliveredCompletionIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"unconsumedCompletionIds": {
													"type": "array",
													"items": { "type": "string" }
												},
												"pendingSteerCount": { "type": "number" },
												"revision": { "type": "number" }
											},
											"required": [
												"sessionId",
												"turn",
												"phase",
												"workerIds",
												"unresolvedOperationIds",
												"pendingAssignmentIds",
												"runningWorkerIds",
												"queuedWorkerIds",
												"undeliveredCompletionIds",
												"unconsumedCompletionIds",
												"pendingSteerCount",
												"revision"
											],
											"additionalProperties": true
										}] },
										"streamEpoch": { "type": "string" },
										"revision": { "type": "number" }
									},
									"required": [
										"project",
										"workers",
										"turnMemberships",
										"closedTurnOutcomes",
										"coordinatorTurn",
										"streamEpoch",
										"revision"
									],
									"additionalProperties": true
								}
							},
							"required": ["type", "value"],
							"additionalProperties": true
						}
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 812,
						"column": 10
					}
				},
				"projectMode/followWorkerParent": {
					service: "projectMode",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [{
						name: "sessionId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_0$schema,
							jsonSchema: { "type": "string" }
						},
						strictCodec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_0_strict$schema,
							jsonSchema: { "type": "string" }
						}
					}, {
						name: "workerId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_1$schema,
							jsonSchema: { "type": "string" }
						},
						strictCodec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_followWorkerParent_parameter_1_strict$schema,
							jsonSchema: { "type": "string" }
						}
					}],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode/shared#WorkerParentReady",
						create: dsh_plugin_project_mode_projectMode_followWorkerParent_result$schema,
						jsonSchema: {
							"type": "object",
							"properties": {
								"workerId": { "type": "string" },
								"parentSessionId": { "type": "string" }
							},
							"required": ["workerId", "parentSessionId"],
							"additionalProperties": true
						}
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 839,
						"column": 10
					}
				},
				"projectMode/history": {
					service: "projectMode",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "sessionId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_history_parameter_0$schema,
								jsonSchema: { "type": "string" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_history_parameter_0_strict$schema,
								jsonSchema: { "type": "string" }
							}
						},
						{
							name: "workerId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_history_parameter_1$schema,
								jsonSchema: { "type": "string" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_history_parameter_1_strict$schema,
								jsonSchema: { "type": "string" }
							}
						},
						{
							name: "offset",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/history:offset",
								create: dsh_plugin_project_mode_projectMode_history_parameter_2$schema,
								jsonSchema: { "type": "number" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/history:offset",
								create: dsh_plugin_project_mode_projectMode_history_parameter_2_strict$schema,
								jsonSchema: { "type": "number" }
							}
						},
						{
							name: "limit",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/history:limit",
								create: dsh_plugin_project_mode_projectMode_history_parameter_3$schema,
								jsonSchema: { "type": "number" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/history:limit",
								create: dsh_plugin_project_mode_projectMode_history_parameter_3_strict$schema,
								jsonSchema: { "type": "number" }
							}
						}
					],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode/shared#WorkerHistoryPage",
						create: dsh_plugin_project_mode_projectMode_history_result$schema,
						jsonSchema: {
							"type": "object",
							"properties": {
								"workerId": { "type": "string" },
								"status": { "oneOf": [{
									"type": "null",
									"const": null
								}, {
									"type": "string",
									"enum": ["busy", "idle"]
								}] },
								"offset": { "type": "number" },
								"limit": { "type": "number" },
								"total": { "type": "number" },
								"messages": {
									"type": "array",
									"items": {
										"type": "object",
										"properties": {
											"index": {
												"type": "number",
												"description": "Zero-based position from newest in this observed dialogue."
											},
											"id": { "type": "string" },
											"seq": { "type": "number" },
											"turn": { "type": "number" },
											"role": {
												"type": "string",
												"enum": ["user", "assistant"]
											},
											"text": { "type": "string" }
										},
										"required": [
											"index",
											"id",
											"seq",
											"turn",
											"role",
											"text"
										],
										"additionalProperties": true
									}
								},
								"observedThroughSeq": { "type": "number" }
							},
							"required": [
								"workerId",
								"status",
								"offset",
								"limit",
								"total",
								"messages",
								"observedThroughSeq"
							],
							"additionalProperties": true
						}
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 877,
						"column": 9
					}
				},
				"projectMode/mode": {
					service: "projectMode",
					invocation: { kind: "direct" },
					parameters: [{
						name: "sessionId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_mode_parameter_0$schema,
							jsonSchema: { "type": "string" }
						},
						strictCodec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_mode_parameter_0_strict$schema,
							jsonSchema: { "type": "string" }
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode/shared#SessionModeView",
						create: dsh_plugin_project_mode_projectMode_mode_result$schema,
						jsonSchema: {
							"type": "object",
							"properties": {
								"sessionId": { "type": "string" },
								"role": {
									"type": "string",
									"enum": [
										"coordinator",
										"ordinary",
										"worker"
									]
								},
								"enabled": { "type": "boolean" },
								"modeLocked": {
									"type": "boolean",
									"enum": [false, true]
								},
								"projectId": { "type": "string" },
								"coordinatorSessionId": { "type": "string" },
								"paths": {
									"type": "object",
									"properties": {
										"root": { "type": "string" },
										"context": { "type": "string" },
										"notes": { "type": "string" },
										"archived": { "type": "string" },
										"index": {
											"type": "string",
											"description": "New index; older records are resolved without rewriting their documents."
										}
									},
									"required": [
										"root",
										"context",
										"notes",
										"archived"
									],
									"additionalProperties": true
								},
								"revision": { "type": "number" },
								"canToggle": { "type": "boolean" },
								"toggleBlockedReason": {
									"type": "string",
									"enum": [
										"session-mode-locked",
										"agent-running",
										"workers-active",
										"results-pending",
										"worker-session",
										"runtime-unavailable"
									]
								}
							},
							"required": [
								"sessionId",
								"role",
								"enabled",
								"revision",
								"canToggle"
							],
							"additionalProperties": true
						}
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 931,
						"column": 3
					}
				},
				"projectMode/setEnabled": {
					service: "projectMode",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "sessionId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_setEnabled_parameter_0$schema,
								jsonSchema: { "type": "string" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_setEnabled_parameter_0_strict$schema,
								jsonSchema: { "type": "string" }
							}
						},
						{
							name: "enabled",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/setEnabled:enabled",
								create: dsh_plugin_project_mode_projectMode_setEnabled_parameter_1$schema,
								jsonSchema: { "type": "boolean" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/setEnabled:enabled",
								create: dsh_plugin_project_mode_projectMode_setEnabled_parameter_1_strict$schema,
								jsonSchema: { "type": "boolean" }
							}
						},
						{
							name: "expectedRevision",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/setEnabled:expectedRevision",
								create: dsh_plugin_project_mode_projectMode_setEnabled_parameter_2$schema,
								jsonSchema: { "type": "number" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/setEnabled:expectedRevision",
								create: dsh_plugin_project_mode_projectMode_setEnabled_parameter_2_strict$schema,
								jsonSchema: { "type": "number" }
							}
						},
						{
							name: "requestId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/setEnabled:requestId",
								create: dsh_plugin_project_mode_projectMode_setEnabled_parameter_3$schema,
								jsonSchema: { "type": "string" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/setEnabled:requestId",
								create: dsh_plugin_project_mode_projectMode_setEnabled_parameter_3_strict$schema,
								jsonSchema: { "type": "string" }
							}
						}
					],
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode/shared#SessionModeView",
						create: dsh_plugin_project_mode_projectMode_setEnabled_result$schema,
						jsonSchema: {
							"type": "object",
							"properties": {
								"sessionId": { "type": "string" },
								"role": {
									"type": "string",
									"enum": [
										"coordinator",
										"ordinary",
										"worker"
									]
								},
								"enabled": { "type": "boolean" },
								"modeLocked": {
									"type": "boolean",
									"enum": [false, true]
								},
								"projectId": { "type": "string" },
								"coordinatorSessionId": { "type": "string" },
								"paths": {
									"type": "object",
									"properties": {
										"root": { "type": "string" },
										"context": { "type": "string" },
										"notes": { "type": "string" },
										"archived": { "type": "string" },
										"index": {
											"type": "string",
											"description": "New index; older records are resolved without rewriting their documents."
										}
									},
									"required": [
										"root",
										"context",
										"notes",
										"archived"
									],
									"additionalProperties": true
								},
								"revision": { "type": "number" },
								"canToggle": { "type": "boolean" },
								"toggleBlockedReason": {
									"type": "string",
									"enum": [
										"session-mode-locked",
										"agent-running",
										"workers-active",
										"results-pending",
										"worker-session",
										"runtime-unavailable"
									]
								}
							},
							"required": [
								"sessionId",
								"role",
								"enabled",
								"revision",
								"canToggle"
							],
							"additionalProperties": true
						}
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 936,
						"column": 9
					}
				},
				"projectMode/snapshot": {
					service: "projectMode",
					invocation: { kind: "direct" },
					parameters: [{
						name: "sessionId",
						source: "json",
						codec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_snapshot_parameter_0$schema,
							jsonSchema: { "type": "string" }
						},
						strictCodec: {
							mode: "strict",
							typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
							create: dsh_plugin_project_mode_projectMode_snapshot_parameter_0_strict$schema,
							jsonSchema: { "type": "string" }
						}
					}],
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode#projectMode/snapshot:result",
						create: dsh_plugin_project_mode_projectMode_snapshot_result$schema,
						jsonSchema: { "oneOf": [{
							"type": "null",
							"const": null
						}, {
							"type": "object",
							"properties": {
								"project": {
									"type": "object",
									"properties": {
										"version": {
											"type": "number",
											"const": 1
										},
										"id": { "type": "string" },
										"coordinatorSessionId": { "type": "string" },
										"workspaceId": { "type": "string" },
										"workspacePath": { "type": "string" },
										"paths": {
											"type": "object",
											"properties": {
												"root": { "type": "string" },
												"context": { "type": "string" },
												"notes": { "type": "string" },
												"archived": { "type": "string" },
												"index": {
													"type": "string",
													"description": "New index; older records are resolved without rewriting their documents."
												}
											},
											"required": [
												"root",
												"context",
												"notes",
												"archived"
											],
											"additionalProperties": true
										},
										"mode": {
											"type": "string",
											"enum": ["enabled", "disabled"]
										},
										"modeLocked": {
											"type": "boolean",
											"enum": [false, true],
											"description": "Project identity becomes permanent when this Session starts a turn."
										},
										"revision": { "type": "number" },
										"createdAt": { "type": "number" },
										"updatedAt": { "type": "number" }
									},
									"required": [
										"version",
										"id",
										"coordinatorSessionId",
										"workspacePath",
										"paths",
										"mode",
										"revision",
										"createdAt",
										"updatedAt"
									],
									"additionalProperties": true
								},
								"workers": {
									"type": "array",
									"items": {
										"type": "object",
										"properties": {
											"workerId": { "type": "string" },
											"parentSessionId": {
												"type": "string",
												"description": "Actual native direct parent; older direct-child snapshots omit this field."
											},
											"name": { "type": "string" },
											"lifecycle": {
												"type": "string",
												"enum": [
													"provisioning",
													"active",
													"deleting",
													"deleted",
													"provision-failed"
												]
											},
											"status": { "oneOf": [{
												"type": "null",
												"const": null
											}, {
												"type": "string",
												"enum": ["busy", "idle"]
											}] },
											"availability": {
												"type": "string",
												"enum": [
													"live",
													"cold",
													"unavailable"
												]
											},
											"queueLength": { "oneOf": [{
												"type": "null",
												"const": null
											}, { "type": "number" }] },
											"pendingSteerCount": { "oneOf": [{
												"type": "null",
												"const": null
											}, { "type": "number" }] },
											"phase": {
												"type": "string",
												"enum": [
													"idle",
													"starting",
													"working",
													"waiting-user",
													"stopping",
													"failed",
													"stopped",
													"disconnected"
												]
											},
											"progressText": { "type": "string" },
											"updatedAt": { "type": "number" },
											"activity": {
												"oneOf": [{
													"type": "null",
													"const": null
												}, {
													"type": "object",
													"properties": {
														"observedThroughSeq": { "type": "number" },
														"latestInput": {
															"type": "object",
															"properties": {
																"messageId": { "type": "string" },
																"actor": {
																	"type": "string",
																	"enum": [
																		"user",
																		"coordinator",
																		"other"
																	]
																},
																"text": { "type": "string" },
																"truncated": { "type": "boolean" },
																"state": {
																	"type": "string",
																	"enum": [
																		"committed",
																		"pending-steer",
																		"pending-queue"
																	]
																},
																"seq": {
																	"type": "number",
																	"description": "Native admission/edit position, or committed message position."
																},
																"time": { "type": "number" }
															},
															"required": [
																"messageId",
																"actor",
																"text",
																"truncated",
																"state",
																"seq",
																"time"
															],
															"additionalProperties": true,
															"description": "Latest committed task/dialogue input, not a guessed task summary."
														},
														"lastUserInput": {
															"type": "object",
															"properties": {
																"messageId": { "type": "string" },
																"actor": {
																	"type": "string",
																	"enum": [
																		"user",
																		"coordinator",
																		"other"
																	]
																},
																"text": { "type": "string" },
																"truncated": { "type": "boolean" },
																"state": {
																	"type": "string",
																	"enum": [
																		"committed",
																		"pending-steer",
																		"pending-queue"
																	]
																},
																"seq": {
																	"type": "number",
																	"description": "Native admission/edit position, or committed message position."
																},
																"time": { "type": "number" }
															},
															"required": [
																"messageId",
																"actor",
																"text",
																"truncated",
																"state",
																"seq",
																"time"
															],
															"additionalProperties": true,
															"description": "Most recent committed or still-pending human input; excludes withdrawn input."
														},
														"pendingUserInputs": {
															"type": "array",
															"items": {
																"type": "object",
																"properties": {
																	"messageId": { "type": "string" },
																	"actor": {
																		"type": "string",
																		"enum": [
																			"user",
																			"coordinator",
																			"other"
																		]
																	},
																	"text": { "type": "string" },
																	"truncated": { "type": "boolean" },
																	"state": {
																		"type": "string",
																		"enum": [
																			"committed",
																			"pending-steer",
																			"pending-queue"
																		]
																	},
																	"seq": {
																		"type": "number",
																		"description": "Native admission/edit position, or committed message position."
																	},
																	"time": { "type": "number" }
																},
																"required": [
																	"messageId",
																	"actor",
																	"text",
																	"truncated",
																	"state",
																	"seq",
																	"time"
																],
																"additionalProperties": true
															}
														},
														"pendingUserInputCount": { "type": "number" }
													},
													"required": [
														"observedThroughSeq",
														"pendingUserInputs",
														"pendingUserInputCount"
													],
													"additionalProperties": true
												}],
												"description": "Present on list/get; null means native activity could not be observed."
											}
										},
										"required": [
											"workerId",
											"name",
											"lifecycle",
											"status",
											"availability",
											"queueLength",
											"pendingSteerCount",
											"phase",
											"updatedAt"
										],
										"additionalProperties": true
									}
								},
								"turnMemberships": {
									"type": "array",
									"items": {
										"type": "object",
										"properties": {
											"projectId": { "type": "string" },
											"coordinatorSessionId": { "type": "string" },
											"coordinatorTurn": { "type": "number" },
											"segmentStartSeq": {
												"type": "number",
												"description": "Native human user/message (or turn/start fallback) seq; never a business turn."
											},
											"participationSeq": {
												"type": "number",
												"description": "Native coordinator evidence at the first accepted assignment/result."
											},
											"participationKind": {
												"type": "string",
												"enum": [
													"spawn",
													"send",
													"result"
												]
											},
											"completionIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"workerId": { "type": "string" },
											"firstOperationId": { "type": "string" },
											"firstCallId": { "type": "string" },
											"order": { "type": "number" }
										},
										"required": [
											"projectId",
											"coordinatorSessionId",
											"coordinatorTurn",
											"workerId",
											"firstOperationId",
											"firstCallId",
											"order"
										],
										"additionalProperties": true
									}
								},
								"closedTurnOutcomes": {
									"type": "array",
									"items": {
										"type": "object",
										"properties": {
											"coordinatorSessionId": { "type": "string" },
											"coordinatorTurn": { "type": "number" },
											"segmentStartSeq": { "type": "number" },
											"workerId": { "type": "string" },
											"status": {
												"type": "string",
												"enum": [
													"deleted",
													"failed",
													"stopped",
													"completed",
													"continued"
												]
											},
											"completionIds": {
												"type": "array",
												"items": { "type": "string" }
											},
											"lastResultMessageId": { "type": "string" },
											"lastResultSeq": { "type": "number" },
											"summary": { "type": "string" }
										},
										"required": [
											"coordinatorSessionId",
											"coordinatorTurn",
											"workerId",
											"status",
											"completionIds"
										],
										"additionalProperties": true
									}
								},
								"coordinatorTurn": { "oneOf": [{
									"type": "null",
									"const": null
								}, {
									"type": "object",
									"properties": {
										"sessionId": { "type": "string" },
										"turn": { "type": "number" },
										"phase": {
											"type": "string",
											"enum": [
												"working",
												"failed",
												"waiting-workers",
												"reviewing-results",
												"closing",
												"closed",
												"interrupted"
											]
										},
										"workerIds": {
											"type": "array",
											"items": { "type": "string" }
										},
										"unresolvedOperationIds": {
											"type": "array",
											"items": { "type": "string" }
										},
										"pendingAssignmentIds": {
											"type": "array",
											"items": { "type": "string" }
										},
										"runningWorkerIds": {
											"type": "array",
											"items": { "type": "string" }
										},
										"queuedWorkerIds": {
											"type": "array",
											"items": { "type": "string" }
										},
										"undeliveredCompletionIds": {
											"type": "array",
											"items": { "type": "string" }
										},
										"unconsumedCompletionIds": {
											"type": "array",
											"items": { "type": "string" }
										},
										"pendingSteerCount": { "type": "number" },
										"revision": { "type": "number" }
									},
									"required": [
										"sessionId",
										"turn",
										"phase",
										"workerIds",
										"unresolvedOperationIds",
										"pendingAssignmentIds",
										"runningWorkerIds",
										"queuedWorkerIds",
										"undeliveredCompletionIds",
										"unconsumedCompletionIds",
										"pendingSteerCount",
										"revision"
									],
									"additionalProperties": true
								}] },
								"streamEpoch": { "type": "string" },
								"revision": { "type": "number" }
							},
							"required": [
								"project",
								"workers",
								"turnMemberships",
								"closedTurnOutcomes",
								"coordinatorTurn",
								"streamEpoch",
								"revision"
							],
							"additionalProperties": true
						}] }
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 787,
						"column": 9
					}
				},
				"projectMode/timeline": {
					service: "projectMode",
					mode: "stream",
					invocation: { kind: "direct" },
					parameters: [
						{
							name: "sessionId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_timeline_parameter_0$schema,
								jsonSchema: { "type": "string" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_timeline_parameter_0_strict$schema,
								jsonSchema: { "type": "string" }
							}
						},
						{
							name: "workerId",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_timeline_parameter_1$schema,
								jsonSchema: { "type": "string" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "@deepseek-ai/dsh-session/types#SessionId",
								create: dsh_plugin_project_mode_projectMode_timeline_parameter_1_strict$schema,
								jsonSchema: { "type": "string" }
							}
						},
						{
							name: "limit",
							source: "json",
							codec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/timeline:limit",
								create: dsh_plugin_project_mode_projectMode_timeline_parameter_2$schema,
								jsonSchema: { "type": "number" }
							},
							strictCodec: {
								mode: "strict",
								typeSymbol: "dsh-plugin-project-mode#projectMode/timeline:limit",
								create: dsh_plugin_project_mode_projectMode_timeline_parameter_2_strict$schema,
								jsonSchema: { "type": "number" }
							}
						}
					],
					cancellation: { parameter: "signal" },
					result: {
						mode: "strict",
						typeSymbol: "dsh-plugin-project-mode/shared#WorkerTimelinePage",
						create: dsh_plugin_project_mode_projectMode_timeline_result$schema,
						jsonSchema: {
							"type": "object",
							"properties": {
								"workerId": { "type": "string" },
								"cwd": { "type": "string" },
								"status": { "oneOf": [{
									"type": "null",
									"const": null
								}, {
									"type": "string",
									"enum": ["busy", "idle"]
								}] },
								"total": { "type": "number" },
								"hasMore": { "type": "boolean" },
								"observedThroughSeq": { "type": "number" },
								"turns": {
									"type": "array",
									"items": {
										"type": "object",
										"properties": {
											"turn": { "type": "number" },
											"startedAt": { "type": "number" },
											"finishedAt": { "type": "number" },
											"outcome": { "oneOf": [{
												"type": "null",
												"const": null
											}, { "type": "string" }] },
											"inputs": {
												"type": "array",
												"items": {
													"type": "object",
													"properties": {
														"id": { "type": "string" },
														"seq": { "type": "number" },
														"time": { "type": "number" },
														"text": { "type": "string" },
														"actor": {
															"type": "string",
															"enum": [
																"user",
																"coordinator",
																"agent"
															]
														}
													},
													"required": [
														"id",
														"seq",
														"time",
														"text"
													],
													"additionalProperties": true
												}
											},
											"outputs": {
												"type": "array",
												"items": {
													"type": "object",
													"properties": {
														"id": { "type": "string" },
														"seq": { "type": "number" },
														"time": { "type": "number" },
														"text": { "type": "string" },
														"actor": {
															"type": "string",
															"enum": [
																"user",
																"coordinator",
																"agent"
															]
														}
													},
													"required": [
														"id",
														"seq",
														"time",
														"text"
													],
													"additionalProperties": true
												}
											},
											"artifacts": {
												"type": "array",
												"items": {
													"type": "object",
													"properties": {
														"path": { "type": "string" },
														"description": { "type": "string" },
														"kind": {
															"type": "string",
															"enum": ["presented", "changed"]
														},
														"seq": { "type": "number" },
														"time": { "type": "number" }
													},
													"required": [
														"path",
														"kind",
														"seq",
														"time"
													],
													"additionalProperties": true
												}
											}
										},
										"required": [
											"turn",
											"startedAt",
											"outcome",
											"inputs",
											"outputs",
											"artifacts"
										],
										"additionalProperties": true
									}
								}
							},
							"required": [
								"workerId",
								"status",
								"total",
								"hasMore",
								"observedThroughSeq",
								"turns"
							],
							"additionalProperties": true
						}
					},
					sourceLocation: {
						"file": "packages/project-mode/src/host/index.ts",
						"line": 900,
						"column": 10
					}
				}
			}
		}, zod.z);
		// src/client/store.ts
		const EMPTY = Object.freeze([]);
		/** Reconcile JSON views without replacing unchanged rows or arrays. */
		function reuse(before, after) {
			if (Object.is(before, after)) return after;
			if (Array.isArray(before) && Array.isArray(after)) {
				const next = after.map((v, i) => reuse(before[i], v));
				return before.length === next.length && next.every((v, i) => v === before[i]) ? before : next;
			}
			if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
				const a = before, b = after, next = {};
				let same = Object.keys(a).length === Object.keys(b).length;
				for (const k of Object.keys(b)) {
					next[k] = reuse(a[k], b[k]);
					same &&= next[k] === a[k];
				}
				return same ? before : next;
			}
			return after;
		}
		/** One derived Project cache shared by every sidebar row and turn capsule. */
		var ProjectStore = class {
			throttle;
			values = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			turns = /* @__PURE__ */ new Map();
			pending = /* @__PURE__ */ new Map();
			timer;
			stopped = false;
			constructor(throttle = 150) {
				this.throttle = throttle;
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			project = (sessionId) => this.values.get(sessionId);
			projects = () => [...this.values.values()];
			accept(value) {
				if (this.stopped) return;
				const id = value.project.coordinatorSessionId, before = this.values.get(id);
				if (before?.streamEpoch === value.streamEpoch && before.revision > value.revision) return;
				this.pending.delete(id);
				const next = reuse(before, value);
				if (next === before) return;
				this.values.set(id, next);
				for (const l of this.listeners) l();
			}
			push(value) {
				const before = this.values.get(value.project.coordinatorSessionId);
				const metadata = (s) => ({
					...s,
					workers: s.workers.map(({ progressText, updatedAt, ...w }) => w)
				});
				if (!before || JSON.stringify(metadata(before)) !== JSON.stringify(metadata(value))) {
					this.pending.delete(value.project.coordinatorSessionId);
					this.accept(value);
					return;
				}
				this.pending.set(value.project.coordinatorSessionId, value);
				if (this.timer === void 0) this.timer = setTimeout(() => {
					this.timer = void 0;
					const values = [...this.pending.values()];
					this.pending.clear();
					for (const v of values) this.accept(v);
				}, this.throttle);
			}
			turn(sessionId, turn, closed, segmentStartSeq) {
				const project = this.values.get(sessionId);
				if (!project) return EMPTY;
				const cacheKey = `${sessionId}:${turn}:${closed}:${segmentStartSeq ?? "legacy"}`, before = this.turns.get(cacheKey);
				const published = closed ? this.turns.get(`${sessionId}:${turn}:false:${segmentStartSeq ?? "legacy"}`) : void 0;
				const list = project.turnMemberships.filter((m) => m.coordinatorTurn === turn && (segmentStartSeq === void 0 || m.segmentStartSeq === segmentStartSeq)).sort((a, b) => a.order - b.order).flatMap((m) => {
					const w = project.workers.find((w) => w.workerId === m.workerId);
					const outcome = project.closedTurnOutcomes.find((o) => o.coordinatorTurn === turn && o.workerId === m.workerId && o.segmentStartSeq === m.segmentStartSeq);
					if (!w || w.lifecycle === "deleted" || outcome?.status === "deleted") return [];
					if (closed && !outcome) {
						const retained = (before ?? published)?.find((c) => c.workerId === m.workerId);
						return retained ? [retained] : [];
					}
					return [{
						key: `${sessionId}:${turn}:${m.segmentStartSeq === void 0 ? "" : `${m.segmentStartSeq}:`}${m.workerId}`,
						workerId: m.workerId,
						name: w?.name ?? m.workerId,
						status: closed && outcome.status !== "continued" ? outcome.status : w.phase,
						text: closed && outcome.status !== "continued" ? outcome.summary : w.progressText,
						queueLength: closed && outcome.status !== "continued" ? null : w.queueLength,
						address: {
							parentSessionId: w?.parentSessionId ?? sessionId,
							childSessionId: m.workerId,
							mode: "continuable"
						}
					}];
				});
				const next = reuse(before, list.length ? list : EMPTY);
				this.turns.set(cacheKey, next);
				return next;
			}
			dispose() {
				this.stopped = true;
				if (this.timer !== void 0) clearTimeout(this.timer);
				this.pending.clear();
				this.listeners.clear();
				this.turns.clear();
				this.values.clear();
			}
		};
		// src/client/runtime.ts
		const INITIAL = { busy: false };
		/** Remote namespace is generated from the actual Host FaceModel. */
		var ProjectClient = class {
			remote;
			store = new ProjectStore();
			frameVersions = /* @__PURE__ */ new Map();
			generation = 0;
			catalogRequest = 0;
			roots = /* @__PURE__ */ new Set();
			feeds = /* @__PURE__ */ new Map();
			modes = /* @__PURE__ */ new Map();
			modeListeners = /* @__PURE__ */ new Set();
			requests = /* @__PURE__ */ new Map();
			stopped = false;
			error;
			catalogState = "loading";
			modeVersion = 0;
			connectionVersion = 0;
			constructor(remote) {
				this.remote = remote;
			}
			followWorkerParent(workerId, signal) {
				const project = this.store.projects().find((project) => project.project.mode === "enabled" && project.workers.some((worker) => worker.workerId === workerId && worker.lifecycle === "active"));
				if (!project) throw new Error("project-mode/not-owned");
				return this.remote.followWorkerParent(project.project.coordinatorSessionId, workerId, signal);
			}
			subscribeModes = (listener) => {
				this.modeListeners.add(listener);
				return () => {
					this.modeListeners.delete(listener);
				};
			};
			mode = (id) => this.modes.get(id) ?? INITIAL;
			setMode(id, state) {
				this.modeVersion++;
				this.modes.set(id, reuse(this.modes.get(id), state));
				for (const l of this.modeListeners) l();
			}
			async refreshMode(id, actionError) {
				if (this.stopped || this.mode(id).busy) return;
				const request = (this.requests.get(id) ?? 0) + 1;
				this.requests.set(id, request);
				if (actionError) this.setMode(id, {
					...this.mode(id),
					busy: true,
					error: actionError
				});
				try {
					const r = await this.remote.mode(id);
					if (this.stopped || this.requests.get(id) !== request) return;
					this.setMode(id, r.ok ? {
						value: r.value,
						busy: false,
						...actionError ? { error: actionError } : {}
					} : {
						...this.mode(id),
						busy: false,
						error: actionError ?? r.error.message
					});
				} catch (e) {
					if (!this.stopped && this.requests.get(id) === request) this.setMode(id, {
						...this.mode(id),
						busy: false,
						error: actionError ?? message(e)
					});
				}
			}
			async toggle(id, enabled) {
				const state = this.mode(id);
				if (state.busy || !state.value?.canToggle) return;
				this.requests.set(id, (this.requests.get(id) ?? 0) + 1);
				this.setMode(id, {
					...state,
					busy: true,
					error: void 0
				});
				try {
					const r = await this.remote.setEnabled(id, enabled, state.value.revision, crypto.randomUUID());
					if (this.stopped) return;
					this.setMode(id, r.ok ? {
						value: r.value,
						busy: false
					} : {
						...state,
						busy: false,
						error: r.error.message
					});
					if (r.ok) {
						await this.loadCatalog();
						await this.refreshMode(id);
					} else await this.refreshMode(id, r.error.message);
				} catch (e) {
					if (!this.stopped) {
						this.setMode(id, {
							...state,
							busy: false,
							error: message(e)
						});
						await this.refreshMode(id, message(e));
					}
				}
			}
			watchRoots(ids) {
				this.roots = new Set(ids);
				this.reconcile();
			}
			reconcile() {
				if (this.stopped) return;
				for (const [id, feed] of this.feeds) if (!this.roots.has(id)) {
					this.stopFeed(feed);
					this.feeds.delete(id);
				}
				for (const id of this.roots) if (!this.feeds.has(id)) this.startFeed(id);
			}
			startFeed(id) {
				const feed = { abort: new AbortController() };
				this.feeds.set(id, feed);
				(async () => {
					try {
						feed.stream = this.remote.follow(id, feed.abort.signal);
						for await (const frame of feed.stream) {
							if (feed.abort.signal.aborted || this.stopped) return;
							this.frameVersions.set(id, (this.frameVersions.get(id) ?? 0) + 1);
							this.store.push(frame.value);
							this.error = void 0;
						}
					} catch (e) {
						if (!feed.abort.signal.aborted && !this.stopped) this.error = message(e);
					} finally {
						feed.stream?.dispose();
						if (!feed.abort.signal.aborted && !this.stopped && this.roots.has(id)) feed.retry = setTimeout(() => {
							this.feeds.delete(id);
							this.startFeed(id);
						}, 1e3);
					}
				})();
			}
			async loadCatalog() {
				const generation = this.generation, request = ++this.catalogRequest, observed = new Map(this.frameVersions);
				const current = () => !this.stopped && generation === this.generation && request === this.catalogRequest;
				try {
					const result = await this.remote.catalog();
					if (!current()) return;
					if (!result.ok) {
						this.error = result.error.message;
						this.catalogState = "error";
						for (const l of this.modeListeners) l();
						return;
					}
					this.catalogState = "ready";
					this.error = void 0;
					for (const s of result.value) {
						const id = s.project.coordinatorSessionId;
						if ((observed.get(id) ?? 0) === (this.frameVersions.get(id) ?? 0)) this.store.accept(s);
					}
					for (const l of this.modeListeners) l();
				} catch (e) {
					if (current()) {
						this.error = message(e);
						this.catalogState = "error";
						for (const l of this.modeListeners) l();
					}
				}
			}
			reconnect() {
				this.connectionVersion++;
				this.generation++;
				for (const f of this.feeds.values()) this.stopFeed(f);
				this.feeds.clear();
				this.reconcile();
				this.loadCatalog();
				for (const id of this.modes.keys()) this.refreshMode(id);
			}
			stopFeed(feed) {
				feed.abort.abort();
				feed.stream?.dispose();
				if (feed.retry !== void 0) clearTimeout(feed.retry);
			}
			dispose() {
				this.stopped = true;
				for (const f of this.feeds.values()) this.stopFeed(f);
				this.feeds.clear();
				this.store.dispose();
				this.modeListeners.clear();
			}
		};
		function message(error) {
			return error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
		}
		// src/client/input-policy.ts
		/** Bind enabled coordinators to the native composer's busy Steer preference. */
		function bindCoordinatorInputPolicy(client, submission, sessions) {
			if (typeof submission?.register !== "function") throw new Error("MoA+ requires the native composer submission compatibility API; apply the approved local DSH compatibility patch before enabling the plugin.");
			const installed = /* @__PURE__ */ new Map();
			const reconcile = () => {
				const candidates = /* @__PURE__ */ new Set([...sessions.getSnapshot().ids, ...client.store.projects().map((p) => p.project.coordinatorSessionId)]);
				const enabled = /* @__PURE__ */ new Set();
				for (const id of candidates) {
					const project = client.store.project(id)?.project, mode = client.mode(id).value;
					if (mode && (!project || mode.revision >= project.revision) ? mode.role === "coordinator" && mode.enabled : project?.mode === "enabled") enabled.add(id);
				}
				for (const [id, restore] of installed) {
					if (enabled.has(id)) continue;
					restore();
					installed.delete(id);
				}
				for (const id of enabled) if (!installed.has(id)) installed.set(id, submission.register(id, "steer"));
			};
			const unsubscribe = [
				client.store.subscribe(reconcile),
				client.subscribeModes(reconcile),
				sessions.subscribe(reconcile)
			];
			reconcile();
			return () => {
				for (const off of unsubscribe) off();
				for (const restore of installed.values()) restore();
				installed.clear();
			};
		}
		// src/client/worker-parent.ts
		/** Native child input needs its parent Agent; opening the parent restores it without a prompt. */
		function bindWorkerParents(client, sessions) {
			const held = /* @__PURE__ */ new Map();
			const nested = /* @__PURE__ */ new Map();
			const releaseNested = (slot) => {
				slot.abort.abort();
				slot.stream?.dispose();
			};
			const reconcile = () => {
				const { byId } = sessions.list.getSnapshot();
				const needed = /* @__PURE__ */ new Set();
				const neededNested = /* @__PURE__ */ new Set();
				for (const project of client.store.projects()) {
					if (project.project.mode !== "enabled") continue;
					for (const worker of project.workers) {
						if (worker.lifecycle !== "active" || !Object.entries(byId[worker.workerId]?.retainedBy ?? {}).some(([source, count]) => (source === "mainView" || source === "sidebarChat") && count > 0)) continue;
						needed.add(project.project.coordinatorSessionId);
						if (worker.parentSessionId && worker.parentSessionId !== project.project.coordinatorSessionId) neededNested.add(worker.workerId);
					}
				}
				for (const [id, lease] of held) {
					if (needed.has(id)) continue;
					held.delete(id);
					lease.reference?.release();
				}
				for (const id of needed) {
					if (held.has(id)) continue;
					const lease = {};
					held.set(id, lease);
					try {
						const reference = sessions.retain(id, { source: "projectModeParent" });
						if (held.get(id) !== lease) reference.release();
						else lease.reference = reference;
						reference.ready.catch((error) => console.error("Project Mode: parent opening failed", error));
					} catch (error) {
						if (held.get(id) === lease) held.delete(id);
						console.error("Project Mode: parent acquisition failed", error);
					}
				}
				for (const [id, slot] of nested) {
					if (neededNested.has(id) && slot.version === client.connectionVersion) continue;
					nested.delete(id);
					releaseNested(slot);
				}
				for (const id of neededNested) {
					if (nested.has(id)) continue;
					const slot = {
						abort: new AbortController(),
						version: client.connectionVersion
					};
					nested.set(id, slot);
					(async () => {
						try {
							slot.stream = client.followWorkerParent(id, slot.abort.signal);
							for await (const _ready of slot.stream) if (slot.abort.signal.aborted) return;
						} catch (error) {
							if (!slot.abort.signal.aborted) console.error("MoA+: nested parent opening failed", error);
						}
					})();
				}
			};
			const unsubscribe = [
				client.store.subscribe(reconcile),
				sessions.list.subscribe(reconcile),
				client.subscribeModes(reconcile)
			];
			reconcile();
			return () => {
				for (const off of unsubscribe) off();
				for (const lease of held.values()) lease.reference?.release();
				held.clear();
				for (const slot of nested.values()) releaseNested(slot);
				nested.clear();
			};
		}
		// ../../node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js
		/**
		* The `dsh-resource://file/…` address grammar: how a file is named across the
		* Sidebar and the resource model, built and parsed without touching a
		* filesystem.
		* @module
		*/
		/** The scheme and type every file address opens with. */
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
		function encodeSegment(segment) {
			return encodeURIComponent(segment).replace(/%3A/gi, ":");
		}
		/** Encode a `/`-separated path segment by segment. */
		function encodePath(path) {
			return path.split("/").map(encodeSegment).join("/");
		}
		/**
		* Build the address of a file read through one Session.
		* @param sessionId - the Session whose Host workspace resolves the path.
		* @param path - absolute or workspace-relative path; backslashes are normalized to `/`, and leading `./` prefixes are dropped.
		* @returns the `dsh-resource://file/session/<sessionId>/<path>` address.
		*/
		function sessionFileAddress(sessionId, path) {
			const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
		}
		/**
		* Browser-safe Workspace path and display helpers.
		* @module @deepseek-ai/dsh-util-workspace-path
		*/
		/** Whether a path uses a Windows drive or UNC prefix. */
		function isWindowsStylePath(value) {
			return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
		}
		/**
		* Whether a path is absolute in either spelling the Host accepts: POSIX (`/a/b`) or Windows drive or UNC.
		* @param path - the path to classify.
		* @returns `true` for an absolute path; `false` for a Workspace-relative one.
		*/
		function isAbsoluteWorkspacePath(path) {
			return path.startsWith("/") || isWindowsStylePath(path);
		}
		/**
		* The address for a path as a caller holds it: a relative path, or an absolute
		* path inside the Session's workspace, becomes a `session`-scoped address; an
		* absolute path outside it, or one whose workspace root is unknown, keeps its
		* absolute path in that Session's address.
		* @param sessionId - the Session the path is read in.
		* @param cwd - that Session's workspace root, when known.
		* @param path - absolute or workspace-relative path, in either separator spelling.
		* @returns the `dsh-resource://file/…` address.
		*/
		function fileAddressFor(sessionId, cwd, path) {
			const normalized = path.replace(/\\/g, "/");
			if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
			const root = cwd === void 0 ? "" : cwd.replace(/\\/g, "/").replace(/\/+$/, "");
			if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
			if (root !== "" && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
			return sessionFileAddress(sessionId, normalized);
		}
		// src/client/hooks.ts
		/** Stable selected snapshot prevents unrelated token frames from rendering a row. */
		function useSelected(subscribe, select) {
			const ref = (0, react.useRef)();
			const get = () => {
				const value = reuse(ref.current?.value, select());
				ref.current = { value };
				return value;
			};
			return (0, react.useSyncExternalStore)(subscribe, get, get);
		}
		// src/client/tree.ts
		function projectForSession(client, id) {
			return client.store.project(id) ?? client.store.projects().find((p) => p.workers.some((w) => w.workerId === id));
		}
		function workerReadOnly(projects, id) {
			for (const p of projects) {
				const worker = p.workers.find((w) => w.workerId === id);
				if (worker && (worker.lifecycle === "deleted" || worker.lifecycle === "deleting" || p.project.mode === "disabled")) return {
					parent: p.project.coordinatorSessionId,
					reason: worker.lifecycle === "deleted" || worker.lifecycle === "deleting" ? "deleted" : "disabled"
				};
			}
		}
		/** Override native input only for established, inactive Project membership. */
		function composerMatch(owner, client) {
			const address = owner.session?.subagent?.address;
			if (!address || address.mode !== "continuable" || !owner.sessionId) return null;
			const id = owner.sessionId, parent = address.parentSessionId, projects = client.store.projects();
			const readonly = workerReadOnly(projects, id);
			if (readonly) return {
				id,
				...readonly
			};
			if (projects.some((p) => p.workers.some((w) => w.workerId === id))) return null;
			const mode = client.mode(id).value;
			const project = client.store.project(parent);
			if (mode?.role === "worker" && mode.coordinatorSessionId === parent && project) return {
				id,
				parent,
				reason: project.project.mode === "disabled" ? "disabled" : "deleted"
			};
			return null;
		}
		// src/shared/worker-membership.ts
		/** Public membership excludes removed Workers and creation-only placeholders. */
		function isVisibleWorker(worker) {
			return worker.lifecycle !== "deleted" && worker.lifecycle !== "provision-failed";
		}
		// src/client/worker-icon.tsx
		const colors = [
			"#639fe8",
			"#76cdb0",
			"#b39aeb",
			"#e6ae6d",
			"#e597b8",
			"#70c4d5",
			"#c1c66e",
			"#e79585"
		];
		/** A worker's visual identity depends only on its immutable native Session ID. */
		const WorkerIcon = react.memo(function WorkerIcon({ workerId }) {
			let hash = 2166136261;
			for (let i = 0; i < workerId.length; i++) hash = Math.imul(hash ^ workerId.charCodeAt(i), 16777619) >>> 0;
			const shape = hash % 8;
			let motif;
			switch (shape) {
				case 0:
					motif = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [[
						0,
						90,
						180,
						270
					].map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "6.8",
						r: "5",
						transform: `rotate(${a} 12 12)`,
						opacity: ".7"
					}, a)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "3.1",
						opacity: ".95"
					})] });
					break;
				case 1:
					motif = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.25",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "12",
							cy: "12",
							r: "10"
						}), [
							0,
							60,
							120,
							180,
							240,
							300
						].map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
							cx: "12",
							cy: "8",
							rx: "3.5",
							ry: "5.5",
							transform: `rotate(${a} 12 12)`
						}, a))]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "3.3",
						opacity: ".7"
					})] });
					break;
				case 2:
					motif = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [[
						0,
						72,
						144,
						216,
						288
					].map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
						cx: "12",
						cy: "7.1",
						rx: "3.8",
						ry: "5.8",
						transform: `rotate(${a} 12 12)`,
						opacity: ".72"
					}, a)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "2.4",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.6"
					})] });
					break;
				case 3:
					motif = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [[
						0,
						60,
						120
					].map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
						cx: "12",
						cy: "12",
						rx: "10",
						ry: "4.6",
						transform: `rotate(${a} 12 12)`,
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.5"
					}, a)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "3.2"
					})] });
					break;
				case 4:
					motif = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [[
						0,
						90,
						180,
						270
					].map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M12 1.5 17 7 12 12.5 7 7Z",
						transform: `rotate(${a} 12 12)`,
						opacity: ".75"
					}, a)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "2.5"
					})] });
					break;
				case 5:
					motif = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [[
						0,
						45,
						90,
						135,
						180,
						225,
						270,
						315
					].map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M12 1.5 14.8 7.7 12 10 9.2 7.7Z",
						transform: `rotate(${a} 12 12)`,
						opacity: ".8"
					}, a)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "4",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.4"
					})] });
					break;
				case 6:
					motif = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [[
						0,
						60,
						120,
						180,
						240,
						300
					].map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "5",
						r: "3.4",
						transform: `rotate(${a} 12 12)`,
						opacity: ".75"
					}, a)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "3.4"
					})] });
					break;
				default: motif = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [[
					0,
					120,
					240
				].map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M12 12C1 13 2 3 9 2c5-.7 8 4 3 10Z",
					transform: `rotate(${a} 12 12)`,
					opacity: ".78"
				}, a)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "12",
					cy: "12",
					r: "2.4"
				})] });
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				className: "pm-worker-icon",
				viewBox: "0 0 24 24",
				width: "24",
				height: "24",
				fill: "currentColor",
				style: { color: colors[(hash >>> 8) % colors.length] },
				"aria-hidden": "true",
				focusable: "false",
				children: motif
			});
		});
		// src/client/panel-styles.ts
		const panelStyles = `
.pm-workers-panel{display:grid;grid-template-columns:minmax(128px,29%) minmax(0,1fr);height:100%;min-height:0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.pm-workers-panel *{box-sizing:border-box}
.pm-workers-panel-empty{display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}.pm-workers-panel-empty p{margin:0;max-width:28ch}
.pm-axis-preview{margin-top:4px}.pm-axis-preview>summary{display:block;list-style:none;cursor:pointer}.pm-axis-preview>summary::-webkit-details-marker{display:none}.pm-axis-preview>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:3px}
.pm-axis-preview:not([open])>summary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--dsw-alias-label-secondary,#999)}
.pm-workers-list{padding:12px 7px;border-right:1px solid var(--dsw-alias-border-primary,#8883);overflow:auto;min-width:0}
.pm-workers-list button{display:flex;align-items:center;gap:8px;width:100%;padding:9px 8px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.pm-workers-list button:hover,.pm-workers-list button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,#8882)}
.pm-panel-worker-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none}.pm-panel-worker-icon .pm-panel-running{position:absolute;left:-3px;top:-3px;pointer-events:none}
.pm-panel-worker-icon>.pm-worker-icon{width:16px;height:16px}.pm-axis-files time{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.pm-worker-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pm-worker-copy{min-width:0;flex:1}.pm-worker-phase{font-size:11px;color:var(--dsw-alias-label-secondary,#999);display:block;margin-top:2px}
.pm-worker-axis{overflow:auto;padding:18px 20px;min-width:0}.pm-worker-axis header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.pm-worker-axis h3{font-size:14px;margin:0;font-weight:600;overflow-wrap:anywhere}
.pm-worker-axis button,.pm-worker-axis a{font:inherit;color:var(--dsw-alias-label-link,#80a9ee);cursor:pointer}.pm-worker-axis button{border:0;background:transparent;padding:3px 0;text-align:left}
.pm-axis-turn{position:relative;border-left:1px solid var(--dsw-alias-border-primary,#8884);padding:0 0 24px 18px;margin-left:4px}.pm-axis-turn:before{content:"";position:absolute;left:-4px;top:5px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary,#999)}
.pm-axis-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:14px}.pm-axis-head strong{font-weight:600}.pm-axis-head time,.pm-axis-message time{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}.pm-axis-outcome{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.pm-axis-section{margin-top:14px}.pm-axis-section h4{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary,#999);margin:0 0 6px}.pm-axis-message{overflow-wrap:anywhere;margin:5px 0 12px;line-height:1.65}.pm-axis-message p:first-child{margin-top:4px}.pm-axis-files{list-style:none;padding:0;margin:0}.pm-axis-files li{margin:5px 0}.pm-axis-files small{display:block;color:var(--dsw-alias-label-secondary,#999);margin-top:3px;overflow-wrap:anywhere}
.pm-axis-empty{color:var(--dsw-alias-label-secondary,#999);padding:4px 0;line-height:1.6}.pm-axis-more{margin-left:22px}.pm-axis-error{color:var(--dsw-alias-label-secondary,#999);overflow-wrap:anywhere}
`;
		// src/client/worker-timeline.tsx
		function Timestamp({ time }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
				dateTime: new Date(time).toISOString(),
				children: new Date(time).toLocaleString(void 0, {
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit"
				})
			});
		}
		function MessagePreview({ text, labels }) {
			const [expanded, setExpanded] = react.useState(false);
			const preview = react.useMemo(() => (0, _deepseek_ai_dsh_client_ui_primitives.extractMarkdownPlainText)(text), [text]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("details", {
				className: "pm-axis-preview",
				onToggle: (event) => setExpanded(event.currentTarget.open),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
					text,
					labels,
					variant: "compact"
				}) : preview })
			});
		}
		function WorkersPanel({ client, open, timeline, sessionId, useTabInfo, t }) {
			const project = useSelected(client.store.subscribe, () => projectForSession(client, sessionId));
			const generation = useSelected(client.subscribeModes, () => client.connectionVersion);
			const { tab } = useTabInfo();
			const [chosen, choose] = react.useState();
			const axisRef = react.useRef(null);
			const workers = (project?.workers ?? []).filter(isVisibleWorker), worker = workers.find((w) => w.workerId === chosen) ?? workers[0];
			const nativeReady = worker?.lifecycle === "active" && worker.availability === "live";
			const [windowSize, setWindowSize] = react.useState(10), [retry, setRetry] = react.useState(0);
			const [state, setState] = react.useState();
			const labels = react.useMemo(() => ({
				code: {
					copyLabel: t("copy"),
					copiedLabel: t("copied")
				},
				footnotes: t("footnotes")
			}), [t]);
			react.useEffect(() => {
				if (!tab.visible || !project || !worker) return;
				const controller = new AbortController(), signal = AbortSignal.any([controller.signal, tab.signal]);
				const stream = timeline(project.project.coordinatorSessionId, worker.workerId, windowSize, signal);
				(async () => {
					try {
						for await (const page of stream) if (!signal.aborted) setState({
							workerId: worker.workerId,
							page
						});
					} catch (error) {
						if (!signal.aborted) setState({
							workerId: worker.workerId,
							error: error instanceof Error ? error.message : String(error),
							readyWhenFailed: nativeReady
						});
					} finally {
						stream.dispose();
					}
				})();
				return () => {
					controller.abort();
					stream.dispose();
				};
			}, [
				worker?.workerId,
				project?.project.coordinatorSessionId,
				project?.streamEpoch,
				tab.visible,
				tab.signal,
				windowSize,
				retry,
				generation
			]);
			const current = state?.workerId === worker?.workerId ? state : void 0, page = current?.page;
			react.useEffect(() => {
				if (current?.error && current.readyWhenFailed === false && nativeReady) setRetry((value) => value + 1);
			}, [
				worker?.workerId,
				current?.error,
				current?.readyWhenFailed,
				nativeReady
			]);
			if (!workers.length) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pm-workers-panel pm-workers-panel-empty",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: panelStyles }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "pm-axis-empty",
					children: t("noWorkers")
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pm-workers-panel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: panelStyles }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
						className: "pm-workers-list",
						"aria-label": t("workers"),
						children: workers.map((w) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							"aria-pressed": w.workerId === worker?.workerId,
							onClick: () => {
								choose(w.workerId);
								setWindowSize(10);
								if (axisRef.current) axisRef.current.scrollTop = 0;
							},
							title: w.name,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "pm-panel-worker-icon",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerIcon, { workerId: w.workerId }), (w.phase === "working" || w.phase === "starting" || w.phase === "stopping") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
									state: "ongoing",
									size: 22,
									className: "pm-panel-running"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "pm-worker-copy",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "pm-worker-name",
									children: w.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "pm-worker-phase",
									children: t(w.phase)
								})]
							})]
						}, w.workerId))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						ref: axisRef,
						className: "pm-worker-axis",
						"aria-label": t("timeline"),
						children: [
							worker && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: worker.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => open({
									parentSessionId: worker.parentSessionId ?? project.project.coordinatorSessionId,
									childSessionId: worker.workerId,
									mode: "continuable"
								}),
								children: t("openConversation")
							})] }),
							worker && !page && !current?.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "pm-axis-empty",
								children: t("loadingTimeline")
							}),
							current?.error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "pm-axis-error",
								role: "status",
								children: [
									current.error,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => setRetry((r) => r + 1),
										children: t("retry")
									})
								]
							}),
							page?.turns.map((turn) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: "pm-axis-turn",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "pm-axis-head",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("timelineTurn", { turn: turn.turn }) }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Timestamp, { time: turn.startedAt }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "pm-axis-outcome",
												children: t(turn.outcome === null ? "working" : turn.outcome === "handoff" ? "continued" : turn.outcome === "completed" ? "completed" : turn.outcome === "aborted" ? "stopped" : "failed")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "pm-axis-section",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("timelineInputs") }), turn.inputs.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "pm-axis-message",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Timestamp, { time: message.time }),
												" ·",
												" ",
												t(message.actor === "coordinator" ? "fromCoordinator" : message.actor === "agent" ? "fromAgent" : "fromUser"),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessagePreview, {
													text: message.text,
													labels
												})
											]
										}, message.id))]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "pm-axis-section",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("timelineOutputs") }),
											turn.outputs.map((message) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "pm-axis-message",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Timestamp, { time: message.time }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessagePreview, {
													text: message.text,
													labels
												})]
											}, message.id)),
											!turn.outputs.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "pm-axis-empty",
												children: t(turn.outcome === null ? "awaitingReply" : "emptyReply")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "pm-axis-section",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("timelineArtifacts") }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
												className: "pm-axis-files",
												children: turn.artifacts.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
														type: "button",
														title: file.path,
														onClick: () => tab.actions.openResource(fileAddressFor(worker.workerId, page.cwd, file.path)),
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FileTypeIcon, {
																path: file.path,
																size: 16
															}),
															" ",
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: file.path.split(/[\\/]/).at(-1) })
														]
													}),
													file.description && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: file.description }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Timestamp, { time: file.time })
												] }, file.path))
											}),
											!turn.artifacts.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "pm-axis-empty",
												children: t("noArtifacts")
											})
										]
									})
								]
							}, `${worker.workerId}:${turn.turn}`)),
							page && !page.turns.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "pm-axis-empty",
								children: t("noTurns")
							}),
							page?.hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "pm-axis-more",
								onClick: () => setWindowSize((n) => n + 10),
								children: t("loadEarlier")
							})
						]
					})
				]
			});
		}
		// src/client/panels.tsx
		const WORKERS = "project-mode-workers";
		function registerProjectPanels(ctx, client, open) {
			const initialized = /* @__PURE__ */ new Set();
			const shared = () => ({
				client,
				open,
				timeline: ctx.remote.projectMode.timeline.bind(ctx.remote.projectMode)
			});
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: WORKERS,
				kind: WORKERS,
				keepMounted: true,
				title: () => "Workers"
			}));
			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: WORKERS,
				locale: "project-mode",
				inject: shared
			}, WorkersPanel));
			ctx.slots.inject("conversation.session.header.views.actions", () => ctx.slots.register({
				name: "conversation.session.header.views.actions",
				id: "project-mode.open-panels",
				locale: "project-mode"
			}, function OpenPanels({ onDismiss, t }) {
				const sessionId = useSelected(ctx.sidebarRight.mounted.subscribe, ctx.sidebarRight.mounted.getSnapshot);
				const project = useSelected(client.store.subscribe, () => sessionId ? projectForSession(client, sessionId) : void 0);
				if (!sessionId || project?.project.mode !== "enabled") return null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
					onSelect: () => {
						onDismiss();
						ctx.sidebarRight.openTabIn(sessionId, WORKERS);
					},
					children: "Workers"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
					onSelect: () => {
						onDismiss();
						ctx.sidebarRight.openResourceIn(sessionId, fileAddressFor(project.project.coordinatorSessionId, project.project.workspacePath, project.project.paths.notes));
					},
					children: "notes.md"
				})] });
			}));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "project-mode.panels"
			}, function Defaults({ sessionId, useSession }) {
				const project = useSelected(client.store.subscribe, () => projectForSession(client, sessionId));
				const mounted = useSelected(ctx.sidebarRight.mounted.subscribe, ctx.sidebarRight.mounted.getSnapshot);
				const openState = useSession((s) => s.openState);
				const types = useSelected((listener) => ctx.sidebarRightTabs.subscribe(listener), () => ctx.sidebarRightTabs.entries());
				react.useEffect(() => {
					if (mounted !== sessionId || project?.project.mode !== "enabled") return;
					const marker = `project-mode.panels.v1.${sessionId}`;
					if (initialized.has(marker)) return;
					try {
						if (localStorage.getItem(marker)) return;
					} catch {}
					const frame = requestAnimationFrame(() => {
						if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return;
						const existing = ctx.sidebarRight.tabsIn(sessionId), previous = ctx.sidebarRight.active();
						const guide = existing.length === 1 && existing[0].kind === "guide" ? existing[0] : void 0;
						const notes = fileAddressFor(project.project.coordinatorSessionId, project.project.workspacePath, project.project.paths.notes);
						try {
							ctx.sidebarRightTabs.claim(notes);
						} catch {
							return;
						}
						ctx.sidebarRight.openTabIn(sessionId, WORKERS, guide ? { replaceTab: guide.id } : {});
						ctx.sidebarRight.openResourceIn(sessionId, notes);
						const tabs = ctx.sidebarRight.tabsIn(sessionId), workers = tabs.find((tab) => tab.kind === WORKERS);
						if (!workers || !tabs.some((tab) => tab.contentId === notes)) return;
						initialized.add(marker);
						ctx.sidebarRight.focus(previous && !guide ? previous.id : workers.id);
						try {
							localStorage.setItem(marker, "1");
						} catch {}
					});
					return () => cancelAnimationFrame(frame);
				}, [
					project?.project.id,
					project?.project.mode,
					project?.project.paths.notes,
					mounted,
					openState,
					sessionId,
					types
				]);
				return null;
			}));
		}
		// src/client/tail.ts
		function incoming(event) {
			if (event.type !== "user/message" || event.surfaceOp !== "append") return;
			const source = event.data.source;
			if (source.kind === "moa-message" || source.kind === "project-mode-result" || source.kind === "project-mode-assignment") return {
				source: event.data.source,
				content: event.data.content
			};
		}
		/** Human inputs split transcript placement without changing the native turn. */
		const humanBoundaryDefinition = {
			kind: "project-mode-human-boundary",
			match: (event) => event.type === "turn/start" || event.type === "user/message" && event.data.source.kind === "user" && event.surfaceOp === "append" ? {
				id: String(event.seq),
				role: "start"
			} : null,
			start: (_context, match) => ({ seq: match.event.seq }),
			update: (context) => context.state,
			publication: () => "none"
		};
		/**
		* A native step owns its own tail seat. Later steps never move an earlier seat
		* across a human message. Empty seats are hidden by native Chat layout.
		*/
		const workerTailDefinition = {
			kind: "project-mode-workers-tail",
			target: "chat",
			match(event) {
				if (event.type === "user/message" && incoming(event)) return {
					id: `${event.data.source.kind === "project-mode-result" ? "result" : "message"}:${event.data.id}`,
					role: "start",
					exclusive: true
				};
				if (event.type !== "assistant/live-chunk" && event.type !== "assistant/message" && event.type !== "tool/call" && event.type !== "tool/result") return null;
				if (!("turn" in event.data) || !("step" in event.data) || typeof event.data.turn !== "number" || typeof event.data.step !== "number") return null;
				return {
					id: `${event.data.turn}:${event.data.step}`,
					role: "start"
				};
			},
			start: (_context, match, reader) => ({
				seq: match.event.seq,
				...incoming(match.event) ? { incoming: incoming(match.event) } : {},
				segmentStartSeq: reader.previous(humanBoundaryDefinition.kind)?.state.seq ?? (match.location.kind === "turn" || match.location.kind === "step" ? match.location.turn.start?.seq : void 0) ?? 0
			}),
			update: (context, match) => ({
				...context.state,
				seq: Math.max(context.state.seq, match.event.seq)
			}),
			publication: (match) => match.event.type === "assistant/live-chunk" ? "animation-frame" : "immediate",
			buildViewNode(context) {
				const location = [context.start, ...context.matches].find((match) => match?.location.kind === "step")?.location;
				if (!context.state || location?.kind !== "step" && !context.state.incoming) {
					const previous = context.current.get("chat");
					return previous ? {
						...previous,
						visibility: "hidden"
					} : null;
				}
				return {
					key: context.key,
					id: context.id,
					kind: "project-mode-workers-tail",
					target: "chat",
					anchorSeq: context.state.seq + .2,
					location: location?.kind === "step" ? {
						kind: "turn",
						turn: location.turn
					} : context.start?.location ?? { kind: "unresolved" },
					visibility: "visible",
					groupTree: context.state.incoming ? "input" : "turn",
					data: {
						turn: location?.kind === "step" ? location.turn.turn : 0,
						step: location?.kind === "step" ? location.step.step : 0,
						segmentStartSeq: context.state.segmentStartSeq,
						...context.state.incoming ? { incoming: context.state.incoming } : {}
					}
				};
			}
		};
		/** Pick exactly one native seat at the bottom of each human transcript segment. */
		function segmentTail(snapshot, node) {
			if (node.visibility !== "visible" || node.data.turn === 0) return null;
			const { turn, segmentStartSeq } = node.data;
			return snapshot.nodes.values().filter((candidate) => candidate.kind === "project-mode-workers-tail" && candidate.visibility === "visible" && candidate.data.turn === turn && candidate.data.segmentStartSeq === segmentStartSeq).reduce((latest, candidate) => !latest || candidate.anchorSeq > latest.anchorSeq ? candidate : latest, void 0)?.key === node.key ? {
				turn,
				segmentStartSeq,
				closed: snapshot.timeline.turns.get(turn)?.end !== void 0
			} : null;
		}
		/**
		* An unknown history prefix is never a wildcard segment. Load the canonical
		* boundary and every intervening native event before deciding placement: an
		* unloaded passive human message may separate the seat from an older worker.
		*/
		function segmentHistoryTarget(snapshot, node, memberships) {
			if (node.data.segmentStartSeq !== 0 || !segmentTail(snapshot, node)) return void 0;
			const boundaries = memberships.flatMap((membership) => membership.coordinatorTurn === node.data.turn && membership.segmentStartSeq !== void 0 && membership.segmentStartSeq > 0 && membership.participationSeq !== void 0 && membership.participationSeq <= node.anchorSeq ? [membership.segmentStartSeq] : []);
			return boundaries.length ? Math.min(...boundaries) : void 0;
		}
		// assets/moa-wordmark.png
		var moa_wordmark_default = "data:image/png;base64,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";
		// src/client/styles.ts
		/** Only Project-owned controls; native sidebar rows keep all native styling. */
		const styles = `
.pm-toggle,.pm-capsules,.pm-readonly{color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.pm-capsule,.pm-readonly button,.pm-parent{font:inherit;color:inherit;border:0;background:transparent;border-radius:6px;padding:5px 7px;cursor:pointer}
.pm-capsule:hover,.pm-readonly button:hover,.pm-parent:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pm-capsule:focus-visible,.pm-mode-button:focus-visible,.pm-parent:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.pm-toggle [role=alert],.pm-toggle [role=status]{font-size:11px;margin-left:6px}
.pm-mode-button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);padding:6px 4px;cursor:pointer}
.pm-mode-button[aria-pressed=true],.pm-fixed{color:#526b00}
body[data-ds-dark-theme] .pm-mode-button[aria-pressed=true],body[data-ds-dark-theme] .pm-fixed{color:#cbff45}
.pm-mode-button:disabled{cursor:default;opacity:.65}
.pm-wordmark{display:inline-block;position:relative;width:44px;height:12px;flex:none;vertical-align:middle}
.pm-wordmark::before,.pm-wordmark::after{content:"";position:absolute;inset:0}
/* Keep the selected letter contours; application theme controls their contrast. */
.pm-wordmark::before{background:currentColor;mask:url("${moa_wordmark_default}") center/contain no-repeat;clip-path:inset(0 22% 0 0)}
.pm-wordmark::after{background:url("${moa_wordmark_default}") center/contain no-repeat;clip-path:inset(0 0 0 78%)}
.pm-mode-button[aria-pressed=false] .pm-wordmark::after{filter:grayscale(1) brightness(.5);opacity:.6}
.pm-parent{padding:0}
[data-slot="conversation.composer.bar"]:has(.pm-parent) [data-slot="conversation.input.permission"]{display:none!important}
.pm-fixed{display:inline-flex;align-items:center;padding:6px 4px}
.pm-capsules{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:8px 0}.pm-capsules>li{display:flex;min-width:0;max-width:100%}.pm-capsule{box-sizing:border-box;display:inline-flex;min-width:0;max-width:min(100%,240px);height:28px;gap:6px;align-items:center;text-align:left;border:1px solid var(--dsw-alias-border-l4);border-radius:999px;padding:4px 8px;font-size:12px;line-height:18px}.pm-capsule strong{min-width:0;max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.pm-progress{min-width:0;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.pm-worker-icon{display:block;flex:0 0 auto;width:24px;height:24px}
.pm-capsule .pm-worker-icon{width:16px;height:16px}
.pm-agent-message{box-sizing:border-box;width:fit-content;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702),82%);margin:12px 0 12px auto;padding:10px 16px;background:var(--dsw-specific-bubble);border-radius:var(--dsw-radius-xl);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;overflow-wrap:anywhere;min-width:0}
.pm-agent-message>header{color:var(--dsw-alias-label-secondary);font-size:12px;margin-bottom:6px}
.pm-agent-message .pm-axis-preview{margin-top:4px}.pm-agent-message .pm-axis-preview>summary{display:block;list-style:none;cursor:pointer}.pm-agent-message .pm-axis-preview>summary::-webkit-details-marker{display:none}.pm-agent-message .pm-axis-preview>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:3px}
.pm-agent-message .pm-axis-preview:not([open])>summary{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;color:var(--dsw-alias-label-secondary,#999)}
.pm-agent-empty{color:var(--dsw-alias-label-tertiary)}
`;
		// src/client/components.tsx
		function WorkerCapsuleList({ client, sessionId, turn, closed, segmentStartSeq, open, t }) {
			const capsules = useSelected(client.store.subscribe, () => client.store.turn(sessionId, turn, closed, segmentStartSeq));
			if (!capsules.length) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: "pm-capsules",
				"aria-label": t("workers"),
				children: capsules.map((c) => {
					const status = t(c.status), progress = c.text?.replace(/\s+/g, " ").trim();
					const detail = (c.status === "working" || c.status === "starting" || c.status === "waiting-user") && progress ? progress : status;
					const tooltip = [...new Set([
						c.name,
						status,
						progress,
						c.queueLength ? t("queued", { count: c.queueLength }) : void 0
					].filter(Boolean))].join("\n");
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "pm-capsule",
						onClick: () => open(c.address),
						"aria-label": t("openWorker", { name: c.name }),
						title: tooltip,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerIcon, { workerId: c.workerId }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: c.name }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "pm-progress",
								children: detail
							})
						]
					}) }, c.key);
				})
			})] });
		}
		function ProjectToggle({ client, sessionId, running, open, t }) {
			const state = useSelected(client.subscribeModes, () => client.mode(sessionId));
			const projectMode = useSelected(client.store.subscribe, () => {
				const project = client.store.projects().find((p) => p.project.coordinatorSessionId === sessionId || p.workers.some((w) => w.workerId === sessionId))?.project;
				return project ? `${project.mode}:${project.modeLocked}` : void 0;
			});
			(0, react.useEffect)(() => {
				client.refreshMode(sessionId);
			}, [
				client,
				sessionId,
				running,
				projectMode
			]);
			if (state.value?.role === "worker") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "pm-toggle pm-parent",
				onClick: () => state.value?.coordinatorSessionId && open(state.value.coordinatorSessionId),
				children: t("parent")
			})] });
			const reason = state.value?.toggleBlockedReason;
			if (state.value?.enabled && (state.value.modeLocked || running || projectMode === "enabled:true")) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "pm-toggle pm-fixed",
				role: "img",
				"aria-label": t("project"),
				title: t("blocked.session-mode-locked"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "pm-wordmark",
					"aria-hidden": "true"
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "pm-toggle",
				"aria-busy": state.busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "pm-mode-button",
						"aria-label": t("project"),
						"aria-pressed": state.value?.enabled ?? false,
						title: reason ? t(`blocked.${reason}`) : state.value?.paths?.root,
						disabled: state.busy || !state.value?.canToggle,
						onClick: () => {
							client.toggle(sessionId, !state.value?.enabled);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "pm-wordmark",
							"aria-hidden": "true"
						})
					}),
					state.busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "status",
						children: t("enabling")
					}),
					state.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						role: "alert",
						children: t("error", { message: state.error })
					})
				]
			});
		}
		// src/client/branch.tsx
		function savedExpansion(id) {
			try {
				const own = localStorage.getItem(`project-mode.branch:${id}`);
				return own === null ? JSON.parse(localStorage.getItem("project-mode.expansion") ?? "{}")[id] === true : own === "true";
			} catch {
				return false;
			}
		}
		/** Add only the disclosure and children; DSH renders every row and the browser. */
		function ProjectBranch(p) {
			const archived = p.useWorkspaces((state) => state.archivedSessionIds);
			const workers = useSelected(p.client.store.subscribe, () => (p.client.store.project(p.sessionId)?.workers ?? []).filter((w) => isVisibleWorker(w) && !archived.includes(w.workerId)).map(({ workerId, parentSessionId, name, phase }) => ({
				workerId,
				parentSessionId,
				name,
				phase
			})));
			const [expanded, setExpanded] = react.useState(() => savedExpansion(p.sessionId));
			const selectedChild = workers.find((w) => w.workerId === p.currentSessionId)?.workerId;
			react.useEffect(() => {
				if (selectedChild) setExpanded(true);
			}, [selectedChild]);
			const groupId = react.useId();
			if (archived.includes(p.sessionId) || !workers.length) return p.renderRow();
			const toggle = () => {
				const next = !expanded;
				setExpanded(next);
				try {
					localStorage.setItem(`project-mode.branch:${p.sessionId}`, String(next));
				} catch {}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "pm-project-branch",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: `
        .pm-project-branch{display:contents}
        .pm-project-branch [data-row-key]>span:first-child{width:16px!important}
        .pm-worker-branch>[role=treeitem]>span:first-child{width:16px!important}
        .pm-project-branch [data-row-key]>span:nth-child(2):has(>[data-slot="sidebar.session.row.leading"]:empty){display:none}
        .pm-project-branch:has([data-row-key]>span:nth-child(2)>[data-slot="sidebar.session.row.leading"]:empty)>.pm-worker-branch>[role=treeitem]>span:first-child{display:none!important}

        .pm-branch-toggle{display:flex;align-items:center;justify-content:center;width:12px;height:20px;padding:0;border:0;background:none;color:inherit;cursor:pointer;flex:none}
        .pm-branch-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-radius:3px}
        .pm-worker-branch{display:flex;flex-direction:column;gap:2px;margin-top:2px}
        .pm-worker-branch .pm-worker-icon{width:16px;height:16px;display:block;flex:none}
        .pm-worker-identity{position:relative;display:inline-flex;width:16px;height:16px;flex:none}
        .pm-worker-identity .pm-worker-running{position:absolute;inset:-3px;pointer-events:none}
      ` }),
					p.renderRow(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "pm-branch-toggle",
						"aria-label": p.t(expanded ? "collapse" : "expand", { name: p.t("workers") }),
						"aria-expanded": expanded,
						"aria-controls": groupId,
						onClick: (event) => {
							event.stopPropagation();
							toggle();
						},
						onDoubleClick: (event) => event.stopPropagation(),
						onKeyDown: (event) => event.stopPropagation(),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							width: "10",
							height: "10",
							viewBox: "0 0 10 10",
							"aria-hidden": "true",
							focusable: "false",
							style: { transform: expanded ? "rotate(90deg)" : void 0 },
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								d: "m3.5 2 3 3-3 3",
								fill: "none",
								stroke: "currentColor",
								strokeWidth: "1.4",
								strokeLinecap: "round",
								strokeLinejoin: "round"
							})
						})
					})),
					expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "pm-worker-branch",
						role: "group",
						id: groupId,
						"aria-label": p.t("workers"),
						children: workers.map((w) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react.Fragment, { children: p.renderChild({
							sessionId: w.workerId,
							title: w.name,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "pm-worker-identity",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerIcon, { workerId: w.workerId }), (w.phase === "working" || w.phase === "starting" || w.phase === "stopping") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
									state: "ongoing",
									size: 22,
									className: "pm-worker-running"
								})]
							}),
							trailing: p.t(w.phase),
							selected: p.currentSessionId === w.workerId,
							onOpen: () => p.open({
								parentSessionId: w.parentSessionId ?? p.sessionId,
								childSessionId: w.workerId,
								mode: "continuable"
							})
						}) }, w.workerId))
					})
				]
			});
		}
		/** Capture immutable routing facts; a selector never reads an external store. */
		function bindProjectBranches(ctx, client, open) {
			let key;
			let remove = () => {};
			const reconcile = () => {
				const ids = client.store.projects().filter((p) => p.workers.some((w) => isVisibleWorker(w))).map((p) => p.project.coordinatorSessionId).sort();
				const next = JSON.stringify(ids);
				if (key === next) return;
				key = next;
				remove();
				const eligible = new Set(ids);
				remove = ctx.slots.register({
					name: "sidebar.workspaces.session.branch",
					priority: -10,
					locale: "project-mode",
					select: (owner) => eligible.has(owner.sessionId) ? { coordinator: true } : null,
					inject: () => ({
						client,
						open
					})
				}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectBranch, { ...props }));
			};
			reconcile();
			const stop = client.store.subscribe(reconcile);
			return () => {
				stop();
				remove();
			};
		}
		// src/client/locales.ts
		const en = {
			timeline: "Work timeline",
			noWorkers: "No workers yet",
			selectWorker: "Select a worker to view its work.",
			openConversation: "Open conversation ↗",
			loadingTimeline: "Loading timeline…",
			timelineTurn: "Turn {turn}",
			timelineInputs: "Input",
			timelineOutputs: "Output",
			timelineArtifacts: "Artifacts",
			fromCoordinator: "Coordinator",
			fromAgent: "Agent",
			fromUser: "User",
			messageFrom: "From {name}",
			messageContent: "Message content",
			truncatedContent: "… {count} characters",
			awaitingReply: "Awaiting a reply…",
			emptyReply: "No AI reply in this turn",
			noArtifacts: "No recorded artifacts",
			noTurns: "No work recorded yet",
			loadEarlier: "Load earlier turns",
			copy: "Copy",
			copied: "Copied",
			footnotes: "Footnotes",
			project: "MoA+",
			enabling: "Updating MoA+…",
			loading: "Loading MoA+…",
			parent: "Back",
			readonlyDeleted: "This worker was deleted. Its conversation history is retained.",
			readonlyDisabled: "MoA+ is disabled. This worker is read-only.",
			"blocked.agent-running": "Wait for the current turn to finish.",
			"blocked.session-mode-locked": "This conversation keeps MoA+ mode after starting.",
			"blocked.workers-active": "Workers are still active.",
			"blocked.results-pending": "Worker results are awaiting review.",
			"blocked.worker-session": "Workers belong to their coordinator.",
			"blocked.runtime-unavailable": "MoA+ runtime is unavailable.",
			error: "Could not complete the action: {message}",
			working: "Working",
			starting: "Starting",
			"waiting-user": "Waiting",
			stopping: "Stopping",
			idle: "Idle",
			failed: "Failed",
			stopped: "Stopped",
			disconnected: "Disconnected",
			completed: "Completed",
			continued: "Continued",
			deleted: "Deleted",
			queued: "Queued: {count}",
			openWorker: "Open worker: {name}",
			workers: "Workers",
			sessions: "Conversations",
			newSession: "New conversation",
			addWorkspace: "Add workspace",
			search: "Search conversations",
			sort: "Sort conversations",
			manual: "Manual order",
			recent: "Recently updated",
			name: "Name",
			archived: "Show archived",
			expand: "Expand {name}",
			collapse: "Collapse {name}",
			menu: "Actions for {name}",
			pin: "Pin",
			unpin: "Unpin",
			rename: "Rename",
			fork: "Fork",
			archive: "Archive",
			unarchive: "Restore",
			copyId: "Copy conversation ID",
			moveUp: "Move up",
			moveDown: "Move down",
			removeWorkspace: "Remove workspace",
			cancel: "Cancel",
			save: "Save",
			close: "Close",
			title: "Title",
			chooseAgain: "Choose again",
			empty: "No conversations",
			searchMore: "More results exist; narrow your search.",
			searchFailed: "Search failed: {message}",
			loadingSessions: "Loading conversations…",
			retry: "Retry",
			directory: "Workspace directory",
			directoryMore: "More directories exist; enter a path to continue.",
			selectDirectory: "Choose directory",
			pick: "Use this directory",
			parentDirectory: "Parent directory",
			createDirectory: "New directory",
			workspaceActions: "Workspace actions",
			selected: "Selected",
			running: "Running: {count}"
		};
		const zh = {
			timeline: "工作轴",
			noWorkers: "还没有 Worker",
			selectWorker: "选择一个 Worker 查看工作记录。",
			openConversation: "打开对话 ↗",
			loadingTimeline: "正在加载工作轴…",
			timelineTurn: "第 {turn} 轮",
			timelineInputs: "输入",
			timelineOutputs: "输出",
			timelineArtifacts: "产物",
			fromCoordinator: "Coordinator",
			fromAgent: "Agent",
			fromUser: "用户",
			messageFrom: "来自 {name}",
			messageContent: "消息内容",
			truncatedContent: "… {count} 字符",
			awaitingReply: "等待回复…",
			emptyReply: "本轮没有 AI 回复",
			noArtifacts: "未记录产物",
			noTurns: "还没有工作记录",
			loadEarlier: "加载更早轮次",
			copy: "复制",
			copied: "已复制",
			footnotes: "脚注",
			project: "MoA+",
			enabling: "正在更新 MoA+…",
			loading: "正在加载 MoA+…",
			parent: "Back",
			readonlyDeleted: "此 worker 已删除，对话历史仍然保留。",
			readonlyDisabled: "MoA+ 已关闭，此 worker 仅可查看历史。",
			"blocked.agent-running": "请等待当前轮次结束。",
			"blocked.session-mode-locked": "该会话已启动，将始终保持 MoA+ 模式。",
			"blocked.workers-active": "仍有 worker 正在运行。",
			"blocked.results-pending": "worker 结果尚待处理。",
			"blocked.worker-session": "worker 由主会话管理。",
			"blocked.runtime-unavailable": "MoA+ 运行环境暂不可用。",
			error: "操作失败：{message}",
			working: "正在处理",
			starting: "正在启动",
			"waiting-user": "等待中",
			stopping: "正在停止",
			idle: "空闲",
			failed: "失败",
			stopped: "已中止",
			disconnected: "连接不可用",
			completed: "已完成",
			continued: "已续接",
			deleted: "已删除",
			queued: "排队：{count}",
			openWorker: "打开 worker：{name}",
			workers: "Workers",
			sessions: "会话",
			newSession: "新建会话",
			addWorkspace: "添加工作区",
			search: "搜索会话",
			sort: "会话排序",
			manual: "手动排序",
			recent: "最近更新",
			name: "名称",
			archived: "显示已归档",
			expand: "展开 {name}",
			collapse: "折叠 {name}",
			menu: "{name} 的操作",
			pin: "置顶",
			unpin: "取消置顶",
			rename: "重命名",
			fork: "分支",
			archive: "归档",
			unarchive: "恢复",
			copyId: "复制会话 ID",
			moveUp: "上移",
			moveDown: "下移",
			removeWorkspace: "移除工作区",
			cancel: "取消",
			save: "保存",
			close: "关闭",
			title: "标题",
			chooseAgain: "重新选择",
			empty: "没有会话",
			searchMore: "还有更多结果，请缩小搜索范围。",
			searchFailed: "搜索失败：{message}",
			loadingSessions: "正在加载会话…",
			retry: "重试",
			directory: "工作区目录",
			directoryMore: "还有更多目录，请输入路径继续。",
			selectDirectory: "选择目录",
			pick: "使用此目录",
			parentDirectory: "上级目录",
			createDirectory: "新建目录",
			workspaceActions: "工作区操作",
			selected: "已选中",
			running: "运行中：{count}"
		};
		// src/client/agent-message.tsx
		/** Remove only the transport wrapper we authored; the delivered message stays unchanged. */
		function messageBody(message) {
			const source = message.source;
			const first = message.content[0];
			if (first?.type !== "text") return message.content;
			if (source.kind === "moa-message") {
				const prefix = `${typeof source.requestId === "string" ? `Request ID: ${source.requestId}\n` : ""}${typeof source.replyTo === "string" ? `Reply to: ${source.replyTo}\n` : ""}From: ${source.senderId}\n`;
				if (first.text.startsWith(prefix)) return [{
					...first,
					text: first.text.slice(prefix.length)
				}, ...message.content.slice(1)];
			}
			if (source.kind === "project-mode-result" && typeof source.completionId === "string" && first.text.startsWith("Worker ") && first.text.includes(` (${source.workerId}), turn ${source.workerTurn}, outcome `) && first.text.includes(`Completion ${source.completionId}. `)) return message.content.slice(1);
			return message.content;
		}
		/** The same incoming message row is used in Coordinator and Worker conversations. */
		function AgentMessage({ message, client, t }) {
			const source = message.source;
			const id = [
				source.senderSessionId,
				source.senderId,
				source.workerId,
				source.coordinatorSessionId
			].find((value) => typeof value === "string" && value !== "");
			const name = useSelected(client.store.subscribe, () => {
				if (typeof source.senderName === "string" && source.senderName) return source.senderName;
				for (const project of client.store.projects()) {
					const worker = project.workers.find((worker) => worker.workerId === id);
					if (worker) return worker.name;
					if (project.project.coordinatorSessionId === id) return t("fromCoordinator");
				}
				return id === source.rootId || source.kind === "project-mode-assignment" ? t("fromCoordinator") : t("fromAgent");
			});
			const labels = react.useMemo(() => ({
				code: {
					copyLabel: t("copy"),
					copiedLabel: t("copied")
				},
				footnotes: t("footnotes")
			}), [t]);
			const content = messageBody(message);
			const sender = t("messageFrom", { name });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "pm-agent-message",
				"data-moa-message": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", { children: sender }),
					content.length ? content.map((block, index) => block.type === "text" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessagePreview, {
						text: block.text,
						labels
					}, index) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
						label: t("messageContent"),
						payload: block,
						truncatedLabel: (count) => t("truncatedContent", { count })
					}, index)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "pm-agent-empty",
						children: t("emptyReply")
					})
				]
			});
		}
		// src/client/index.tsx
		const inject = [
			"remote",
			"sessions",
			"workspaces",
			"uiWorkspace",
			"uiConversation",
			"conversation",
			"slots",
			"locale"
		];
		async function apply(ctx) {
			await ctx.remote.$mount(TYPERT_REMOTE);
			await ctx.inject(["remote.projectMode"], applyProjectClient);
		}
		function applyProjectClient(ctx) {
			const client = new ProjectClient(ctx.remote.projectMode);
			const open = (target) => ctx.uiWorkspace.openSession(target);
			ctx.effect(() => () => client.dispose());
			ctx.inject(["sidebarRight", "sidebarRightTabs"], (scope) => registerProjectPanels(scope, client, open));
			ctx.effect(() => bindWorkerParents(client, ctx.sessions));
			const historyLoads = /* @__PURE__ */ new WeakMap();
			let disposed = false;
			ctx.effect(() => () => {
				disposed = true;
			});
			const loadSegmentHistory = (id, target) => {
				if (disposed) return false;
				const session = ctx.sessions.binding(id)?.session;
				if (!session) return false;
				const state = session.getSnapshot();
				if (state.openState !== "open" || state.loadingOlder) return false;
				const pending = historyLoads.get(session) ?? /* @__PURE__ */ new Set();
				if (pending.has(target)) return true;
				historyLoads.set(session, pending);
				pending.add(target);
				try {
					session.loadThrough(target).catch(() => {}).finally(() => pending.delete(target));
				} catch {
					pending.delete(target);
				}
				return true;
			};
			ctx.effect(() => bindCoordinatorInputPolicy(client, ctx.conversation.submission, ctx.sessions.list));
			ctx.effect(() => ctx.locale.register("project-mode", {
				en,
				zh
			}));
			ctx.effect(() => ctx.uiConversation.events.register(humanBoundaryDefinition));
			ctx.effect(() => ctx.uiConversation.events.register(workerTailDefinition));
			const refreshRoots = () => {
				const list = ctx.sessions.list.getSnapshot();
				for (const row of Object.values(list.byId)) if ((row.retainedBy.mainView ?? 0) > 0 && ctx.sessions.subagentAddress(row.id)) client.refreshMode(row.id);
				client.watchRoots(list.ids.filter((id) => list.byId[id]?.origin !== "subagent"));
			};
			ctx.effect(() => {
				refreshRoots();
				return ctx.sessions.list.subscribe(refreshRoots);
			});
			ctx.on("connection/reset", () => client.reconnect());
			client.loadCatalog();
			const shared = () => ({
				client,
				open
			});
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "project-mode.toggle",
				order: 5,
				locale: "project-mode",
				inject: shared
			}, (p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectToggle, {
				...p,
				running: p.useSession((s) => s.running)
			})] })));
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "project-mode-workers-tail",
				locale: "project-mode",
				inject: shared
			}, (p) => {
				const memberships = useSelected(client.store.subscribe, () => client.store.project(p.sessionId)?.turnMemberships ?? []);
				const historyTarget = p.useChat((s) => segmentHistoryTarget(s, p.node, memberships));
				const historyReady = p.useSession((s) => s.openState === "open" && !s.loadingOlder);
				const historyAttempt = react.useRef();
				react.useEffect(() => {
					if (typeof historyTarget !== "number") {
						historyAttempt.current = void 0;
						return;
					}
					if (!historyReady || historyAttempt.current?.id === p.sessionId && historyAttempt.current.target === historyTarget) return;
					if (loadSegmentHistory(p.sessionId, historyTarget)) historyAttempt.current = {
						id: p.sessionId,
						target: historyTarget
					};
				}, [
					p.sessionId,
					historyTarget,
					historyReady
				]);
				const closed = p.useChat((s) => s.timeline.turns.get(p.node.data.turn)?.end !== void 0);
				const selected = p.useChat((s) => segmentTail(s, p.node) !== null);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [p.node.data.incoming && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentMessage, {
					...p,
					message: p.node.data.incoming
				}), selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerCapsuleList, {
					...p,
					turn: p.node.data.turn,
					segmentStartSeq: p.node.data.segmentStartSeq,
					closed
				})] });
			}));
			ctx.slots.inject("sidebar.workspaces.session.branch", () => bindProjectBranches(ctx, client, open));
			ctx.slots.inject("conversation.composer", () => {
				let previous, dispose = () => {};
				const reconcile = () => {
					const readonly = client.store.projects().flatMap((p) => p.workers.flatMap((w) => {
						const match = workerReadOnly([p], w.workerId);
						return match ? [{
							id: w.workerId,
							...match
						}] : [];
					}));
					const membership = client.store.projects().map((p) => ({
						parent: p.project.coordinatorSessionId,
						mode: p.project.mode,
						workers: p.workers.map((w) => w.workerId)
					}));
					const key = JSON.stringify([
						readonly,
						membership,
						client.modeVersion
					]);
					if (key === previous) return;
					previous = key;
					dispose();
					dispose = ctx.slots.register({
						name: "conversation.composer",
						priority: -20,
						locale: "project-mode",
						select: (owner) => composerMatch(owner, client),
						inject: shared
					}, (p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "pm-readonly",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: styles }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: p.t(p.matched.reason === "deleted" ? "readonlyDeleted" : "readonlyDisabled") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => p.open(p.matched.parent),
								children: p.t("parent")
							})
						]
					}));
				};
				reconcile();
				const stop = client.store.subscribe(reconcile), stopModes = client.subscribeModes(reconcile);
				return () => {
					stop();
					stopModes();
					dispose();
				};
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
