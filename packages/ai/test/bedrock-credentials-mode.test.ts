import { describe, expect, it } from "vitest";
import { resolveBedrockClientInputs } from "../src/providers/amazon-bedrock-auth.js";

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
