/**
 * Pure (TUI-free) helpers for assembling a BedrockAuthConfig from the inputs
 * collected by the interactive Bedrock setup flow. Kept separate from the TUI
 * component so it can be unit-tested without pulling in the pi-tui runtime.
 */

import type { BedrockAuthConfig } from "./auth-storage.js";

export type BedrockSetupMode = "apikey" | "profile" | "credentials" | "default";

export interface BedrockSetupInputs {
	mode: BedrockSetupMode;
	apiKey?: string;
	profile?: string;
	accessKey?: string;
	secretKey?: string;
	sessionToken?: string;
	region?: string;
}

/**
 * Assemble the canonical BedrockAuthConfig from the raw inputs the user
 * supplied through the four-mode interactive setup. The feature-toggle
 * defaults match Cline so a Cline user hitting Pi for the first time gets
 * the same behavior without touching auth.json.
 */
export function buildBedrockAuthConfigFromSetup(inputs: BedrockSetupInputs): BedrockAuthConfig {
	const region = inputs.region?.trim() || "us-east-1";
	return {
		awsAuthentication: inputs.mode,
		awsRegion: region,
		awsBedrockApiKey: inputs.apiKey,
		awsProfile: inputs.profile,
		awsAccessKey: inputs.accessKey,
		awsSecretKey: inputs.secretKey,
		awsSessionToken: inputs.sessionToken,
		awsUseCrossRegionInference: true,
		awsUseGlobalInference: true,
		awsBedrockUsePromptCache: true,
		enable1MContext: false,
	};
}
