import { describe, expect, it } from "vitest";
import { migrateLegacyBedrockAuth } from "../src/core/auth-storage.js";
import { buildBedrockAuthConfigFromSetup } from "../src/core/bedrock-setup-config.js";

describe("buildBedrockAuthConfigFromSetup", () => {
	it("apikey mode produces BedrockAuthConfig with awsBedrockApiKey and Cline-parity defaults", () => {
		const config = buildBedrockAuthConfigFromSetup({
			mode: "apikey",
			apiKey: "bearer-xyz",
			region: "us-west-2",
		});
		expect(config).toEqual({
			awsAuthentication: "apikey",
			awsRegion: "us-west-2",
			awsBedrockApiKey: "bearer-xyz",
			awsProfile: undefined,
			awsAccessKey: undefined,
			awsSecretKey: undefined,
			awsSessionToken: undefined,
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		});
	});

	it("profile mode produces BedrockAuthConfig with awsProfile set", () => {
		const config = buildBedrockAuthConfigFromSetup({
			mode: "profile",
			profile: "work",
			region: "eu-west-1",
		});
		expect(config.awsAuthentication).toBe("profile");
		expect(config.awsProfile).toBe("work");
		expect(config.awsRegion).toBe("eu-west-1");
		expect(config.awsBedrockApiKey).toBeUndefined();
		expect(config.awsAccessKey).toBeUndefined();
	});

	it("profile mode leaves awsProfile undefined when empty (means 'default' profile)", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "profile" });
		expect(config.awsAuthentication).toBe("profile");
		expect(config.awsProfile).toBeUndefined();
	});

	it("credentials mode produces BedrockAuthConfig with access key, secret, optional session token", () => {
		const config = buildBedrockAuthConfigFromSetup({
			mode: "credentials",
			accessKey: "AKIA0000",
			secretKey: "secret",
			sessionToken: "sess",
			region: "us-east-1",
		});
		expect(config.awsAuthentication).toBe("credentials");
		expect(config.awsAccessKey).toBe("AKIA0000");
		expect(config.awsSecretKey).toBe("secret");
		expect(config.awsSessionToken).toBe("sess");
	});

	it("credentials mode tolerates missing session token", () => {
		const config = buildBedrockAuthConfigFromSetup({
			mode: "credentials",
			accessKey: "AKIA0000",
			secretKey: "secret",
		});
		expect(config.awsSessionToken).toBeUndefined();
	});

	it("default mode has no mode-specific fields", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default", region: "us-east-1" });
		expect(config.awsAuthentication).toBe("default");
		expect(config.awsBedrockApiKey).toBeUndefined();
		expect(config.awsProfile).toBeUndefined();
		expect(config.awsAccessKey).toBeUndefined();
		expect(config.awsSecretKey).toBeUndefined();
		expect(config.awsSessionToken).toBeUndefined();
	});

	it("falls back to us-east-1 when region is empty string", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default", region: "" });
		expect(config.awsRegion).toBe("us-east-1");
	});

	it("falls back to us-east-1 when region is only whitespace", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default", region: "   " });
		expect(config.awsRegion).toBe("us-east-1");
	});

	it("falls back to us-east-1 when region is undefined", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default" });
		expect(config.awsRegion).toBe("us-east-1");
	});

	it("trims whitespace around supplied region", () => {
		const config = buildBedrockAuthConfigFromSetup({ mode: "default", region: "  ap-northeast-1  " });
		expect(config.awsRegion).toBe("ap-northeast-1");
	});

	it("ships Cline-parity defaults for every feature toggle regardless of mode", () => {
		for (const mode of ["apikey", "profile", "credentials", "default"] as const) {
			const config = buildBedrockAuthConfigFromSetup({ mode });
			expect(config.awsUseCrossRegionInference).toBe(true);
			expect(config.awsUseGlobalInference).toBe(true);
			expect(config.awsBedrockUsePromptCache).toBe(true);
			expect(config.enable1MContext).toBe(false);
		}
	});
});

describe("migrateLegacyBedrockAuth — bedrock-config wrapper shape", () => {
	it("unwraps { type: 'bedrock-config', ...BedrockAuthConfig } to the bare config", () => {
		const wrapped = {
			type: "bedrock-config" as const,
			awsAuthentication: "credentials" as const,
			awsAccessKey: "AKIA",
			awsSecretKey: "shh",
			awsRegion: "us-east-1",
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		};
		expect(migrateLegacyBedrockAuth(wrapped)).toEqual({
			awsAuthentication: "credentials",
			awsAccessKey: "AKIA",
			awsSecretKey: "shh",
			awsRegion: "us-east-1",
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		});
	});

	it("returns null when the wrapper is malformed (awsAuthentication missing)", () => {
		expect(migrateLegacyBedrockAuth({ type: "bedrock-config", awsRegion: "us-east-1" })).toBeNull();
	});

	it("round-trips setup output → wrapped credential → migrateLegacyBedrockAuth yields the original config", () => {
		const original = buildBedrockAuthConfigFromSetup({
			mode: "apikey",
			apiKey: "bearer-xyz",
			region: "us-west-2",
		});
		const wrapped = { type: "bedrock-config" as const, ...original };
		const roundtripped = migrateLegacyBedrockAuth(wrapped);
		expect(roundtripped).toEqual(original);
	});
});
