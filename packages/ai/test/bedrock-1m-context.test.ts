import { describe, expect, it } from "vitest";
import { applyOpus1MSuffix, supportsOpus1MContext } from "../src/providers/amazon-bedrock.js";

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
			expect(applyOpus1MSuffix("anthropic.claude-opus-4-7", true, "anthropic.claude-opus-4-7")).toBe(
				"anthropic.claude-opus-4-7:1m",
			);
		});
		it("is idempotent on already-suffixed model", () => {
			const once = applyOpus1MSuffix("anthropic.claude-opus-4-7", true, "anthropic.claude-opus-4-7");
			const twice = applyOpus1MSuffix(once, true, "anthropic.claude-opus-4-7");
			expect(twice).toBe(once);
		});
		it("skips when enable1M is false", () => {
			expect(applyOpus1MSuffix("anthropic.claude-opus-4-7", false, "anthropic.claude-opus-4-7")).toBe(
				"anthropic.claude-opus-4-7",
			);
		});
		it("skips for non-eligible model even when enabled", () => {
			expect(applyOpus1MSuffix("anthropic.claude-sonnet-4-6", true, "anthropic.claude-sonnet-4-6")).toBe(
				"anthropic.claude-sonnet-4-6",
			);
		});
		it("respects regional prefix on modelId but checks baseModelId for eligibility", () => {
			expect(applyOpus1MSuffix("us.anthropic.claude-opus-4-7", true, "anthropic.claude-opus-4-7")).toBe(
				"us.anthropic.claude-opus-4-7:1m",
			);
		});
		it("does not add suffix when baseModelId is non-eligible even if modelId contains 'opus-4-7'", () => {
			// Edge case: contrived input where modelId says opus but baseModelId says sonnet.
			// The helper trusts baseModelId for eligibility.
			expect(applyOpus1MSuffix("anthropic.claude-opus-4-7", true, "anthropic.claude-sonnet-4-6")).toBe(
				"anthropic.claude-opus-4-7",
			);
		});
	});
});
