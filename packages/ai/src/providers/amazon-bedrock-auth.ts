export type BedrockAuthMode = "apikey" | "profile" | "credentials" | "default";

export interface BedrockAuthInputs {
	/**
	 * AWS authentication mode. Typed as `string` rather than `BedrockAuthMode`
	 * because inputs often come from untrusted config JSON. `resolveBedrockAuthMode`
	 * narrows at runtime and falls through to inference on unknown values.
	 */
	awsAuthentication?: string;
	awsRegion?: string;
	awsBedrockApiKey?: string;
	awsProfile?: string;
	awsAccessKey?: string;
	awsSecretKey?: string;
	awsSessionToken?: string;
	awsBedrockEndpoint?: string;
	/** Legacy alias for awsBedrockApiKey; existing callers in BedrockOptions use this field. */
	bearerToken?: string;
	/** Legacy alias for awsProfile. */
	profile?: string;
	/** Legacy alias for awsRegion. */
	region?: string;
}

const VALID_MODES: readonly BedrockAuthMode[] = ["apikey", "profile", "credentials", "default"];

function isValidMode(value: string | undefined): value is BedrockAuthMode {
	return typeof value === "string" && VALID_MODES.includes(value as BedrockAuthMode);
}

/**
 * Resolves the Bedrock auth mode to use.
 *
 * Precedence:
 *   1. Explicit `awsAuthentication` when one of the four valid values.
 *   2. Inferred: bearer token → "apikey"; profile → "profile"; access+secret → "credentials".
 *   3. Fallback → "default" (let the AWS SDK resolve from env/IMDS/SSO).
 *
 * Unknown `awsAuthentication` values fall through to the inferred path. This is
 * deliberately permissive at the edge — an unknown mode string should not hide
 * a set of credentials the user clearly supplied.
 */
export function resolveBedrockAuthMode(inputs: BedrockAuthInputs): BedrockAuthMode {
	if (isValidMode(inputs.awsAuthentication)) {
		return inputs.awsAuthentication;
	}
	const apiKey = inputs.awsBedrockApiKey ?? inputs.bearerToken;
	if (apiKey) return "apikey";
	const profile = inputs.awsProfile ?? inputs.profile;
	if (profile && !(inputs.awsAccessKey && inputs.awsSecretKey)) return "profile";
	if (inputs.awsAccessKey && inputs.awsSecretKey) return "credentials";
	return "default";
}

export interface ResolvedBedrockClientInputs {
	region: string;
	endpoint?: string;
	profile?: string;
	token?: { token: string };
	authSchemePreference?: string[];
	credentials?: {
		accessKeyId: string;
		secretAccessKey: string;
		sessionToken?: string;
	};
}

export type BedrockAuthErrorCode =
	| "bedrock_auth_api_key_missing"
	| "bedrock_auth_credentials_missing"
	| "bedrock_auth_profile_missing";

export class BedrockAuthError extends Error {
	readonly code: BedrockAuthErrorCode;
	constructor(code: BedrockAuthErrorCode, message: string) {
		super(message);
		this.name = "BedrockAuthError";
		this.code = code;
	}
}

function stripBearerPrefix(token: string): string {
	const t = token.trim();
	const lower = t.toLowerCase();
	if (lower === "bearer") {
		return "";
	}
	if (lower.startsWith("bearer ")) {
		return t.slice(7).trim();
	}
	return t;
}

/**
 * Build SDK-shaped client inputs for the resolved auth mode.
 *
 * Each mode sets only its own fields; others stay undefined. Raises
 * BedrockAuthError when a mode is selected but its required inputs are missing.
 * "default" mode deliberately returns an empty auth payload so the AWS SDK
 * default credential chain applies at the call site.
 */
export function resolveBedrockClientInputs(inputs: BedrockAuthInputs): ResolvedBedrockClientInputs {
	const mode = resolveBedrockAuthMode(inputs);
	const region = inputs.awsRegion ?? inputs.region ?? "us-east-1";
	const result: ResolvedBedrockClientInputs = { region };

	if (inputs.awsBedrockEndpoint) {
		result.endpoint = inputs.awsBedrockEndpoint;
	}

	switch (mode) {
		case "apikey": {
			// Guard process access so browser builds don't ReferenceError on
			// apikey mode when callers forward credentials explicitly. The env
			// fallback is a Node-only convenience.
			const envToken = typeof process !== "undefined" ? process.env.AWS_BEARER_TOKEN_BEDROCK : undefined;
			const raw = (inputs.awsBedrockApiKey ?? inputs.bearerToken ?? envToken ?? "").trim();
			const stripped = stripBearerPrefix(raw);
			if (!stripped) {
				throw new BedrockAuthError(
					"bedrock_auth_api_key_missing",
					"Bedrock auth mode is 'apikey' but no key was provided (or value was empty after stripping 'Bearer' prefix) and AWS_BEARER_TOKEN_BEDROCK is unset.",
				);
			}
			result.token = { token: stripped };
			result.authSchemePreference = ["httpBearerAuth"];
			return result;
		}
		case "profile": {
			const profile = inputs.awsProfile ?? inputs.profile;
			if (profile) result.profile = profile;
			return result;
		}
		case "credentials": {
			if (!inputs.awsAccessKey || !inputs.awsSecretKey) {
				throw new BedrockAuthError(
					"bedrock_auth_credentials_missing",
					"Bedrock auth mode is 'credentials' but awsAccessKey or awsSecretKey is missing.",
				);
			}
			const creds: ResolvedBedrockClientInputs["credentials"] = {
				accessKeyId: inputs.awsAccessKey,
				secretAccessKey: inputs.awsSecretKey,
			};
			if (inputs.awsSessionToken) creds.sessionToken = inputs.awsSessionToken;
			result.credentials = creds;
			return result;
		}
		case "default":
			return result;
		default: {
			const _exhaustive: never = mode;
			throw new Error(`Unhandled Bedrock auth mode: ${String(_exhaustive)}`);
		}
	}
}
