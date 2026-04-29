import { describe, expect, it } from "vitest";

import { supportsAdaptiveThinking } from "../src/providers/amazon-bedrock.js";

describe("bedrock — adaptive thinking eligibility", () => {
	it("Opus 4.7 is eligible", () => {
		expect(supportsAdaptiveThinking("anthropic.claude-opus-4-7")).toBe(true);
	});

	it("Opus 4.6 is eligible", () => {
		expect(supportsAdaptiveThinking("anthropic.claude-opus-4-6")).toBe(true);
	});

	it("Sonnet 4.6 is eligible", () => {
		expect(supportsAdaptiveThinking("anthropic.claude-sonnet-4-6")).toBe(true);
	});

	it("Sonnet 3.7 is NOT eligible", () => {
		expect(supportsAdaptiveThinking("anthropic.claude-3-7-sonnet-20250219-v1:0")).toBe(false);
	});

	it("Sonnet 3.5 is NOT eligible", () => {
		expect(supportsAdaptiveThinking("anthropic.claude-3-5-sonnet")).toBe(false);
	});

	it("regional prefix tolerated (us.)", () => {
		expect(supportsAdaptiveThinking("us.anthropic.claude-opus-4-7")).toBe(true);
	});

	it("global prefix tolerated", () => {
		expect(supportsAdaptiveThinking("global.anthropic.claude-opus-4-7")).toBe(true);
	});

	it("matches on model name when id is an opaque ARN", () => {
		// Application inference profile ARNs don't contain the family; name carries it.
		expect(
			supportsAdaptiveThinking(
				"arn:aws:bedrock:us-east-1:123:application-inference-profile/z27q",
				"My Team Opus 4.7 Profile",
			),
		).toBe(true);
	});

	it("ARN id without a matching name is NOT eligible", () => {
		expect(
			supportsAdaptiveThinking(
				"arn:aws:bedrock:us-east-1:123:application-inference-profile/z27q",
				"Generic Profile",
			),
		).toBe(false);
	});

	it("non-Claude Bedrock model is NOT eligible", () => {
		expect(supportsAdaptiveThinking("amazon.nova-pro-v1:0")).toBe(false);
	});

	it("empty id is NOT eligible", () => {
		expect(supportsAdaptiveThinking("")).toBe(false);
	});

	it("tolerates dotted/underscore separators via normalization", () => {
		// getModelMatchCandidates collapses [\s_.:]+ to '-', so "opus_4_7" matches "opus-4-7".
		expect(supportsAdaptiveThinking("vendor.claude_opus_4_7")).toBe(true);
	});
});
