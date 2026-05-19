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

	/**
	 * Optional advanced toggles. When undefined (user took the "Skip" path
	 * through the advanced-options gate), buildBedrockAuthConfigFromSetup
	 * applies Cline-parity defaults below.
	 */
	endpoint?: string;
	useCrossRegionInference?: boolean;
	useGlobalInference?: boolean;
	usePromptCache?: boolean;
	enable1MContext?: boolean;
}

/**
 * Cline-parity defaults for the four boolean Bedrock toggles. Exported so the
 * migration helper can backfill missing keys with the same canonical values
 * the setup flow uses on first write. Endpoint is omitted because its
 * "default" is `undefined` (no override).
 */
export const BEDROCK_TOGGLE_DEFAULTS = {
	awsUseCrossRegionInference: true,
	awsUseGlobalInference: true,
	awsBedrockUsePromptCache: true,
	enable1MContext: false,
} as const;

/**
 * Assemble the canonical BedrockAuthConfig from the raw inputs the user
 * supplied through the interactive setup. Toggle defaults match Cline so a
 * Cline user hitting Pi for the first time gets the same behavior without
 * touching auth.json. When the user opts into the advanced-options gate and
 * sets a toggle explicitly, the explicit value wins.
 */
export function buildBedrockAuthConfigFromSetup(inputs: BedrockSetupInputs): BedrockAuthConfig {
	const region = inputs.region?.trim() || "us-east-1";
	const endpointRaw = inputs.endpoint?.trim();
	const endpoint = endpointRaw && endpointRaw.length > 0 ? endpointRaw : undefined;
	return {
		awsAuthentication: inputs.mode,
		awsRegion: region,
		awsBedrockApiKey: inputs.apiKey,
		awsProfile: inputs.profile,
		awsAccessKey: inputs.accessKey,
		awsSecretKey: inputs.secretKey,
		awsSessionToken: inputs.sessionToken,
		awsBedrockEndpoint: endpoint,
		awsUseCrossRegionInference: inputs.useCrossRegionInference ?? BEDROCK_TOGGLE_DEFAULTS.awsUseCrossRegionInference,
		awsUseGlobalInference: inputs.useGlobalInference ?? BEDROCK_TOGGLE_DEFAULTS.awsUseGlobalInference,
		awsBedrockUsePromptCache: inputs.usePromptCache ?? BEDROCK_TOGGLE_DEFAULTS.awsBedrockUsePromptCache,
		enable1MContext: inputs.enable1MContext ?? BEDROCK_TOGGLE_DEFAULTS.enable1MContext,
	};
}
