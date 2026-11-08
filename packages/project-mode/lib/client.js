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
						"line": 820,
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
						"line": 836,
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
						"line": 783,
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
						"line": 810,
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
						"line": 848,
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
						"line": 902,
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
						"line": 907,
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
						"line": 758,
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
						"line": 871,
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
			if (typeof submission?.register !== "function") throw new Error("Project Mode requires the native composer submission compatibility API; apply the approved local DSH compatibility patch before enabling the plugin.");
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
							error: error instanceof Error ? error.message : String(error)
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
						className: "pm-workers-list",
						"aria-label": t("workers"),
						children: [workers.map((w) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
						}, w.workerId)), !workers.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "pm-axis-empty",
							children: t("noWorkers")
						})]
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
							!worker && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "pm-axis-empty",
								children: t("selectWorker")
							}),
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
				if (event.type === "user/message" && event.data.source.kind === "project-mode-result") return {
					id: `result:${event.data.id}`,
					role: "start"
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
				segmentStartSeq: reader.previous(humanBoundaryDefinition.kind)?.state.seq ?? (match.location.kind === "turn" || match.location.kind === "step" ? match.location.turn.start?.seq : void 0) ?? 0
			}),
			update: (context, match) => ({
				...context.state,
				seq: Math.max(context.state.seq, match.event.seq)
			}),
			publication: (match) => match.event.type === "assistant/live-chunk" ? "animation-frame" : "immediate",
			buildViewNode(context) {
				const location = [context.start, ...context.matches].find((match) => match?.location.kind === "step")?.location;
				if (location?.kind !== "step" || !context.state) {
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
					location: {
						kind: "turn",
						turn: location.turn
					},
					visibility: "visible",
					groupTree: "turn",
					data: {
						turn: location.turn.turn,
						step: location.step.step,
						segmentStartSeq: context.state.segmentStartSeq
					}
				};
			}
		};
		/** Pick exactly one native seat at the bottom of each human transcript segment. */
		function segmentTail(snapshot, node) {
			if (node.visibility !== "visible") return null;
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
		// src/client/styles.ts
		/** Only Project-owned controls; native sidebar rows keep all native styling. */
		const styles = `
.pm-toggle,.pm-capsules,.pm-readonly{color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.pm-capsule,.pm-readonly button,.pm-parent{font:inherit;color:inherit;border:0;background:transparent;border-radius:6px;padding:5px 7px;cursor:pointer}
.pm-capsule:hover,.pm-readonly button:hover,.pm-parent:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pm-capsule:focus-visible,.pm-toggle input:focus-visible,.pm-parent:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.pm-toggle label{display:inline-flex;gap:4px;align-items:center;cursor:pointer}.pm-toggle [role=alert],.pm-toggle [role=status]{font-size:11px;margin-left:6px}
.pm-parent{padding:0}
[data-slot="conversation.composer.bar"]:has(.pm-parent) [data-slot="conversation.input.permission"]{display:none!important}
.pm-fixed{display:inline-flex;align-items:center;gap:4px}
.pm-capsules{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:8px 0}.pm-capsules>li{display:flex;min-width:0;max-width:100%}.pm-capsule{box-sizing:border-box;display:inline-flex;min-width:0;max-width:min(100%,240px);height:28px;gap:6px;align-items:center;text-align:left;border:1px solid var(--dsw-alias-border-l4);border-radius:999px;padding:4px 8px;font-size:12px;line-height:18px}.pm-capsule strong{min-width:0;max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.pm-progress{min-width:0;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.pm-worker-icon{display:block;flex:0 0 auto;width:24px;height:24px}
.pm-capsule .pm-worker-icon{width:16px;height:16px}
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
				title: t("blocked.session-mode-locked"),
				children: t("project")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "pm-toggle",
				"aria-busy": state.busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						title: reason ? t(`blocked.${reason}`) : state.value?.paths?.root,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: state.value?.enabled ?? false,
							disabled: state.busy || !state.value?.canToggle,
							onChange: (e) => {
								client.toggle(sessionId, e.currentTarget.checked);
							}
						}), t("project")]
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
				return p.useChat((s) => segmentTail(s, p.node) !== null) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerCapsuleList, {
					...p,
					turn: p.node.data.turn,
					segmentStartSeq: p.node.data.segmentStartSeq,
					closed
				}) : null;
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
