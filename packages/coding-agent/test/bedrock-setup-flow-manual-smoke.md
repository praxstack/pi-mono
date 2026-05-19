# Manual smoke test — Bedrock interactive setup flow

End-to-end verification of the BedrockSetupFlow on `feat/bedrock-toggle-prompts-v0.74.1`. Run from the repo root.

## Setup

Use an isolated agent dir so the smoke test doesn't touch your real `~/.pi/agent/auth.json`.

```bash
SMOKE_DIR=$(mktemp -d /tmp/pi-smoke.XXXXXX)
export PI_CODING_AGENT_DIR=$SMOKE_DIR
./pi-test.sh --no-env
```

`--no-env` strips every AWS / Anthropic / OpenAI env var so the auth flow can't short-circuit on a pre-existing credential.

## Test 1 — `apikey` mode + Customize advanced + malformed VPC URL retry

Drives every conditional code path in `BedrockSetupFlow.run()`.

1. `/login` → arrow Down to "Use an API key" → Enter
2. Provider selector lands on **Amazon Bedrock** at the cursor (configured providers float to top; otherwise it's first alphabetically)
3. Enter on Amazon Bedrock → mode picker shows four modes:
   - AWS Bedrock API Key (bearer token)
   - AWS Profile (uses ~/.aws/credentials)
   - AWS Credentials (access key + secret)
   - Default Credential Chain (env vars, IMDS, etc.)
4. Enter on the first option → text prompt `Enter AWS Bedrock API Key (bearer token):`
5. Type `AWSBR-SMOKETEST-KEY` → Enter
6. Region prompt with placeholder `us-east-1`. Type `us-west-2` → Enter
7. Advanced gate selector with cursor on **Skip — use defaults (recommended)**. Down → Enter to pick **Customize advanced options**
8. VPC endpoint prompt. Type `https://` (intentionally malformed: empty host) → Enter
   - Expect inline warning `Invalid URL: https://. Please enter a valid URL or leave empty.`
   - Same prompt re-renders, no flow abort
9. Type `vpce-0abc.bedrock-runtime.us-west-2.vpce.amazonaws.com` (no scheme) → Enter
   - Expect auto-prefix to `https://...` on persistence
10. Cross-region toggle (`Use Cross-Region Inference (us./eu. prefix)?` with help text). Cursor on **Yes (recommended)** → Enter
11. Global inference toggle. Cursor on **Yes (recommended)** → Enter
12. Prompt cache toggle. Cursor on **Yes (recommended)** → Enter
13. 1M context toggle (`Enable 1M context window?`). Cursor on **No (default)** — Down → Enter to pick **Yes**
14. Status line confirms `Saved API key for Amazon Bedrock. ... Credentials saved to <SMOKE_DIR>/auth.json`

Expected `auth.json`:

```json
{
  "amazon-bedrock": {
    "type": "bedrock-config",
    "awsAuthentication": "apikey",
    "awsRegion": "us-west-2",
    "awsBedrockApiKey": "AWSBR-SMOKETEST-KEY",
    "awsBedrockEndpoint": "https://vpce-0abc.bedrock-runtime.us-west-2.vpce.amazonaws.com",
    "awsUseCrossRegionInference": true,
    "awsUseGlobalInference": true,
    "awsBedrockUsePromptCache": true,
    "enable1MContext": true
  }
}
```

Verify the URL was auto-prefixed (`https://...`) and `enable1MContext` is `true` (the explicit non-default).

## Test 2 — `default` mode + Skip advanced (Cline-parity path)

The other extreme — fewest possible prompts.

1. `/login` from inside the same session → API key → Amazon Bedrock (now shows **API key configured**)
2. Mode picker → Down ×3 → Enter on **Default Credential Chain (env vars, IMDS, etc.)**
3. Region prompt. Press Enter immediately (empty input) → falls back to `us-east-1`
4. Advanced gate. Cursor already on **Skip — use defaults (recommended)** → Enter

Expected `auth.json`:

```json
{
  "amazon-bedrock": {
    "type": "bedrock-config",
    "awsAuthentication": "default",
    "awsRegion": "us-east-1",
    "awsUseCrossRegionInference": true,
    "awsUseGlobalInference": true,
    "awsBedrockUsePromptCache": true,
    "enable1MContext": false
  }
}
```

Note no `awsBedrockApiKey` / `awsProfile` / `awsAccessKey` / `awsSecretKey` / `awsSessionToken` / `awsBedrockEndpoint` keys: skip path emits exactly the auth-mode + region + four Cline-parity defaults.

## Test 3 — Cancellation paths

- **Mode picker Esc**: `/login` → API key → Amazon Bedrock → Esc on the mode radio. Status shows nothing more (silent cancel — `Setup cancelled` is suppressed by `interactive-mode.ts:4666`). `auth.json` unchanged.
- **Advanced gate Esc**: walk to the gate, press Esc. Same silent-cancel behaviour. `auth.json` unchanged.
- **Boolean toggle Esc**: pick Customize, get to the cross-region toggle, press Esc. Silent cancel; partial state not persisted.

## Cleanup

```bash
trash $PI_CODING_AGENT_DIR
unset PI_CODING_AGENT_DIR
tmux kill-session -t pi-smoke 2>/dev/null   # if you ran it under tmux
```

## Why this matters

The `bedrock-setup-flow-orchestration.test.ts` covers all the prompt sequencing and validation logic against mocked TUI primitives, but it can't catch:

- pi-tui keybinding regressions (Esc / Enter / arrow keys not reaching the selector)
- terminal redraw glitches (e.g. "Invalid URL" inline warning getting clobbered)
- the actual `interactive-mode.ts` `mountComponent` / `restoreEditor` plumbing
- final `auth.json` write going through `AuthStorage.set` + `FileAuthStorageBackend.withLock`

Test 1 + Test 2 above exercise both extremes (deepest prompt chain + shortest); Test 3 exercises every cancellation point.
