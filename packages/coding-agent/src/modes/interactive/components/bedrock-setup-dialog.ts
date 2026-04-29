/**
 * Bedrock interactive setup flow.
 *
 * `BedrockSetupFlow` orchestrates four steps, composing existing primitives:
 *
 *   1. Four-way auth mode radio (ExtensionSelectorComponent).
 *   2. Mode-specific text prompts (LoginDialogComponent.showPrompt, chained).
 *   3. AWS region prompt (same dialog).
 *   4. Assemble BedrockAuthConfig via the pure buildBedrockAuthConfigFromSetup
 *      helper in ../../../core/bedrock-setup-config.
 *
 * MVP scope: the feature toggles (cross-region inference, global inference,
 * prompt cache, 1M-context) are NOT exposed in the UI in this pass. They
 * persist as Cline-parity defaults. Users who need to change them can edit
 * `auth.json` directly. A follow-up task can layer toggles on top without
 * changing the persisted shape — it already carries them.
 */

import type { Container, TUI } from "@mariozechner/pi-tui";
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

/**
 * Orchestrates the four-step interactive Bedrock setup flow. Compose-only:
 * delegates to the existing ExtensionSelectorComponent + LoginDialogComponent
 * primitives. Mount/unmount lifecycle is managed by the caller via
 * `onMount`/`onUnmount` callbacks so this module stays free of editor-container
 * coupling.
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

			return buildBedrockAuthConfigFromSetup(inputs);
		} finally {
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
}
