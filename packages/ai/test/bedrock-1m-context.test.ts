import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import {
	type BedrockOptions,
	streamBedrock,
	stripOpus1MSuffix,
	supportsOpus1MContext,
} from "../src/providers/amazon-bedrock.js";
import type { Context, Model } from "../src/types.js";

describe("bedrock — 1M context beta helpers", () => {
	describe("supportsOpus1MContext", () => {
		it("matches Opus 4.7 base id", () => {
			expect(supportsOpus1MContext("anthropic.claude-opus-4-7")).toBe(true);
		});
		it("matches Opus 4.7 with regional prefix", () => {
			expect(supportsOpus1MContext("us.anthropic.claude-opus-4-7")).toBe(true);
		});
		it("matches Opus 4.7 with global prefix", () => {
			expect(supportsOpus1MContext("global.anthropic.claude-opus-4-7")).toBe(true);
		});
		it("matches Opus 4.6", () => {
			expect(supportsOpus1MContext("anthropic.claude-opus-4-6")).toBe(true);
		});
		it("rejects Sonnet 4.6", () => {
			expect(supportsOpus1MContext("anthropic.claude-sonnet-4-6")).toBe(false);
		});
		it("rejects Sonnet 3.7", () => {
			expect(supportsOpus1MContext("anthropic.claude-3-7-sonnet-20250219-v1:0")).toBe(false);
		});
		it("rejects empty string", () => {
			expect(supportsOpus1MContext("")).toBe(false);
		});
	});

	describe("stripOpus1MSuffix", () => {
		it("strips :1m suffix from Opus 4.7", () => {
			expect(stripOpus1MSuffix("anthropic.claude-opus-4-7:1m")).toEqual({
				modelId: "anthropic.claude-opus-4-7",
				has1MSuffix: true,
			});
		});
		it("strips :1m suffix from regional-prefixed model", () => {
			expect(stripOpus1MSuffix("us.anthropic.claude-opus-4-7:1m")).toEqual({
				modelId: "us.anthropic.claude-opus-4-7",
				has1MSuffix: true,
			});
		});
		it("leaves non-:1m model IDs unchanged", () => {
			expect(stripOpus1MSuffix("us.anthropic.claude-opus-4-7")).toEqual({
				modelId: "us.anthropic.claude-opus-4-7",
				has1MSuffix: false,
			});
		});
		it("handles Sonnet variants too", () => {
			expect(stripOpus1MSuffix("anthropic.claude-sonnet-4-6:1m")).toEqual({
				modelId: "anthropic.claude-sonnet-4-6",
				has1MSuffix: true,
			});
		});
		it("returns empty string unchanged", () => {
			expect(stripOpus1MSuffix("")).toEqual({ modelId: "", has1MSuffix: false });
		});
		it("idempotent on already-stripped ID", () => {
			const first = stripOpus1MSuffix("us.anthropic.claude-opus-4-7:1m");
			const second = stripOpus1MSuffix(first.modelId);
			expect(second).toEqual({ modelId: "us.anthropic.claude-opus-4-7", has1MSuffix: false });
		});
	});
});

interface BedrockPayload {
	modelId?: string;
	additionalModelRequestFields?: {
		thinking?: { type: string; budget_tokens?: number; display?: string };
		output_config?: { effort?: string };
		anthropic_beta?: string[];
	};
}

function makeContext(): Context {
	return {
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};
}

async function capturePayload(
	model: Model<"bedrock-converse-stream">,
	options?: BedrockOptions,
): Promise<BedrockPayload> {
	let capturedPayload: BedrockPayload | undefined;
	const s = streamBedrock(model, makeContext(), {
		...options,
		signal: AbortSignal.abort(),
		onPayload: (payload) => {
			capturedPayload = payload as BedrockPayload;
			return payload;
		},
	});

	for await (const event of s) {
		if (event.type === "error") {
			break;
		}
	}

	if (!capturedPayload) {
		throw new Error("Expected Bedrock payload to be captured before request abort");
	}

	return capturedPayload;
}

describe("bedrock — enable1MContext integration (payload-level)", () => {
	it("Opus 4.7 + enable1MContext=true sends unsuffixed modelId and context-1m beta", async () => {
		const model = getModel("amazon-bedrock", "anthropic.claude-opus-4-7");
		const payload = await capturePayload(model, { enable1MContext: true });
		expect(payload.modelId).toBe("anthropic.claude-opus-4-7");
		expect(payload.additionalModelRequestFields?.anthropic_beta).toEqual(["context-1m-2025-08-07"]);
	});

	it("Opus 4.7 with :1m suffix (picker form) strips suffix and enables 1M beta", async () => {
		const baseModel = getModel("amazon-bedrock", "anthropic.claude-opus-4-7");
		const suffixedModel: Model<"bedrock-converse-stream"> = { ...baseModel, id: `${baseModel.id}:1m` };
		const payload = await capturePayload(suffixedModel);
		expect(payload.modelId).toBe("anthropic.claude-opus-4-7");
		expect(payload.additionalModelRequestFields?.anthropic_beta).toEqual(["context-1m-2025-08-07"]);
	});

	it("Opus 4.7 + enable1MContext=false emits no 1M artifacts", async () => {
		const model = getModel("amazon-bedrock", "anthropic.claude-opus-4-7");
		const payload = await capturePayload(model, { enable1MContext: false });
		expect(payload.modelId).toBe("anthropic.claude-opus-4-7");
		expect(payload.additionalModelRequestFields?.anthropic_beta ?? []).not.toContain("context-1m-2025-08-07");
	});

	it("Sonnet 4.6 + enable1MContext=true does NOT add 1M beta (non-eligible)", async () => {
		const model = getModel("amazon-bedrock", "anthropic.claude-sonnet-4-6");
		const payload = await capturePayload(model, { enable1MContext: true });
		expect(payload.modelId).toBe("anthropic.claude-sonnet-4-6");
		expect(payload.additionalModelRequestFields?.anthropic_beta ?? []).not.toContain("context-1m-2025-08-07");
	});
});
