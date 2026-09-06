import type { Model, Provider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../../../src/index.ts";
import { createAgentSession, SessionManager, SettingsManager } from "../../../src/index.ts";
import { createTestResourceLoader } from "../../utilities.ts";
import { createHarness, type Harness } from "../harness.ts";

const PROVIDER_ID = "issue-8791";
const MODEL_ID = "issue-8791-model";

function customProvider(): Provider<"openai-completions"> {
	const model: Model<"openai-completions"> = {
		id: MODEL_ID,
		name: "Issue 8791",
		api: "openai-completions",
		provider: PROVIDER_ID,
		baseUrl: "http://127.0.0.1:9",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 16,
	};
	return {
		id: PROVIDER_ID,
		name: "Issue 8791",
		auth: {
			apiKey: {
				name: "Issue 8791",
				resolve: async ({ credential }) =>
					credential?.type === "api_key"
						? { auth: { apiKey: credential.key }, source: "stored API key" }
						: undefined,
			},
		},
		getModels: () => [model],
		stream: () => {
			throw new Error("issue 8791 test must not call the model");
		},
		streamSimple: () => {
			throw new Error("issue 8791 test must not call the model");
		},
	};
}

describe("regression #8791: expose model runtime to extensions", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("shares the parent ModelRuntime with child sessions via ctx.modelRuntime", async () => {
		// issue #8791
		let capturedCtx: ExtensionContext | undefined;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.registerProvider(customProvider());
					pi.on("session_start", (_event, ctx) => {
						capturedCtx = ctx;
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({});
		expect(capturedCtx).toBeDefined();
		expect(capturedCtx!.modelRuntime === harness.session.modelRuntime).toBe(true);
		expect(capturedCtx!.modelRegistry.modelRuntime === harness.session.modelRuntime).toBe(true);

		await capturedCtx!.modelRuntime.setRuntimeApiKey(PROVIDER_ID, "synthetic-runtime-key");
		expect(await harness.authStorage.read(PROVIDER_ID)).toBeUndefined();
		expect(harness.session.modelRuntime.getProvider(PROVIDER_ID)?.id).toBe(PROVIDER_ID);
		expect(harness.session.modelRuntime.getModel(PROVIDER_ID, MODEL_ID)?.id).toBe(MODEL_ID);
		expect(harness.session.modelRuntime.getProviderAuthStatus(PROVIDER_ID)).toEqual({
			configured: true,
			source: "runtime",
		});

		const childModel = capturedCtx!.modelRuntime.getModel(PROVIDER_ID, MODEL_ID);
		expect(childModel).toBeDefined();
		const { session: child } = await createAgentSession({
			cwd: harness.tempDir,
			agentDir: harness.tempDir,
			modelRuntime: capturedCtx!.modelRuntime,
			sessionManager: SessionManager.inMemory(harness.tempDir),
			settingsManager: SettingsManager.inMemory(),
			resourceLoader: createTestResourceLoader(),
			model: childModel,
			noTools: "all",
		});
		try {
			expect(child.modelRuntime === harness.session.modelRuntime).toBe(true);
			expect(child.modelRuntime.getProvider(PROVIDER_ID)?.id).toBe(PROVIDER_ID);
			expect(child.modelRuntime.getModel(PROVIDER_ID, MODEL_ID)?.id).toBe(MODEL_ID);
			expect(child.modelRuntime.getProviderAuthStatus(PROVIDER_ID)).toEqual({
				configured: true,
				source: "runtime",
			});
			expect(child.modelRuntime.hasConfiguredAuth(PROVIDER_ID)).toBe(true);
		} finally {
			child.dispose();
		}
	});
});
