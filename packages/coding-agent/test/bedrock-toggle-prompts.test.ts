import { describe, expect, it } from "vitest";
import { migrateLegacyBedrockAuth } from "../src/core/auth-storage.js";
import { BEDROCK_TOGGLE_DEFAULTS, buildBedrockAuthConfigFromSetup } from "../src/core/bedrock-setup-config.js";

describe("buildBedrockAuthConfigFromSetup — advanced toggles", () => {
	it("undefined toggles produce Cline-parity defaults", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default" });
		expect(config.awsBedrockEndpoint).toBeUndefined();
		expect(config.awsUseCrossRegionInference).toBe(BEDROCK_TOGGLE_DEFAULTS.awsUseCrossRegionInference);
		expect(config.awsUseGlobalInference).toBe(BEDROCK_TOGGLE_DEFAULTS.awsUseGlobalInference);
		expect(config.awsBedrockUsePromptCache).toBe(BEDROCK_TOGGLE_DEFAULTS.awsBedrockUsePromptCache);
		expect(config.enable1MContext).toBe(BEDROCK_TOGGLE_DEFAULTS.enable1MContext);
	});

	it("explicit false toggles persist as false (the user's choice wins over the recommended default)", () => {
		const config = buildBedrockAuthConfigFromSetup({
			mode: "default",
			useCrossRegionInference: false,
			useGlobalInference: false,
			usePromptCache: false,
		});
		expect(config.awsUseCrossRegionInference).toBe(false);
		expect(config.awsUseGlobalInference).toBe(false);
		expect(config.awsBedrockUsePromptCache).toBe(false);
	});

	it("explicit enable1MContext=true persists as true", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default", enable1MContext: true });
		expect(config.enable1MContext).toBe(true);
	});

	it("populated endpoint persists verbatim", () => {
		const config = buildBedrockAuthConfigFromSetup({
			mode: "apikey",
			apiKey: "bearer-xyz",
			endpoint: "https://vpce-0abc123.bedrock-runtime.us-east-1.vpce.amazonaws.com",
		});
		expect(config.awsBedrockEndpoint).toBe("https://vpce-0abc123.bedrock-runtime.us-east-1.vpce.amazonaws.com");
	});

	it("trims whitespace around endpoint input", () => {
		const config = buildBedrockAuthConfigFromSetup({
			mode: "default",
			endpoint: "   https://vpce.example.com   ",
		});
		expect(config.awsBedrockEndpoint).toBe("https://vpce.example.com");
	});

	it("empty endpoint is dropped to undefined (so it isn't serialised as an empty string)", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default", endpoint: "" });
		expect(config.awsBedrockEndpoint).toBeUndefined();
	});

	it("whitespace-only endpoint is dropped to undefined", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default", endpoint: "   " });
		expect(config.awsBedrockEndpoint).toBeUndefined();
	});

	it("mixing explicit toggles with absent toggles applies defaults only to absent ones", () => {
		const config = buildBedrockAuthConfigFromSetup({
			mode: "default",
			useCrossRegionInference: false,
			// useGlobalInference omitted → default true
			// usePromptCache omitted    → default true
			enable1MContext: true,
		});
		expect(config.awsUseCrossRegionInference).toBe(false);
		expect(config.awsUseGlobalInference).toBe(true);
		expect(config.awsBedrockUsePromptCache).toBe(true);
		expect(config.enable1MContext).toBe(true);
	});

	it("BEDROCK_TOGGLE_DEFAULTS exposes the canonical Cline-parity defaults", () => {
		expect(BEDROCK_TOGGLE_DEFAULTS).toEqual({
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		});
	});
});

describe("migrateLegacyBedrockAuth — round-trip stability with advanced toggles", () => {
	it("legacy api_key migration backfills all four boolean toggles to defaults", () => {
		const migrated = migrateLegacyBedrockAuth({ type: "api_key", key: "AWSBR-XXXX" });
		expect(migrated).not.toBeNull();
		expect(migrated?.awsBedrockEndpoint).toBeUndefined();
		expect(migrated?.awsUseCrossRegionInference).toBe(true);
		expect(migrated?.awsUseGlobalInference).toBe(true);
		expect(migrated?.awsBedrockUsePromptCache).toBe(true);
		expect(migrated?.enable1MContext).toBe(false);
	});

	it("bedrock-config wrapper missing all four boolean toggles backfills defaults", () => {
		const partial = {
			type: "bedrock-config" as const,
			awsAuthentication: "apikey" as const,
			awsRegion: "us-east-1",
			awsBedrockApiKey: "AWSBR-XXXX",
			// no toggle keys at all
		};
		const migrated = migrateLegacyBedrockAuth(partial);
		expect(migrated).toEqual({
			awsAuthentication: "apikey",
			awsRegion: "us-east-1",
			awsBedrockApiKey: "AWSBR-XXXX",
			awsProfile: undefined,
			awsAccessKey: undefined,
			awsSecretKey: undefined,
			awsSessionToken: undefined,
			awsBedrockEndpoint: undefined,
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		});
	});

	it("bedrock-config wrapper missing two of four toggles preserves the explicit ones and backfills the rest", () => {
		const partial = {
			type: "bedrock-config" as const,
			awsAuthentication: "apikey" as const,
			awsRegion: "us-east-1",
			awsBedrockApiKey: "AWSBR-XXXX",
			awsUseCrossRegionInference: false,
			enable1MContext: true,
			// awsUseGlobalInference + awsBedrockUsePromptCache missing
		};
		const migrated = migrateLegacyBedrockAuth(partial);
		expect(migrated?.awsUseCrossRegionInference).toBe(false);
		expect(migrated?.enable1MContext).toBe(true);
		// Backfilled with defaults.
		expect(migrated?.awsUseGlobalInference).toBe(true);
		expect(migrated?.awsBedrockUsePromptCache).toBe(true);
	});

	it("invalid-type toggles (e.g. string 'true') are coerced to defaults, not converted", () => {
		const partial = {
			type: "bedrock-config" as const,
			awsAuthentication: "apikey" as const,
			awsRegion: "us-east-1",
			awsBedrockApiKey: "AWSBR-XXXX",
			enable1MContext: "true" as unknown as boolean,
			awsUseCrossRegionInference: 1 as unknown as boolean,
		};
		const migrated = migrateLegacyBedrockAuth(partial);
		expect(migrated?.enable1MContext).toBe(false);
		expect(migrated?.awsUseCrossRegionInference).toBe(true);
	});

	it("empty-string awsBedrockEndpoint is normalised to undefined on read", () => {
		const partial = {
			type: "bedrock-config" as const,
			awsAuthentication: "apikey" as const,
			awsRegion: "us-east-1",
			awsBedrockApiKey: "AWSBR-XXXX",
			awsBedrockEndpoint: "",
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		};
		const migrated = migrateLegacyBedrockAuth(partial);
		expect(migrated?.awsBedrockEndpoint).toBeUndefined();
	});

	it("populated awsBedrockEndpoint round-trips unchanged", () => {
		const partial = {
			type: "bedrock-config" as const,
			awsAuthentication: "profile" as const,
			awsRegion: "us-east-1",
			awsProfile: "bedrock-prod",
			awsBedrockEndpoint: "https://vpce-0abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		};
		const migrated = migrateLegacyBedrockAuth(partial);
		expect(migrated?.awsBedrockEndpoint).toBe("https://vpce-0abc.bedrock-runtime.us-east-1.vpce.amazonaws.com");
	});

	it("unknown future keys (e.g. awsFutureToggle) are dropped on read", () => {
		const partial = {
			type: "bedrock-config" as const,
			awsAuthentication: "apikey" as const,
			awsRegion: "us-east-1",
			awsBedrockApiKey: "AWSBR-XXXX",
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
			awsFutureToggle: true,
			somethingNew: "wibble",
		};
		const migrated = migrateLegacyBedrockAuth(partial);
		expect(migrated).not.toBeNull();
		expect(migrated as unknown as Record<string, unknown>).not.toHaveProperty("awsFutureToggle");
		expect(migrated as unknown as Record<string, unknown>).not.toHaveProperty("somethingNew");
	});

	it("read(write(setup-output)) === read(write(setup-output)) — round-trip stable for full advanced setup", () => {
		const original = buildBedrockAuthConfigFromSetup({
			mode: "apikey",
			apiKey: "AWSBR-XXXX",
			region: "us-east-1",
			endpoint: "https://vpce.example.com",
			useCrossRegionInference: false,
			useGlobalInference: false,
			usePromptCache: false,
			enable1MContext: true,
		});
		const wrapped = { type: "bedrock-config" as const, ...original };
		const once = migrateLegacyBedrockAuth(wrapped);
		expect(once).toEqual(original);
		const twice = migrateLegacyBedrockAuth({ type: "bedrock-config" as const, ...(once as object) });
		expect(twice).toEqual(once);
	});

	it("falls back to us-east-1 when migration receives empty awsRegion", () => {
		const partial = {
			type: "bedrock-config" as const,
			awsAuthentication: "default" as const,
			awsRegion: "",
		};
		const migrated = migrateLegacyBedrockAuth(partial);
		expect(migrated?.awsRegion).toBe("us-east-1");
	});

	it("falls back to us-east-1 when migration receives whitespace-only awsRegion", () => {
		const partial = {
			type: "bedrock-config" as const,
			awsAuthentication: "default" as const,
			awsRegion: "   ",
		};
		const migrated = migrateLegacyBedrockAuth(partial);
		expect(migrated?.awsRegion).toBe("us-east-1");
	});
});
