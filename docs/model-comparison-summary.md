# Model Comparison Summary

The evaluation harness compares `gemini-2.5-flash` and `gemini-2.5-flash-lite` across the five required challenge tests. The checked-in configs use equal temperature and output limits so the comparison focuses on model quality, latency, and estimated token cost.

Run the live comparison with:

```bash
GEMINI_API_KEY=... npm run qa:eval
```

The generated per-run summary is written to `artifacts/eval/<timestamp>/model-comparison-summary.md`, with structured data in `results.json`, `results.csv`, and `trajectories/*.json`.

Pricing assumptions are stored in `prompts/models.ts` and should be refreshed before a production benchmark. They use Google AI Developer API standard input/output pricing for Gemini 2.5 Flash and Gemini 2.5 Flash-Lite.

## Verified Local Run

Run directory: `artifacts/eval/2026-05-12T02-20-13-460Z`

| Model | Accuracy | App pass rate | Avg latency | Total cost |
| --- | ---: | ---: | ---: | ---: |
| `gemini-2.5-flash` | 100.0% | 60.0% | 4935 ms | $0.004506 |
| `gemini-2.5-flash-lite` | 100.0% | 60.0% | 1276 ms | $0.001181 |

Both models matched all five ground-truth verdicts in the regenerated run. The app pass rate is 60% because the smoke, navigation, and picker tests pass, while the denied-camera edge case and exploratory adverse-condition test correctly expose a stuck loading failure.

`gemini-2.5-flash-lite` matched `gemini-2.5-flash` on accuracy and was about 3.9x faster and 3.8x cheaper on the source-backed suite.

## Research Readout

- Flash should be treated as the quality/latency baseline available to this local environment.
- Flash-Lite should be treated as the lowest-cost baseline.
- If both models match ground truth, choose Flash-Lite for this narrow suite and reserve Flash for ambiguous screenshots, exploratory bug triage, or cases with high false-negative cost.
- If Flash-Lite misses the denied-camera loading bug, that is a useful model-specific failure mode: the smaller model is underweighting adverse-state recovery criteria.
- In this run, both models identified the high-impact denied-camera loading issue. A production harness should still validate verdict/failure-reason consistency before accepting final answers, because prior runs showed this can be a model-specific failure mode.
