import { describe, expect, it } from "vitest";
import { resolveBedrockClientInputs } from "../src/providers/amazon-bedrock-auth.js";

describe("bedrock — VPC endpoint", () => {
	it("awsBedrockEndpoint overrides default regional endpoint", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "default",
			awsRegion: "us-east-1",
			awsBedrockEndpoint: "https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
		});
		expect(r.endpoint).toBe("https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com");
	});

	it("VPC endpoint works with apikey mode", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "apikey",
			awsBedrockApiKey: "bearer-xyz",
			awsRegion: "us-east-1",
			awsBedrockEndpoint: "https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
		});
		expect(r.endpoint).toBe("https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com");
		expect(r.token).toEqual({ token: "bearer-xyz" });
	});

	it("VPC endpoint works with profile mode", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "profile",
			awsProfile: "work",
			awsRegion: "us-east-1",
			awsBedrockEndpoint: "https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
		});
		expect(r.endpoint).toBe("https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com");
		expect(r.profile).toBe("work");
	});

	it("VPC endpoint works with credentials mode", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "credentials",
			awsAccessKey: "AKIA0000",
			awsSecretKey: "secret",
			awsRegion: "us-east-1",
			awsBedrockEndpoint: "https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
		});
		expect(r.endpoint).toBe("https://vpce-abc.bedrock-runtime.us-east-1.vpce.amazonaws.com");
		expect(r.credentials).toEqual({
			accessKeyId: "AKIA0000",
			secretAccessKey: "secret",
		});
	});

	it("no VPC endpoint → endpoint is undefined (SDK default applies)", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "default",
			awsRegion: "us-east-1",
		});
		expect(r.endpoint).toBeUndefined();
	});

	it("empty string awsBedrockEndpoint is treated as unset", () => {
		const r = resolveBedrockClientInputs({
			awsAuthentication: "default",
			awsRegion: "us-east-1",
			awsBedrockEndpoint: "",
		});
		expect(r.endpoint).toBeUndefined();
	});
});
