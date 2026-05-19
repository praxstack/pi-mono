/**
 * End-to-end persistence tests for the Bedrock setup flow's auth.json
 * round-trip:
 *
 *   setup inputs → buildBedrockAuthConfigFromSetup → AuthStorage.set
 *               → JSON-on-disk → reload → migrateLegacyBedrockAuth
 *               → canonical BedrockAuthConfig
 *
 * Existing tests cover each leg in isolation:
 *   - bedrock-setup-flow.test.ts: builder helper unit-test.
 *   - bedrock-migration.test.ts:  migrate helper unit-test.
 *   - bedrock-toggle-prompts.test.ts: round-trip through the helper objects.
 *
 * What's missing — and what this file adds — is the actual JSON-on-disk
 * round-trip via real AuthStorage. This catches:
 *   - file-permission regressions on the persisted auth.json
 *   - JSON serialisation drift (e.g. accidental Date/Function fields)
 *   - the case where a pre-existing auth.json from an older Pi version
 *     is missing the four new toggle keys, and the read path must
 *     transparently backfill defaults.
 *   - the migrateLegacyBedrockAuth(authStorage.get(...)) call shape that
 *     the bedrock provider hot path uses in production.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage, migrateLegacyBedrockAuth } from "../src/core/auth-storage.js";
import { buildBedrockAuthConfigFromSetup } from "../src/core/bedrock-setup-config.js";

let tempDir: string;
let authJsonPath: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `pi-test-bedrock-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	authJsonPath = join(tempDir, "auth.json");
});

afterEach(() => {
	if (tempDir && existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true });
	}
});

describe("setup → AuthStorage.set → reload → migrateLegacyBedrockAuth round-trip", () => {
	it("apikey + skip advanced gate → on-disk JSON round-trips to original config", () => {
		const original = buildBedrockAuthConfigFromSetup({
			mode: "apikey",
			apiKey: "AWSBR-XXXX",
			region: "us-east-1",
		});

		const writer = AuthStorage.create(authJsonPath);
		writer.set("bedrock", { type: "bedrock-config", ...original });

		// Simulate the next pi process starting up: a fresh AuthStorage on
		// the same path, which reloads from disk in its constructor.
		const reader = AuthStorage.create(authJsonPath);
		const cred = reader.get("bedrock");
		expect(cred?.type).toBe("bedrock-config");

		const migrated = migrateLegacyBedrockAuth(cred);
		expect(migrated).toEqual(original);
	});

	it("credentials + customize advanced (all toggles flipped, custom endpoint) round-trips", () => {
		const original = buildBedrockAuthConfigFromSetup({
			mode: "credentials",
			accessKey: "AKIAEXAMPLE",
			secretKey: "secret-shh",
			sessionToken: "session-token",
			region: "ap-northeast-1",
			endpoint: "https://vpce-0abc.bedrock-runtime.ap-northeast-1.vpce.amazonaws.com",
			useCrossRegionInference: false,
			useGlobalInference: false,
			usePromptCache: false,
			enable1MContext: true,
		});

		const writer = AuthStorage.create(authJsonPath);
		writer.set("bedrock", { type: "bedrock-config", ...original });

		const reader = AuthStorage.create(authJsonPath);
		const migrated = migrateLegacyBedrockAuth(reader.get("bedrock"));
		expect(migrated).toEqual(original);

		// Spot-check the on-disk JSON shape, since it's the public contract
		// for users who edit auth.json by hand.
		const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
		expect(raw.bedrock).toMatchObject({
			type: "bedrock-config",
			awsAuthentication: "credentials",
			awsAccessKey: "AKIAEXAMPLE",
			awsSecretKey: "secret-shh",
			awsSessionToken: "session-token",
			awsRegion: "ap-northeast-1",
			awsBedrockEndpoint: "https://vpce-0abc.bedrock-runtime.ap-northeast-1.vpce.amazonaws.com",
			awsUseCrossRegionInference: false,
			awsUseGlobalInference: false,
			awsBedrockUsePromptCache: false,
			enable1MContext: true,
		});
	});

	it("auth.json file is created with 0600 permissions on first set", () => {
		const original = buildBedrockAuthConfigFromSetup({ mode: "default" });
		const writer = AuthStorage.create(authJsonPath);
		writer.set("bedrock", { type: "bedrock-config", ...original });

		const stats = statSync(authJsonPath);
		// Strip file-type bits, only check permission bits.
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o600);
	});
});

describe("migration from a pre-existing auth.json missing the new toggle keys", () => {
	it("legacy { type: 'api_key', key } credential is migrated with Cline-parity defaults", () => {
		// Simulate auth.json written by an older pi (pre-toggle release):
		// just an API key wrapper, no AWS region, no toggles.
		writeFileSync(
			authJsonPath,
			JSON.stringify({
				bedrock: { type: "api_key", key: "AWSBR-LEGACY" },
			}),
		);

		const reader = AuthStorage.create(authJsonPath);
		const migrated = migrateLegacyBedrockAuth(reader.get("bedrock"));
		expect(migrated).toEqual({
			awsAuthentication: "apikey",
			awsBedrockApiKey: "AWSBR-LEGACY",
			awsRegion: "us-east-1",
			awsUseCrossRegionInference: true,
			awsUseGlobalInference: true,
			awsBedrockUsePromptCache: true,
			enable1MContext: false,
		});
	});

	it("legacy bedrock-config wrapper missing all four toggle keys backfills defaults on read", () => {
		// Simulate an auth.json from an interim release that wrote
		// bedrock-config wrappers but didn't yet have the toggle fields.
		writeFileSync(
			authJsonPath,
			JSON.stringify({
				bedrock: {
					type: "bedrock-config",
					awsAuthentication: "profile",
					awsRegion: "us-east-1",
					awsProfile: "work",
				},
			}),
		);

		const reader = AuthStorage.create(authJsonPath);
		const migrated = migrateLegacyBedrockAuth(reader.get("bedrock"));
		expect(migrated).toEqual({
			awsAuthentication: "profile",
			awsRegion: "us-east-1",
			awsProfile: "work",
			awsBedrockApiKey: undefined,
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

	it("legacy bedrock-config wrapper with two of four toggle keys preserves explicit, backfills missing", () => {
		writeFileSync(
			authJsonPath,
			JSON.stringify({
				bedrock: {
					type: "bedrock-config",
					awsAuthentication: "apikey",
					awsRegion: "us-east-1",
					awsBedrockApiKey: "AWSBR-XXXX",
					awsUseCrossRegionInference: false,
					enable1MContext: true,
					// awsUseGlobalInference + awsBedrockUsePromptCache absent
				},
			}),
		);

		const reader = AuthStorage.create(authJsonPath);
		const migrated = migrateLegacyBedrockAuth(reader.get("bedrock"));
		expect(migrated?.awsUseCrossRegionInference).toBe(false);
		expect(migrated?.enable1MContext).toBe(true);
		expect(migrated?.awsUseGlobalInference).toBe(true);
		expect(migrated?.awsBedrockUsePromptCache).toBe(true);
	});

	it("re-saving a migrated config drops legacy stragglers and persists canonical shape", () => {
		// Start with a legacy api_key shape on disk.
		writeFileSync(
			authJsonPath,
			JSON.stringify({
				bedrock: { type: "api_key", key: "AWSBR-LEGACY", region: "eu-central-1" },
			}),
		);

		// Read → migrate → resave (the action a /login retry would take).
		const reader = AuthStorage.create(authJsonPath);
		const migrated = migrateLegacyBedrockAuth(reader.get("bedrock"));
		expect(migrated).not.toBeNull();
		if (!migrated) throw new Error("unreachable");

		reader.set("bedrock", { type: "bedrock-config", ...migrated });

		// Re-read raw JSON: the legacy `type: api_key` wrapper must be gone.
		const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
		expect(raw.bedrock.type).toBe("bedrock-config");
		expect(raw.bedrock).not.toHaveProperty("key");
		// Legacy { type: api_key } migration preserves an optional `region`
		// field if the legacy shape carried one (the migrator reads
		// `input.region` when typeof string), so eu-central-1 round-trips.
		expect(raw.bedrock.awsRegion).toBe("eu-central-1");
	});

	it("idempotent: re-running set + reload + migrate yields the same config bit-for-bit", () => {
		const original = buildBedrockAuthConfigFromSetup({
			mode: "apikey",
			apiKey: "AWSBR-XXXX",
			region: "us-east-1",
			endpoint: "https://vpce.example.com",
			useCrossRegionInference: false,
			useGlobalInference: true,
			usePromptCache: false,
			enable1MContext: true,
		});

		const writer = AuthStorage.create(authJsonPath);
		writer.set("bedrock", { type: "bedrock-config", ...original });

		const r1 = migrateLegacyBedrockAuth(AuthStorage.create(authJsonPath).get("bedrock"));
		// Resave the migrated shape over itself.
		const writer2 = AuthStorage.create(authJsonPath);
		if (r1) writer2.set("bedrock", { type: "bedrock-config", ...r1 });

		const r2 = migrateLegacyBedrockAuth(AuthStorage.create(authJsonPath).get("bedrock"));
		expect(r2).toEqual(r1);
		expect(r2).toEqual(original);
	});
});

describe("co-existence with other providers", () => {
	it("setting bedrock does not disturb an existing anthropic api_key entry", () => {
		writeFileSync(
			authJsonPath,
			JSON.stringify({
				anthropic: { type: "api_key", key: "sk-ant-existing" },
			}),
		);

		const original = buildBedrockAuthConfigFromSetup({
			mode: "apikey",
			apiKey: "AWSBR-XXXX",
		});

		const writer = AuthStorage.create(authJsonPath);
		writer.set("bedrock", { type: "bedrock-config", ...original });

		const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
		expect(raw.anthropic).toEqual({ type: "api_key", key: "sk-ant-existing" });
		expect(raw.bedrock.awsBedrockApiKey).toBe("AWSBR-XXXX");
	});

	it("removing bedrock leaves other providers intact", () => {
		const original = buildBedrockAuthConfigFromSetup({
			mode: "apikey",
			apiKey: "AWSBR-XXXX",
		});
		const writer = AuthStorage.create(authJsonPath);
		writer.set("anthropic", { type: "api_key", key: "sk-ant-existing" });
		writer.set("bedrock", { type: "bedrock-config", ...original });
		writer.remove("bedrock");

		const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
		expect(raw).toEqual({ anthropic: { type: "api_key", key: "sk-ant-existing" } });
	});
});
