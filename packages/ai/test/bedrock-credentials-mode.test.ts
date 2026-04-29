import { beforeEach, describe, expect, it } from "vitest";
import { resolveBedrockAuthMode, resolveBedrockClientInputs } from "../src/providers/amazon-bedrock-auth.js";

describe("bedrock credentials mode integration", () => {
	it("maps explicit access+secret+session to SDK credentials shape", () => {
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
		expect(r.region).toBe("us-east-1");
	});

	it("omits sessionToken when not provided", () => {
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
		expect(r.credentials?.sessionToken).toBeUndefined();
	});

	it("credentials mode does not set profile or token fields", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "credentials",
			awsAccessKey: "AKIA0000",
			awsSecretKey: "secret",
			awsRegion: "us-east-1",
		});
		expect(r.profile).toBeUndefined();
		expect(r.token).toBeUndefined();
		expect(r.authSchemePreference).toBeUndefined();
	});
});

describe("bedrock — env bearer fallback", () => {
	beforeEach(() => {
		delete process.env.AWS_BEDROCK_SKIP_AUTH;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
	});

	it("resolveBedrockAuthMode does NOT infer apikey from env alone (env is a fallback in resolveBedrockClientInputs apikey branch only)", () => {
		process.env.AWS_BEARER_TOKEN_BEDROCK = "env-only-token";
		// Without awsBedrockApiKey/bearerToken AND without explicit awsAuthentication,
		// inference sees no in-bag evidence, so mode resolves to "default".
		// The provider compensates by forwarding envBearer into awsBedrockApiKey before calling the resolver.
		expect(resolveBedrockAuthMode({})).toBe("default");
	});

	it("resolveBedrockClientInputs apikey mode falls back to process.env.AWS_BEARER_TOKEN_BEDROCK", () => {
		process.env.AWS_BEARER_TOKEN_BEDROCK = "env-bearer-abc";
		const r = resolveBedrockClientInputs({
			awsAuthentication: "apikey",
			awsRegion: "us-east-1",
		});
		expect(r.token).toEqual({ token: "env-bearer-abc" });
	});

	it("explicit awsBedrockApiKey wins over env bearer", () => {
		process.env.AWS_BEARER_TOKEN_BEDROCK = "env-bearer";
		const r = resolveBedrockClientInputs({
			awsAuthentication: "apikey",
			awsBedrockApiKey: "explicit-key",
			awsRegion: "us-east-1",
		});
		expect(r.token).toEqual({ token: "explicit-key" });
	});
});
