# Evaluation Plan

## Success And Failure

Each test case has model-visible expected results and success criteria, plus model-hidden ground truth. A run is accurate when the model's final verdict matches the hidden ground truth verdict.

Verdicts mean:

- `passed`: observations satisfy the expected result and important success criteria.
- `failed`: the app behavior violates the expected result or success criteria.
- `blocked`: the harness could not exercise the requested path.
- `unsure`: evidence is incomplete or ambiguous.

Accuracy is model verdict correctness against ground truth. App pass rate is separate: it counts how often the app itself passed the QA scenario.

## Fair Model Comparison

Both model configs receive the same app manifest, test case, success criteria, trajectory observations, and response schema. The default configs use the same temperature, same max output budget, same test order, and same source-backed driver.

The compared live configs are:

- `gemini-2.5-flash`: price-performance baseline.
- `gemini-2.5-flash-lite`: smaller lower-cost baseline.

Cost is estimated from observed API token usage and per-million-token pricing stored in `prompts/models.ts`. Latency is wall-clock time for the full test run plus model-call latency recorded separately.

## Scaling To 100+ Tests

To scale this evaluation, I would keep the JSON test contract stable and add tags for flow, risk, required credentials, platform, and expected flakiness. The runner should shard by tag and platform, run independent tests in parallel, and store every trajectory under a content-addressed run id.

For real mobile runs, I would separate deterministic setup from agent execution: reset app state, install a known build, seed network fixtures when possible, record device logs, and capture screenshots after every UI transition. High-risk flows should run more repetitions than low-risk smoke tests.

## Drift, Flakiness, False Positives, And False Negatives

Agent drift can be detected by replaying a stable benchmark suite and watching for changes in action count, verdict distribution, failure mode labels, and prompt-token usage. A model that starts taking longer paths or changing verdicts on unchanged trajectories should be investigated.

Flakiness can be measured with repeated runs of the same app build. The harness should mark tests flaky when observations or verdicts vary without a code/build change. Device logs, screenshots, and action traces should be clustered by failure mode.

False positives are failed verdicts where the ground truth says the app satisfies the criteria. False negatives are passed verdicts where ground truth says the app violates the criteria. For production, false negatives are usually more expensive because they let regressions ship, but excessive false positives can destroy trust in the platform.

## Production Metrics

The most important production metrics are ground-truth accuracy, false-negative rate, false-positive rate, latency per test, cost per accepted finding, reproducibility rate, blocked-test rate, and failure-mode diversity. Secondary metrics include retry-adjusted accuracy, screenshot coverage, action count, and whether findings contain enough context for a developer to reproduce the issue.
