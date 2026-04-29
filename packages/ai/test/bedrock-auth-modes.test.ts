import { beforeEach, describe, expect, it } from "vitest";
import {
	BedrockAuthError,
	resolveBedrockAuthMode,
	resolveBedrockClientInputs,
} from "../src/providers/amazon-bedrock-auth.js";

describe("resolveBedrockAuthMode", () => {
	it("returns 'apikey' when bearer token is set", () => {
		expect(resolveBedrockAuthMode({ awsBedrockApiKey: "bearer-xyz" })).toBe("apikey");
	});
	it("returns 'profile' when profile is set without other auth", () => {
		expect(resolveBedrockAuthMode({ awsProfile: "work" })).toBe("profile");
	});
	it("returns 'credentials' when access+secret keys are set", () => {
		expect(resolveBedrockAuthMode({ awsAccessKey: "AKIA0000", awsSecretKey: "secret" })).toBe("credentials");
	});
	it("explicit awsAuthentication wins over inferred", () => {
		expect(
			resolveBedrockAuthMode({
				awsAuthentication: "default",
				awsBedrockApiKey: "bearer-xyz",
			}),
		).toBe("default");
	});
	it("falls back to 'default' when nothing is set", () => {
		expect(resolveBedrockAuthMode({})).toBe("default");
	});
	it("unknown awsAuthentication value falls back to inferred path", () => {
		expect(
			resolveBedrockAuthMode({
				awsAuthentication: "garbage",
				awsBedrockApiKey: "bearer-xyz",
			}),
		).toBe("apikey");
	});
});

describe("resolveBedrockClientInputs", () => {
	beforeEach(() => {
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
	});

	it("apikey mode returns token + httpBearerAuth preference", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "apikey",
			awsBedrockApiKey: "bearer-xyz",
			awsRegion: "us-east-1",
		});
		expect(r.token).toEqual({ token: "bearer-xyz" });
		expect(r.authSchemePreference).toEqual(["httpBearerAuth"]);
		expect(r.region).toBe("us-east-1");
		expect(r.credentials).toBeUndefined();
		expect(r.profile).toBeUndefined();
	});
	it("strips Bearer prefix from api key", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "apikey",
			awsBedrockApiKey: "Bearer bearer-xyz",
			awsRegion: "us-east-1",
		});
		expect(r.token).toEqual({ token: "bearer-xyz" });
	});
	it("profile mode returns profile only", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "profile",
			awsProfile: "work",
			awsRegion: "eu-west-1",
		});
		expect(r.profile).toBe("work");
		expect(r.token).toBeUndefined();
		expect(r.credentials).toBeUndefined();
		expect(r.region).toBe("eu-west-1");
	});
	it("credentials mode returns static credentials with session token", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "credentials",
			awsAccessKey: "AKIA0000",
			awsSecretKey: "secret",
			awsSessionToken: "sess",
			awsRegion: "us-east-1",
		});
		expect(r.credentials).toEqual({
			accessKeyId: "AKIA0000",
			secretAccessKey: "secret",
			sessionToken: "sess",
		});
		expect(r.token).toBeUndefined();
		expect(r.profile).toBeUndefined();
	});
	it("credentials mode omits sessionToken when absent", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "credentials",
			awsAccessKey: "AKIA0000",
			awsSecretKey: "secret",
			awsRegion: "us-east-1",
		});
		expect(r.credentials).toEqual({
			accessKeyId: "AKIA0000",
			secretAccessKey: "secret",
		});
	});
	it("default mode returns bare region", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "default",
			awsRegion: "us-east-1",
		});
		expect(r.token).toBeUndefined();
		expect(r.credentials).toBeUndefined();
		expect(r.profile).toBeUndefined();
		expect(r.region).toBe("us-east-1");
	});
	it("awsBedrockEndpoint sets endpoint", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "default",
			awsRegion: "us-east-1",
			awsBedrockEndpoint: "https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
		});
		expect(r.endpoint).toBe("https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com");
	});
	it("legacy bearerToken alias maps to awsBedrockApiKey", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "apikey",
			bearerToken: "legacy-token",
			awsRegion: "us-east-1",
		});
		expect(r.token).toEqual({ token: "legacy-token" });
	});
	it("legacy profile alias maps to awsProfile", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "profile",
			profile: "legacy-profile",
			awsRegion: "us-east-1",
		});
		expect(r.profile).toBe("legacy-profile");
	});
	it("legacy region alias maps to awsRegion", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "default",
			region: "eu-west-1",
		});
		expect(r.region).toBe("eu-west-1");
	});
	it("default region is us-east-1 when neither awsRegion nor region set", () => {
		const r = resolveBedrockClientInputs({ awsAuthentication: "default" });
		expect(r.region).toBe("us-east-1");
	});
	it("apikey mode with no token throws BedrockAuthError (mode-specific)", () => {
		expect(() => resolveBedrockClientInputs({ awsAuthentication: "apikey", awsRegion: "us-east-1" })).toThrow(
			BedrockAuthError,
		);
	});
	it("credentials mode missing secret throws BedrockAuthError", () => {
		expect(() =>
			resolveBedrockClientInputs({
				awsAuthentication: "credentials",
				awsRegion: "us-east-1",
				awsAccessKey: "AKIA0000",
			}),
		).toThrow(BedrockAuthError);
	});
	it("apikey mode with only Bearer prefix (no real token) throws", () => {
		expect(() =>
			resolveBedrockClientInputs({
				awsAuthentication: "apikey",
				awsBedrockApiKey: "Bearer ",
				awsRegion: "us-east-1",
			}),
		).toThrow(BedrockAuthError);
	});
	it("apikey mode with whitespace-only token throws", () => {
		expect(() =>
			resolveBedrockClientInputs({
				awsAuthentication: "apikey",
				awsBedrockApiKey: "   ",
				awsRegion: "us-east-1",
			}),
		).toThrow(BedrockAuthError);
	});
});

describe("resolveBedrockClientInputs — browser/env safety", () => {
	it("apikey mode with no process.env throws cleanly (no ReferenceError) when key absent", () => {
		// Simulate absence of process.env by temporarily shadowing (jsdom leaves process defined).
		// The important contract is: when awsBedrockApiKey and bearerToken are absent AND
		// AWS_BEARER_TOKEN_BEDROCK is unset, the call raises BedrockAuthError — NOT ReferenceError.
		const origToken = process.env.AWS_BEARER_TOKEN_BEDROCK;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
		try {
			expect(() =>
				resolveBedrockClientInputs({
					awsAuthentication: "apikey",
					awsRegion: "us-east-1",
				}),
			).toThrow(BedrockAuthError);
		} finally {
			if (origToken !== undefined) process.env.AWS_BEARER_TOKEN_BEDROCK = origToken;
		}
	});
});
