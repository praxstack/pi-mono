import { BedrockRuntimeClient, ConversationRole } from "@aws-sdk/client-bedrock-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.js";
import { streamBedrock } from "../src/providers/amazon-bedrock.js";
import type { AssistantMessage, Context, ThinkingContent } from "../src/types.js";

/**
 * Build a fake response object that mimics the Bedrock Converse streaming
 * response shape the provider iterates over. The provider calls
 * `client.send(...)` and then `for await (const item of response.stream!)`,
 * so we only need `$metadata` and a `stream` async-iterable of events.
 */
function fakeStreamResponse(events: Array<Record<string, unknown>>): unknown {
	return {
		$metadata: { httpStatusCode: 200, requestId: "test-request" },
		stream: (async function* () {
			for (const e of events) yield e;
		})(),
	};
}

function makeContext(): Context {
	return {
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};
}

async function collectFinal(events: Array<Record<string, unknown>>): Promise<AssistantMessage> {
	vi.spyOn(BedrockRuntimeClient.prototype, "send").mockImplementation(
		// The real `.send` overloads return a union; we only need the stream shape
		// the provider consumes. Cast through unknown to keep TS happy without any.
		(() => Promise.resolve(fakeStreamResponse(events))) as unknown as BedrockRuntimeClient["send"],
	);

	const model = getModel("amazon-bedrock", "anthropic.claude-opus-4-7");
	const stream = streamBedrock(model, makeContext(), {
		awsAuthentication: "apikey",
		awsBedrockApiKey: "dummy-test-key",
		awsRegion: "us-east-1",
		reasoning: "high",
	});

	// Drain events so the async producer can run to completion.
	for await (const _event of stream) {
		// no-op — we only need the final result
	}

	return stream.result();
}

describe("bedrock streaming — reasoningContent signature preservation", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("concatenates reasoningContent.text deltas into thinking block", async () => {
		const final = await collectFinal([
			{ messageStart: { role: ConversationRole.ASSISTANT } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "first " } } } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "second" } } } },
			{ contentBlockStop: { contentBlockIndex: 0 } },
			{ messageStop: { stopReason: "end_turn" } },
			{ metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } },
		]);

		const thinking = final.content.find((b): b is ThinkingContent => b.type === "thinking");
		expect(thinking, "thinking block present").toBeDefined();
		expect(thinking?.thinking).toBe("first second");
	});

	it("concatenates reasoningContent.signature deltas into thinkingSignature", async () => {
		const final = await collectFinal([
			{ messageStart: { role: ConversationRole.ASSISTANT } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "x" } } } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig-a" } } } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig-b" } } } },
			{ contentBlockStop: { contentBlockIndex: 0 } },
			{ messageStop: { stopReason: "end_turn" } },
			{ metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } },
		]);

		const thinking = final.content.find((b): b is ThinkingContent => b.type === "thinking");
		expect(thinking?.thinking).toBe("x");
		expect(thinking?.thinkingSignature).toBe("sig-asig-b");
	});

	it("interleaves text and signature deltas, preserving both accumulations", async () => {
		const final = await collectFinal([
			{ messageStart: { role: ConversationRole.ASSISTANT } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "abc" } } } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "s1" } } } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "def" } } } },
			{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "s2" } } } },
			{ contentBlockStop: { contentBlockIndex: 0 } },
			{ messageStop: { stopReason: "end_turn" } },
			{ metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } },
		]);

		const thinking = final.content.find((b): b is ThinkingContent => b.type === "thinking");
		expect(thinking?.thinking).toBe("abcdef");
		expect(thinking?.thinkingSignature).toBe("s1s2");
	});

	it("emits thinking_delta events for each text delta", async () => {
		vi.spyOn(BedrockRuntimeClient.prototype, "send").mockImplementation((() =>
			Promise.resolve(
				fakeStreamResponse([
					{ messageStart: { role: ConversationRole.ASSISTANT } },
					{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "alpha" } } } },
					{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "beta" } } } },
					{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig" } } } },
					{ contentBlockStop: { contentBlockIndex: 0 } },
					{ messageStop: { stopReason: "end_turn" } },
					{ metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } },
				]),
			)) as unknown as BedrockRuntimeClient["send"]);

		const model = getModel("amazon-bedrock", "anthropic.claude-opus-4-7");
		const stream = streamBedrock(model, makeContext(), {
			awsAuthentication: "apikey",
			awsBedrockApiKey: "dummy-test-key",
			awsRegion: "us-east-1",
			reasoning: "high",
		});

		const deltas: string[] = [];
		for await (const event of stream) {
			if (event.type === "thinking_delta") {
				deltas.push(event.delta);
			}
		}

		expect(deltas).toEqual(["alpha", "beta"]);
	});
});
