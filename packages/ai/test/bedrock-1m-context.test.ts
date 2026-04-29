import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import {
	applyOpus1MSuffix,
	type BedrockOptions,
	streamBedrock,
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

	describe("applyOpus1MSuffix", () => {
		it("adds :1m to eligible model when enabled", () => {
			expect(applyOpus1MSuffix("anthropic.claude-opus-4-7", true)).toBe("anthropic.claude-opus-4-7:1m");
		});
		it("is idempotent on already-suffixed model", () => {
			const once = applyOpus1MSuffix("anthropic.claude-opus-4-7", true);
			const twice = applyOpus1MSuffix(once, true);
			expect(twice).toBe(once);
		});
		it("skips when enable1M is false", () => {
			expect(applyOpus1MSuffix("anthropic.claude-opus-4-7", false)).toBe("anthropic.claude-opus-4-7");
		});
		it("skips for non-eligible model even when enabled", () => {
			expect(applyOpus1MSuffix("anthropic.claude-sonnet-4-6", true)).toBe("anthropic.claude-sonnet-4-6");
		});
		it("respects regional prefix on modelId (both eligibility and output)", () => {
			expect(applyOpus1MSuffix("us.anthropic.claude-opus-4-7", true)).toBe("us.anthropic.claude-opus-4-7:1m");
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
	it("Opus 4.7 + enable1MContext=true sends :1m modelId and context-1m beta", async () => {
		const model = getModel("amazon-bedrock", "anthropic.claude-opus-4-7");
		const payload = await capturePayload(model, { enable1MContext: true });
		expect(payload.modelId).toBe("anthropic.claude-opus-4-7:1m");
		expect(payload.additionalModelRequestFields?.anthropic_beta).toEqual(["context-1m-2025-08-07"]);
	});

	it("Opus 4.7 + enable1MContext=false emits no 1M artifacts", async () => {
		const model = getModel("amazon-bedrock", "anthropic.claude-opus-4-7");
		const payload = await capturePayload(model, { enable1MContext: false });
		expect(payload.modelId).toBe("anthropic.claude-opus-4-7");
		expect(payload.additionalModelRequestFields?.anthropic_beta ?? []).not.toContain("context-1m-2025-08-07");
	});

	it("Sonnet 4.6 + enable1MContext=true does NOT add :1m or 1M beta (non-eligible)", async () => {
		const model = getModel("amazon-bedrock", "anthropic.claude-sonnet-4-6");
		const payload = await capturePayload(model, { enable1MContext: true });
		expect(payload.modelId).toBe("anthropic.claude-sonnet-4-6");
		expect(payload.additionalModelRequestFields?.anthropic_beta ?? []).not.toContain("context-1m-2025-08-07");
	});
});
