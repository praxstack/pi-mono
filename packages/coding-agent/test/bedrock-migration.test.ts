import { describe, expect, it } from "vitest";
import { migrateLegacyBedrockAuth } from "../src/core/auth-storage.js";

describe("migrateLegacyBedrockAuth", () => {
	it("migrates legacy { type: 'api_key', key } to BedrockAuthConfig shape with Cline-parity defaults", () => {
		const legacy = { type: "api_key", key: "bearer-xyz" };
		const migrated = migrateLegacyBedrockAuth(legacy);
		expect(migrated).toEqual({
			awsAuthentication: "apikey",
			awsBedrockApiKey: "bearer-xyz",
			awsRegion: "us-east-1",
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		});
	});

	it("leaves already-migrated BedrockAuthConfig unchanged", () => {
		const current = {
			awsAuthentication: "profile" as const,
			awsProfile: "work",
			awsRegion: "eu-west-1",
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		};
		const migrated = migrateLegacyBedrockAuth(current);
		expect(migrated).toEqual(current);
	});

	it("is idempotent — running twice yields the same result", () => {
		const legacy = { type: "api_key", key: "bearer-xyz" };
		const once = migrateLegacyBedrockAuth(legacy);
		const twice = migrateLegacyBedrockAuth(once);
		expect(twice).toEqual(once);
	});

	it("returns null for null input", () => {
		expect(migrateLegacyBedrockAuth(null)).toBeNull();
	});

	it("returns null for undefined input", () => {
		expect(migrateLegacyBedrockAuth(undefined)).toBeNull();
	});

	it("returns null for unrecognized shape", () => {
		expect(migrateLegacyBedrockAuth({ type: "oauth", access: "..." })).toBeNull();
		expect(migrateLegacyBedrockAuth({ foo: "bar" })).toBeNull();
		expect(migrateLegacyBedrockAuth("a string")).toBeNull();
	});

	it("legacy shape with missing 'key' returns null", () => {
		expect(migrateLegacyBedrockAuth({ type: "api_key" })).toBeNull();
	});

	it("preserves all valid fields from an existing BedrockAuthConfig with credentials mode", () => {
		const current = {
			awsAuthentication: "credentials" as const,
			awsAccessKey: "AKIA0000",
			awsSecretKey: "secret",
			awsSessionToken: "sess",
			awsRegion: "us-west-2",
			awsBedrockEndpoint: "https://vpce-abc.example.com",
			awsUseCrossRegionInference: false,
			awsUseGlobalInference: false,
			awsBedrockUsePromptCache: false,
			enable1MContext: true,
		};
		expect(migrateLegacyBedrockAuth(current)).toEqual(current);
	});
});
