/**
 * Tests for the BedrockSetupFlow orchestrator (interactive Bedrock setup).
 *
 * The flow composes ExtensionSelectorComponent (mode radio + advanced gate +
 * boolean toggles) and LoginDialogComponent (text prompts). Both primitives
 * are mocked so we can drive the flow deterministically and assert on the
 * sequence + arguments of prompts that the user would see.
 *
 * What this file covers (gaps in the existing bedrock-* test files):
 *   1. Conditional prompt fan-out by mode (apikey/profile/credentials/default).
 *   2. Skip-vs-customize advanced gate produces Cline-parity defaults vs
 *      user-entered values.
 *   3. Validation errors propagate (empty api key / access key / secret key).
 *   4. Setup-cancelled rejections from the mode picker, advanced gate, and
 *      boolean toggle steps abort the flow without partial persistence.
 *   5. End-to-end region/endpoint/toggle plumbing into the assembled config.
 *   6. VPC URL validation: auto-prefix on bare host, accept-on-valid,
 *      re-prompt on malformed, give-up after 10 invalid attempts.
 *   7. Mount/unmount lifecycle book-keeping (each prompt/selector mount has
 *      a matching unmount).
 *
 * Mocks: only ./extension-selector.js and ./login-dialog.js. The pure
 * helper buildBedrockAuthConfigFromSetup is the real one — we want to
 * confirm the orchestrator hands the correct `BedrockSetupInputs` to it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

// theme is read at construction time by the real ExtensionSelectorComponent
// title formatter inside BedrockSetupFlow.pickMode (not the mock — the
// mock replaces the SUT's selector class but the SUT still passes a
// theme.bold(...) string in). Initialize once so subsequent test cases
// can call into theme.fg() / theme.bold() without a runtime crash.
beforeAll(() => {
	initTheme("dark");
});

// Mock the TUI primitives BEFORE importing the SUT (BedrockSetupFlow).

vi.mock("../src/modes/interactive/components/extension-selector.js", () => {
	type SelectCb = (option: string) => void;
	type CancelCb = () => void;

	class ExtensionSelectorComponent {
		// Captured for assertions; static so individual tests can read the latest one.
		static lastInstance: ExtensionSelectorComponent | undefined;

		constructor(
			public title: string,
			public options: string[],
			public onSelect: SelectCb,
			public onCancel: CancelCb,
		) {
			ExtensionSelectorComponent.lastInstance = this;
		}
	}

	return { ExtensionSelectorComponent };
});

vi.mock("../src/modes/interactive/components/login-dialog.js", () => {
	type ScriptedAnswer = string | { error: Error };

	class LoginDialogComponent {
		// Per-instance scripted answer queue. The test seeds answers before
		// the flow runs, and showPrompt() shifts them off in order.
		static answers: ScriptedAnswer[] = [];
		static promptCalls: { label: string; placeholder?: string }[] = [];
		static progressCalls: string[] = [];

		// No constructor — biome flags an unnecessary one. The flow calls
		// `new LoginDialogComponent(tui, providerId, ...)` but we don't
		// need to capture those args; default JS behaviour discards them.

		async showPrompt(label: string, placeholder?: string): Promise<string> {
			LoginDialogComponent.promptCalls.push({ label, placeholder });
			const next = LoginDialogComponent.answers.shift();
			if (next === undefined) throw new Error(`unexpected showPrompt call: ${label}`);
			if (typeof next === "object" && "error" in next) throw next.error;
			return next;
		}

		showProgress(text: string): void {
			LoginDialogComponent.progressCalls.push(text);
		}
	}

	return { LoginDialogComponent };
});

// SUT must be imported AFTER vi.mock calls so the mocked primitives wire in.
// Keep these as plain `import` statements at top level — vi.mock is hoisted
// above imports automatically by vitest.
import { BedrockSetupFlow } from "../src/modes/interactive/components/bedrock-setup-dialog.js";
import { ExtensionSelectorComponent as RealSelector } from "../src/modes/interactive/components/extension-selector.js";
import { LoginDialogComponent as RealDialog } from "../src/modes/interactive/components/login-dialog.js";

// Type aliases for reading mock state in tests. The mocked classes carry
// extra static state (answers/promptCalls/lastInstance/etc.) that we
// access via these casts.
interface ExtensionSelectorShape {
	title: string;
	options: string[];
	onSelect: (label: string) => void;
	onCancel: () => void;
}
interface ExtensionSelectorClassExtras {
	lastInstance?: ExtensionSelectorShape;
}
interface LoginDialogClassExtras {
	answers: (string | { error: Error })[];
	promptCalls: { label: string; placeholder?: string }[];
	progressCalls: string[];
}

const Selector = RealSelector as unknown as ExtensionSelectorClassExtras;
const Dialog = RealDialog as unknown as LoginDialogClassExtras;

/**
 * Build a fresh harness: a flow plus the per-test pending-selector queue.
 *
 * The selector primitive captures its callbacks synchronously in the
 * constructor (called inside `flow.run()` -> `pickMode()`), but the flow
 * waits on them asynchronously. We model that by collecting every selector
 * the flow mounts into a queue so the test can dispatch select/cancel in
 * the right order, mirroring what a user would do.
 */
function buildHarness() {
	const tui = { requestRender: vi.fn() } as unknown as ConstructorParameters<typeof BedrockSetupFlow>[0];
	const onMount = vi.fn();
	const onUnmount = vi.fn();

	// Pending selectors are produced one-per-mount call. We rely on the
	// fact that ExtensionSelectorComponent's constructor records itself as
	// the `lastInstance`; chaining through onMount lets us snapshot it
	// each time and act before returning to the awaiting flow.
	const selectors: ExtensionSelectorShape[] = [];
	onMount.mockImplementation((component: unknown) => {
		if (component instanceof RealSelector) {
			selectors.push(component as unknown as ExtensionSelectorShape);
		}
	});

	const flow = new BedrockSetupFlow(tui, "bedrock", "Amazon Bedrock", onMount, onUnmount);
	return { flow, tui, onMount, onUnmount, selectors };
}

/** Drive the next pending selector's onSelect with the given label. Awaits a microtask so the flow continues. */
async function dispatchSelect(selectors: ExtensionSelectorShape[], label: string): Promise<void> {
	const sel = selectors.shift();
	if (!sel) throw new Error("no pending selector to dispatch");
	const labelExists = sel.options.includes(label);
	if (!labelExists) throw new Error(`label "${label}" not in selector options [${sel.options.join(", ")}]`);
	sel.onSelect(label);
	// Yield so the flow's awaiting promise can continue past resolve().
	await Promise.resolve();
}

async function dispatchCancel(selectors: ExtensionSelectorShape[]): Promise<void> {
	const sel = selectors.shift();
	if (!sel) throw new Error("no pending selector to dispatch");
	sel.onCancel();
	await Promise.resolve();
}

beforeEach(() => {
	Dialog.answers = [];
	Dialog.promptCalls = [];
	Dialog.progressCalls = [];
	(Selector as { lastInstance?: unknown }).lastInstance = undefined;
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("BedrockSetupFlow.run — happy paths (skip-by-default)", () => {
	it("apikey mode + skip advanced → Cline-parity defaults, two text prompts only", async () => {
		const { flow, selectors, onMount, onUnmount } = buildHarness();
		Dialog.answers = ["AWSBR-XXXX", ""]; // api key, region (empty → us-east-1 fallback)

		const promise = flow.run();
		// 1. mode picker
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		// 2. (no more selectors until advanced gate). Advance through the
		//    text prompts (already answered above), then advanced gate.
		// Wait a microtask so the flow has a chance to mount the gate.
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Skip — use defaults (recommended)");

		const config = await promise;
		expect(config.awsAuthentication).toBe("apikey");
		expect(config.awsBedrockApiKey).toBe("AWSBR-XXXX");
		expect(config.awsRegion).toBe("us-east-1");
		expect(config.awsBedrockEndpoint).toBeUndefined();
		expect(config.awsUseCrossRegionInference).toBe(true);
		expect(config.awsUseGlobalInference).toBe(true);
		expect(config.awsBedrockUsePromptCache).toBe(true);
		expect(config.enable1MContext).toBe(false);

		// Exactly two prompts surfaced: api key + region.
		expect(Dialog.promptCalls.map((c) => c.label)).toEqual([
			"Enter AWS Bedrock API Key (bearer token):",
			"Enter AWS region (leave empty for us-east-1):",
		]);
		// Mount/unmount balance: mode-selector(+/-) + dialog(+/-) + gate(+/-) = 3 mounts/3 unmounts.
		// The flow's finally-block also fires onUnmount, so the unmount count is one ahead.
		expect(onMount).toHaveBeenCalledTimes(3);
		expect(onUnmount.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it("profile mode → no api key / access key prompts, profile prompt only", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["work", "us-west-2"]; // profile, region

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Profile (uses ~/.aws/credentials)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Skip — use defaults (recommended)");

		const config = await promise;
		expect(config.awsAuthentication).toBe("profile");
		expect(config.awsProfile).toBe("work");
		expect(config.awsRegion).toBe("us-west-2");
		expect(Dialog.promptCalls.map((c) => c.label)).toEqual([
			"Enter AWS profile name (leave empty for default):",
			"Enter AWS region (leave empty for us-east-1):",
		]);
	});

	it("profile mode + empty profile → undefined awsProfile (means default profile)", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["", ""]; // profile=empty, region=empty

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Profile (uses ~/.aws/credentials)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Skip — use defaults (recommended)");

		const config = await promise;
		expect(config.awsProfile).toBeUndefined();
	});

	it("credentials mode → access key + secret + optional session token prompts", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AKIAEXAMPLE", "secret-shh", "session-token", "us-east-1"];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Credentials (access key + secret)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Skip — use defaults (recommended)");

		const config = await promise;
		expect(config.awsAuthentication).toBe("credentials");
		expect(config.awsAccessKey).toBe("AKIAEXAMPLE");
		expect(config.awsSecretKey).toBe("secret-shh");
		expect(config.awsSessionToken).toBe("session-token");
		expect(Dialog.promptCalls.map((c) => c.label)).toEqual([
			"Enter AWS Access Key ID:",
			"Enter AWS Secret Access Key:",
			"Enter AWS Session Token (optional — leave empty to skip):",
			"Enter AWS region (leave empty for us-east-1):",
		]);
	});

	it("credentials mode + empty session token → awsSessionToken is undefined", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AKIAEXAMPLE", "secret-shh", "", ""];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Credentials (access key + secret)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Skip — use defaults (recommended)");

		const config = await promise;
		expect(config.awsSessionToken).toBeUndefined();
	});

	it("default mode → no per-mode prompts, region only", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["eu-west-1"]; // region only

		const promise = flow.run();
		await dispatchSelect(selectors, "Default Credential Chain (env vars, IMDS, etc.)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Skip — use defaults (recommended)");

		const config = await promise;
		expect(config.awsAuthentication).toBe("default");
		expect(config.awsRegion).toBe("eu-west-1");
		expect(Dialog.promptCalls.map((c) => c.label)).toEqual(["Enter AWS region (leave empty for us-east-1):"]);
	});
});

describe("BedrockSetupFlow.run — customize advanced path", () => {
	it("customize → drives endpoint + four boolean toggles into config", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AWSBR-XXXX", "us-east-1", "https://vpce-0abc.bedrock-runtime.us-east-1.vpce.amazonaws.com"];

		const promise = flow.run();
		// 1. mode picker
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		await new Promise((r) => setImmediate(r));
		// 2. advanced gate → customize
		await dispatchSelect(selectors, "Customize advanced options");
		await new Promise((r) => setImmediate(r));
		// 3..6 four boolean toggles. The flow flips defaults: cross/global/cache=true, 1M=false.
		// The Yes-recommended option is ordered first when default is true, "No (default)"
		// first when default is false. We pick the non-default everywhere to prove the
		// inputs reach buildBedrockAuthConfigFromSetup correctly.
		await dispatchSelect(selectors, "No"); // useCrossRegionInference → false
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "No"); // useGlobalInference → false
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "No"); // usePromptCache → false
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes"); // enable1MContext → true

		const config = await promise;
		expect(config.awsBedrockEndpoint).toBe("https://vpce-0abc.bedrock-runtime.us-east-1.vpce.amazonaws.com");
		expect(config.awsUseCrossRegionInference).toBe(false);
		expect(config.awsUseGlobalInference).toBe(false);
		expect(config.awsBedrockUsePromptCache).toBe(false);
		expect(config.enable1MContext).toBe(true);
	});

	it("customize → empty endpoint stays undefined; recommended toggles preserved", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AWSBR-XXXX", "us-east-1", ""]; // empty endpoint → undefined

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Customize advanced options");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "No (default)");

		const config = await promise;
		expect(config.awsBedrockEndpoint).toBeUndefined();
		expect(config.awsUseCrossRegionInference).toBe(true);
		expect(config.awsUseGlobalInference).toBe(true);
		expect(config.awsBedrockUsePromptCache).toBe(true);
		expect(config.enable1MContext).toBe(false);
	});
});

describe("BedrockSetupFlow.run — VPC endpoint URL validation", () => {
	it("auto-prefixes https:// when scheme missing", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AWSBR-XXXX", "us-east-1", "vpce-0abc.bedrock.example.com"];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Customize advanced options");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "No (default)");

		const config = await promise;
		expect(config.awsBedrockEndpoint).toBe("https://vpce-0abc.bedrock.example.com");
	});

	it("re-prompts on malformed URL; succeeds on next valid input", async () => {
		const { flow, selectors } = buildHarness();
		// First endpoint answer is truly malformed (https with empty host); second is valid.
		Dialog.answers = ["AWSBR-XXXX", "us-east-1", "https://", "https://valid.example.com"];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Customize advanced options");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "No (default)");

		const config = await promise;
		expect(config.awsBedrockEndpoint).toBe("https://valid.example.com");
		// One inline warning surfaced.
		const warnings = Dialog.progressCalls.filter((p) => /Invalid URL/.test(p));
		expect(warnings.length).toBe(1);
	});

	it("preserves explicit scheme verbatim (no double-prefix on http://)", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AWSBR-XXXX", "us-east-1", "http://10.0.0.5:8080"];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Customize advanced options");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Yes (recommended)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "No (default)");

		const config = await promise;
		expect(config.awsBedrockEndpoint).toBe("http://10.0.0.5:8080");
	});

	it("gives up after 10 invalid attempts with 'too many invalid attempts' error", async () => {
		const { flow, selectors } = buildHarness();
		// 10 malformed endpoint answers → flow throws.
		Dialog.answers = ["AWSBR-XXXX", "us-east-1", ...Array.from({ length: 10 }, () => "https://")];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Customize advanced options");

		await expect(promise).rejects.toThrow(/too many invalid attempts/);
	});
});

describe("BedrockSetupFlow.run — validation throws", () => {
	it("apikey mode + empty api key throws 'API key cannot be empty'", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["   "]; // whitespace-only api key

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");

		await expect(promise).rejects.toThrow("API key cannot be empty.");
	});

	it("credentials mode + empty access key throws", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = [""];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Credentials (access key + secret)");

		await expect(promise).rejects.toThrow("Access key ID cannot be empty.");
	});

	it("credentials mode + empty secret key throws", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AKIAEXAMPLE", ""];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Credentials (access key + secret)");

		await expect(promise).rejects.toThrow("Secret access key cannot be empty.");
	});
});

describe("BedrockSetupFlow.run — cancellation", () => {
	it("cancel at mode picker rejects with 'Setup cancelled'", async () => {
		const { flow, selectors } = buildHarness();

		const promise = flow.run();
		await dispatchCancel(selectors);

		await expect(promise).rejects.toThrow("Setup cancelled");
	});

	it("cancel at advanced gate rejects with 'Setup cancelled'", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AWSBR-XXXX", "us-east-1"];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		await new Promise((r) => setImmediate(r));
		await dispatchCancel(selectors);

		await expect(promise).rejects.toThrow("Setup cancelled");
	});

	it("cancel at first boolean toggle rejects with 'Setup cancelled'", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = ["AWSBR-XXXX", "us-east-1", ""]; // endpoint empty → skip URL validator

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");
		await new Promise((r) => setImmediate(r));
		await dispatchSelect(selectors, "Customize advanced options");
		await new Promise((r) => setImmediate(r));
		await dispatchCancel(selectors); // cancel cross-region toggle

		await expect(promise).rejects.toThrow("Setup cancelled");
	});

	it("dialog showPrompt rejection (e.g. user Esc on text input) propagates as-is", async () => {
		const { flow, selectors } = buildHarness();
		Dialog.answers = [{ error: new Error("Login cancelled") }];

		const promise = flow.run();
		await dispatchSelect(selectors, "AWS Bedrock API Key (bearer token)");

		await expect(promise).rejects.toThrow("Login cancelled");
	});
});
