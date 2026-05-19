/**
 * Bedrock interactive setup flow.
 *
 * `BedrockSetupFlow` orchestrates the full setup, composing existing TUI
 * primitives (no new components introduced):
 *
 *   1. Four-way auth mode radio (ExtensionSelectorComponent).
 *   2. Mode-specific text prompts (LoginDialogComponent.showPrompt, chained).
 *   3. AWS region prompt (same dialog).
 *   4. Advanced options gate (ExtensionSelectorComponent radio, skip-by-default).
 *      On opt-in, five chained sub-prompts cover:
 *        5a. VPC endpoint URL (text, optional; blank skips)
 *        5b. Cross-region inference (Yes/No, default Yes)
 *        5c. Global inference (Yes/No, default Yes)
 *        5d. Prompt cache (Yes/No, default Yes)
 *        5e. 1M context (Yes/No, default No)
 *   6. Assemble BedrockAuthConfig via the pure buildBedrockAuthConfigFromSetup
 *      helper in ../../../core/bedrock-setup-config.
 *
 * Skip-by-default keeps the Cline-parity default path one keystroke away —
 * 95% of Bedrock users want true/true/true/false and shouldn't have to walk
 * through five extra prompts to land on the same config.
 */

import type { Container, TUI } from "@earendil-works/pi-tui";
import type { BedrockAuthConfig } from "../../../core/auth-storage.js";
import {
	type BedrockSetupInputs,
	type BedrockSetupMode,
	buildBedrockAuthConfigFromSetup,
} from "../../../core/bedrock-setup-config.js";
import { theme } from "../theme/theme.js";
import { ExtensionSelectorComponent } from "./extension-selector.js";
import { LoginDialogComponent } from "./login-dialog.js";

/**
 * Labels for the four-way mode radio. These strings are what the user sees.
 */
const MODE_LABELS: Record<BedrockSetupMode, string> = {
	apikey: "AWS Bedrock API Key (bearer token)",
	profile: "AWS Profile (uses ~/.aws/credentials)",
	credentials: "AWS Credentials (access key + secret)",
	default: "Default Credential Chain (env vars, IMDS, etc.)",
};

const LABEL_TO_MODE = new Map<string, BedrockSetupMode>(
	(Object.entries(MODE_LABELS) as [BedrockSetupMode, string][]).map(([mode, label]) => [label, mode]),
);

const REGION_PLACEHOLDER = "us-east-1";

const ENDPOINT_PLACEHOLDER = "https://vpce-0abc.bedrock-runtime.us-east-1.vpce.amazonaws.com";

/**
 * Advanced-options gate labels. Order matters — "Skip" is first so the
 * default cursor lands on it.
 */
const ADVANCED_GATE_LABELS = {
	skip: "Skip — use defaults (recommended)",
	customize: "Customize advanced options",
} as const;

const YES_RECOMMENDED = "Yes (recommended)";
const NO_PLAIN = "No";
const YES_PLAIN = "Yes";
const NO_DEFAULT = "No (default)";

/**
 * Orchestrates the interactive Bedrock setup flow. Compose-only: delegates
 * to existing ExtensionSelectorComponent + LoginDialogComponent primitives.
 * Mount/unmount lifecycle is managed by the caller via `onMount`/`onUnmount`
 * callbacks so this module stays free of editor-container coupling.
 */
export class BedrockSetupFlow {
	constructor(
		private readonly tui: TUI,
		private readonly providerId: string,
		private readonly providerName: string,
		private readonly onMount: (component: Container) => void,
		private readonly onUnmount: () => void,
	) {}

	/**
	 * Run the full flow. Resolves with the assembled `BedrockAuthConfig`, or
	 * rejects with Error("Setup cancelled") if the user escapes at any step.
	 */
	async run(): Promise<BedrockAuthConfig> {
		const mode = await this.pickMode();

		const dialog = new LoginDialogComponent(
			this.tui,
			this.providerId,
			() => {
				// Completion handled below via resolved/rejected promises.
			},
			this.providerName,
			`Amazon Bedrock setup — ${MODE_LABELS[mode]}`,
		);

		this.onMount(dialog);

		try {
			const inputs: BedrockSetupInputs = { mode };

			if (mode === "apikey") {
				const apiKey = (await dialog.showPrompt("Enter AWS Bedrock API Key (bearer token):")).trim();
				if (!apiKey) {
					throw new Error("API key cannot be empty.");
				}
				inputs.apiKey = apiKey;
			} else if (mode === "profile") {
				const profile = (await dialog.showPrompt("Enter AWS profile name (leave empty for default):")).trim();
				inputs.profile = profile || undefined;
			} else if (mode === "credentials") {
				const accessKey = (await dialog.showPrompt("Enter AWS Access Key ID:")).trim();
				if (!accessKey) {
					throw new Error("Access key ID cannot be empty.");
				}
				const secretKey = (await dialog.showPrompt("Enter AWS Secret Access Key:")).trim();
				if (!secretKey) {
					throw new Error("Secret access key cannot be empty.");
				}
				const sessionToken = (
					await dialog.showPrompt("Enter AWS Session Token (optional — leave empty to skip):")
				).trim();
				inputs.accessKey = accessKey;
				inputs.secretKey = secretKey;
				inputs.sessionToken = sessionToken || undefined;
			}
			// `default` mode has no per-mode fields.

			const region = (
				await dialog.showPrompt(`Enter AWS region (leave empty for ${REGION_PLACEHOLDER}):`, REGION_PLACEHOLDER)
			).trim();
			inputs.region = region || undefined;

			// Step 4: advanced-options gate. Dialog is unmounted while the
			// selector is on screen, then re-mounted for any chained
			// sub-prompts so showPrompt() has a live container to render
			// into.
			this.onUnmount();
			const customize = await this.pickAdvancedGate();
			if (customize) {
				this.onMount(dialog);
				inputs.endpoint = await this.promptEndpoint(dialog);
				this.onUnmount();
				inputs.useCrossRegionInference = await this.pickBoolean(
					"Use Cross-Region Inference (us./eu. prefix)?",
					"Recommended. Routes traffic to nearest region for higher throughput. Required for some Anthropic models on Bedrock.",
					true,
				);
				inputs.useGlobalInference = await this.pickBoolean(
					"Use Global Inference (global. prefix)?",
					"Recommended. When both Cross-Region and Global are enabled, Global is preferred for models that support it.",
					true,
				);
				inputs.usePromptCache = await this.pickBoolean(
					"Enable prompt caching for Bedrock?",
					"Recommended. Caches reusable prompt prefixes to reduce cost and latency. Only takes effect on models that support it; ignored otherwise.",
					true,
				);
				inputs.enable1MContext = await this.pickBoolean(
					"Enable 1M context window?",
					"Adds the anthropic-beta: context-1m-2025-08-07 header. Only takes effect on Claude Sonnet 4.5+ and Opus 4.x models on Bedrock. Ignored on other models.",
					false,
				);
			}

			return buildBedrockAuthConfigFromSetup(inputs);
		} finally {
			// Idempotent: the inner pickMode / pickAdvancedGate / pickBoolean
			// helpers each unmount their own selector when the user picks or
			// cancels. This final unmount catches any path that rejected
			// before the selector callback fired and is harmless on the
			// happy path because the caller-supplied callback (restoreEditor)
			// is itself idempotent.
			this.onUnmount();
		}
	}

	private pickMode(): Promise<BedrockSetupMode> {
		return new Promise<BedrockSetupMode>((resolve, reject) => {
			const selector = new ExtensionSelectorComponent(
				theme.fg("accent", theme.bold(`Amazon Bedrock setup — choose auth method for ${this.providerName}`)),
				Object.values(MODE_LABELS),
				(label) => {
					const mode = LABEL_TO_MODE.get(label);
					this.onUnmount();
					if (!mode) {
						reject(new Error("Setup cancelled"));
						return;
					}
					resolve(mode);
				},
				() => {
					this.onUnmount();
					reject(new Error("Setup cancelled"));
				},
			);

			this.onMount(selector);
		});
	}

	/**
	 * Step 4 — the "skip vs customize" gate. Resolves true when the user
	 * picks "Customize advanced options"; resolves false when the user picks
	 * "Skip" or presses Enter on the default cursor; rejects on Esc.
	 */
	private pickAdvancedGate(): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			const selector = new ExtensionSelectorComponent(
				"Amazon Bedrock setup — advanced options",
				[ADVANCED_GATE_LABELS.skip, ADVANCED_GATE_LABELS.customize],
				(label) => {
					this.onUnmount();
					resolve(label === ADVANCED_GATE_LABELS.customize);
				},
				() => {
					this.onUnmount();
					reject(new Error("Setup cancelled"));
				},
			);

			this.onMount(selector);
		});
	}

	/**
	 * VPC endpoint prompt with empty-allowed and URL parse validation.
	 *
	 * Empty input → undefined (no override).
	 * Non-empty input with no scheme → "https://" auto-prefixed.
	 * Invalid URL → re-prompt inline (does not abort the flow).
	 *
	 * The dialog is the same one used for region / credentials, mounted by
	 * the caller before this method runs.
	 */
	private async promptEndpoint(dialog: LoginDialogComponent): Promise<string | undefined> {
		// Loop until the user submits an empty string (skip), a valid URL,
		// or cancels. Cancel propagates as a rejection from showPrompt.
		// Limit iterations to avoid runaway loops in misconfigured terminals.
		for (let attempt = 0; attempt < 10; attempt++) {
			const raw = (
				await dialog.showPrompt(
					"Enter VPC endpoint URL (leave empty for the default AWS Bedrock endpoint):",
					ENDPOINT_PLACEHOLDER,
				)
			).trim();

			if (raw.length === 0) return undefined;

			const candidate = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;

			try {
				new URL(candidate);
				return candidate;
			} catch {
				// Show the error inline; the next showPrompt() call appends
				// more lines to the dialog content container, mirroring
				// the existing inline-error pattern in showApiKeyLoginDialog.
				dialog.showProgress(theme.fg("warning", `Invalid URL: ${raw}. Please enter a valid URL or leave empty.`));
				this.tui.requestRender();
			}
		}
		throw new Error("Endpoint validation gave up after too many invalid attempts.");
	}

	/**
	 * Generic two-option Yes/No radio with a help line under the title.
	 * Recommended-first ordering; the default cursor lands on the
	 * recommended option (i.e. the value matching `defaultValue`).
	 */
	private pickBoolean(headline: string, helpText: string, defaultValue: boolean): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			const yesLabel = defaultValue ? YES_RECOMMENDED : YES_PLAIN;
			const noLabel = defaultValue ? NO_PLAIN : NO_DEFAULT;
			const options = defaultValue ? [yesLabel, noLabel] : [noLabel, yesLabel];

			// Compose the title with a dim-styled help line below the
			// headline. ExtensionSelectorComponent renders the title via a
			// single Text() that accepts multi-line content.
			const title = `${theme.fg("accent", theme.bold(headline))}\n${theme.fg("dim", helpText)}`;

			const selector = new ExtensionSelectorComponent(
				title,
				options,
				(label) => {
					this.onUnmount();
					resolve(label === yesLabel);
				},
				() => {
					this.onUnmount();
					reject(new Error("Setup cancelled"));
				},
			);

			this.onMount(selector);
		});
	}
}
