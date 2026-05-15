# AI QA Agent Challenge for What the thing is?

This repo adapts the original `eas-agent-device` demo into a small evaluation project for the React Native app [`tayloraleach/whatthethingis`](https://github.com/tayloraleach/whatthethingis).

The challenge harness runs five executable QA test cases, compares two Gemini model configurations, records accuracy against ground truth, latency, estimated cost, and writes structured trajectory logs. The original EAS `agent-device` runner is still present for real APK/.app runs, while the local evaluation defaults to a source-backed driver so the suite is reproducible without committing device credentials or third-party app API keys.

## App Under Test

`whatthethingis` is a bare React Native camera/object-translator app. It uses Clarifai for object predictions and Microsoft Translator for English-to-Spanish translations.

Runtime identifiers:

- Android application id: `com.aitranslator`
- iOS bundle identifier: `org.reactjs.native.example.AITranslator`
- Required app secrets for real detection runs: `CLARIFAI_API_KEY`, `MS_AZURE_TRANSLATOR_KEY`

The local source driver reads the neighboring checkout at `../whatthethingis` and models the app states needed by the challenge tests. For a real device run, build the app separately and provide `APP_PATH` plus `APPLICATION_ID`.

## Setup

```bash
npm install
cp .env.example .env
```

Set `GEMINI_API_KEY` in your shell or `.env` for the default live model comparison. `ANTHROPIC_API_KEY` is also supported for the Claude configs in `prompts/models.ts`. Do not commit `.env`.

Optional app-under-test setup for real mobile detection:

```bash
cd ../whatthethingis
npm install
cp .env.example .env
# Fill CLARIFAI_API_KEY and MS_AZURE_TRANSLATOR_KEY only in this local .env.
```

## Run The Evaluation

From this repo:

```bash
GEMINI_API_KEY=... npm run qa:eval
```

The default comparison is:

- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`

Run a single test/model:

```bash
GEMINI_API_KEY=... npm run qa:agent -- --test test-cases/smoke.json --model gemini-2.5-flash
```

Run the structural harness without any external model API:

```bash
npm run qa:eval:mock
```

Run the original EAS-style `agent-device` QA runner against a real Android build:

```bash
AI_GATEWAY_API_KEY=... \
QA_PLATFORM=android \
APP_PATH=/absolute/path/to/AITranslator.apk \
APPLICATION_ID=com.aitranslator \
BUILD_ID=local-whatthethingis \
PR_JSON='{"number":1,"title":"Local What the thing is QA","body":"Challenge run"}' \
npm run agent-qa
```

## Outputs

Each `npm run qa:eval` run writes to:

- `artifacts/eval/<timestamp>/results.json`
- `artifacts/eval/<timestamp>/results.csv`
- `artifacts/eval/<timestamp>/model-comparison-summary.md`
- `artifacts/eval/<timestamp>/trajectories/*.json`
- `artifacts/eval/latest-run.json`

`artifacts/` is intentionally ignored by git.

## Test Cases

- `TC-001` smoke/app launch: verifies the home camera screen, settings label, language direction, and guidance text.
- `TC-002` navigation: opens the settings modal and checks model choices.
- `TC-003` form/input: changes the model picker to Travel and verifies the header updates.
- `TC-004` negative edge case: denies camera permission and checks that detection does not hang.
- `TC-005` exploratory bug hunt: exercises an adverse detection path and asks the model to identify the highest-impact user-visible bug.

Ground truth is stored in each test case but is withheld from the model prompt. Accuracy is whether the model verdict matches that ground truth.

## Code Map

- `.eas/workflows/agent-qa-mobile.yml`: Original EAS workflow that builds/reuses mobile artifacts, runs `agent-device`, and comments on PRs.
- `.env.example`: Documented local environment variables; secret values belong in `.env`.
- `.gitignore`: Ignores dependencies, Expo/native generated files, local env files, and generated artifacts.
- `agent/run-agent.ts`: Single-test runner. It executes test actions through the selected driver, builds the adjudication prompt, calls the selected model, estimates cost, and returns a trajectory log.
- `agent/source-driver.ts`: Deterministic local driver for `whatthethingis`. It reads the real app source, simulates the relevant visible states, and exposes observations for the test cases.
- `agent/device-driver.ts`: Lightweight `agent-device` bridge for launching/observing a real installed APK/.app. The original `scripts/agent-qa/index.ts` remains the richer free-form device agent.
- `agent/types.ts`: Shared typed schema for tests, model configs, observations, decisions, usage, and trajectories.
- `app-under-test/whatthethingis.json`: App manifest with repo URL, local checkout path, platform ids, required secrets, and primary flows.
- `docs/evaluation-plan.md`: Success criteria, fairness controls, scale-up plan, drift/flakiness strategy, and production metrics.
- `docs/model-comparison-summary.md`: Human-readable comparison summary for the checked-in evaluation design and latest local run.
- `eval/run-eval.ts`: Runs every selected test case against every selected model, then writes JSON, CSV, markdown, and trajectory artifacts.
- `eval/trajectory-schema.json`: JSON schema describing the trajectory log contract.
- `prompts/models.ts`: Model configuration list, labels, temperatures, token limits, and cost estimates.
- `prompts/qa-agent.md`: Model-facing adjudication prompt and strict JSON response contract.
- `test-cases/*.json`: Executable challenge tests with model-hidden ground truth.
- `scripts/agent-qa/index.ts`: Original EAS workflow QA agent built with AI SDK `ToolLoopAgent` and `agent-device` tools.
- `scripts/agent-qa/run-and-export.sh`: Installs/opens a supplied app artifact, runs the original agent, and exports workflow outputs.
- `scripts/agent-qa/provision-android-emulator.sh`: Android emulator setup for EAS workflow runs.
- `scripts/agent-qa/provision-ios-simulator.sh`: iOS simulator setup for EAS workflow runs.
- `eas.json`: EAS build profiles retained from the starting repo.
- `app.json`, `app/`, `components/`, `constants/`, `hooks/`, `assets/`: Original Expo demo app files retained so the starting project still builds.

## Verification

```bash
npx tsc --noEmit
npm run qa:eval
```

The real-device path also requires an available emulator/simulator, `agent-device`, a built `whatthethingis` artifact, and any app/service credentials needed by that build.
