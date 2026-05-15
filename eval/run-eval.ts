import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { runQaAgent } from '../agent/run-agent.ts';
import type { TrajectoryLog } from '../agent/types.ts';

type EvalSummary = {
  generatedAt: string;
  driver: string;
  runDir: string;
  models: ModelSummary[];
  results: ResultRow[];
};

type ModelSummary = {
  model: string;
  total: number;
  accuracy: number;
  appPassRate: number;
  avgLatencyMs: number;
  totalCostUsd: number;
};

type ResultRow = {
  testCaseId: string;
  testCaseName: string;
  model: string;
  verdict: string;
  expectedVerdict: string;
  matchedGroundTruth: boolean;
  latencyMs: number;
  modelLatencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stepCount: number;
  failureReason: string;
  trajectoryPath: string;
};

const DEFAULT_MODELS = 'gemini-2.5-flash,gemini-2.5-flash-lite';

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const driver = process.env.QA_DRIVER || 'source';
  const models = splitEnv(process.env.QA_MODEL_CONFIGS || DEFAULT_MODELS);
  const testCases = await discoverTestCases(repoRoot);
  const runDir = path.join(
    repoRoot,
    'artifacts',
    'eval',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  const trajectoryDir = path.join(runDir, 'trajectories');
  await mkdir(trajectoryDir, { recursive: true });

  const rows: ResultRow[] = [];
  for (const model of models) {
    for (const testCasePath of testCases) {
      const trajectoryPath = path.join(
        trajectoryDir,
        `${path.basename(testCasePath, '.json')}__${model.replace(/[^a-z0-9.-]/gi, '_')}.json`,
      );
      const trajectory = await runQaAgent({
        testCasePath,
        modelId: model,
        driver: driver === 'agent-device' ? 'agent-device' : 'source',
        outputPath: trajectoryPath,
        repoRoot,
      });
      rows.push(toResultRow(trajectory, trajectoryPath));
      console.log(
        `${trajectory.testCaseId} ${model}: ${trajectory.finalVerdict.verdict}, matched=${trajectory.matchedGroundTruth}, latency=${trajectory.metrics.latencyMs}ms, cost=$${trajectory.metrics.costUsd.toFixed(6)}`,
      );
    }
  }

  const summary: EvalSummary = {
    generatedAt: new Date().toISOString(),
    driver,
    runDir,
    models: summarizeModels(rows),
    results: rows,
  };
  await writeFile(path.join(runDir, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(runDir, 'results.csv'), toCsv(rows));
  await writeFile(path.join(runDir, 'model-comparison-summary.md'), toMarkdown(summary));
  await writeFile(
    path.join(repoRoot, 'artifacts', 'eval', 'latest-run.json'),
    `${JSON.stringify({ runDir }, null, 2)}\n`,
  );

  console.log(`Evaluation results written to ${runDir}`);
}

async function discoverTestCases(repoRoot: string): Promise<string[]> {
  const selected = process.env.QA_TEST_CASES;
  if (selected) {
    return splitEnv(selected);
  }

  const testCaseDir = path.join(repoRoot, 'test-cases');
  const files = await readdir(testCaseDir);
  const testCases: Array<{ id: string; path: string }> = [];
  for (const file of files.filter((candidate) => candidate.endsWith('.json'))) {
    const filePath = path.join('test-cases', file);
    const content = JSON.parse(
      await readFile(path.join(repoRoot, filePath), 'utf8'),
    ) as { id?: string };
    testCases.push({
      id: content.id || file,
      path: filePath,
    });
  }

  return testCases.sort((left, right) => left.id.localeCompare(right.id)).map((item) => item.path);
}

function toResultRow(
  trajectory: TrajectoryLog,
  trajectoryPath: string,
): ResultRow {
  return {
    testCaseId: trajectory.testCaseId,
    testCaseName: trajectory.testCaseName,
    model: trajectory.model.id,
    verdict: trajectory.finalVerdict.verdict,
    expectedVerdict: trajectory.groundTruth.expected_verdict,
    matchedGroundTruth: trajectory.matchedGroundTruth,
    latencyMs: trajectory.metrics.latencyMs,
    modelLatencyMs: trajectory.metrics.modelLatencyMs,
    costUsd: trajectory.metrics.costUsd,
    inputTokens: trajectory.metrics.inputTokens,
    outputTokens: trajectory.metrics.outputTokens,
    totalTokens: trajectory.metrics.totalTokens,
    stepCount: trajectory.metrics.stepCount,
    failureReason: trajectory.finalVerdict.failure_reason || '',
    trajectoryPath,
  };
}

function summarizeModels(rows: ResultRow[]): ModelSummary[] {
  const byModel = new Map<string, ResultRow[]>();
  for (const row of rows) {
    byModel.set(row.model, [...(byModel.get(row.model) || []), row]);
  }

  return [...byModel.entries()].map(([model, modelRows]) => {
    const total = modelRows.length;
    const matched = modelRows.filter((row) => row.matchedGroundTruth).length;
    const passed = modelRows.filter((row) => row.verdict === 'passed').length;
    const latency = modelRows.reduce((sum, row) => sum + row.latencyMs, 0);
    const cost = modelRows.reduce((sum, row) => sum + row.costUsd, 0);

    return {
      model,
      total,
      accuracy: roundMetric(matched / total),
      appPassRate: roundMetric(passed / total),
      avgLatencyMs: Math.round(latency / total),
      totalCostUsd: roundMoney(cost),
    };
  });
}

function toCsv(rows: ResultRow[]): string {
  const headers = [
    'test_case_id',
    'test_case_name',
    'model',
    'verdict',
    'expected_verdict',
    'matched_ground_truth',
    'latency_ms',
    'model_latency_ms',
    'cost_usd',
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'step_count',
    'failure_reason',
    'trajectory_path',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.testCaseId,
        row.testCaseName,
        row.model,
        row.verdict,
        row.expectedVerdict,
        String(row.matchedGroundTruth),
        String(row.latencyMs),
        String(row.modelLatencyMs),
        row.costUsd.toFixed(6),
        String(row.inputTokens),
        String(row.outputTokens),
        String(row.totalTokens),
        String(row.stepCount),
        row.failureReason,
        row.trajectoryPath,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `${lines.join('\n')}\n`;
}

function toMarkdown(summary: EvalSummary): string {
  const lines = [
    '# Model Comparison Summary',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    `Driver: ${summary.driver}`,
    '',
    '## Aggregate Results',
    '',
    '| Model | Accuracy | App pass rate | Avg latency | Total cost |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const model of summary.models) {
    lines.push(
      `| ${model.model} | ${(model.accuracy * 100).toFixed(1)}% | ${(model.appPassRate * 100).toFixed(1)}% | ${model.avgLatencyMs} ms | $${model.totalCostUsd.toFixed(6)} |`,
    );
  }

  lines.push(
    '',
    '## Per-Test Results',
    '',
    '| Test | Model | Verdict | Expected | Matched | Latency | Cost | Failure reason |',
    '| --- | --- | --- | --- | --- | ---: | ---: | --- |',
  );
  for (const row of summary.results) {
    lines.push(
      `| ${row.testCaseId} | ${row.model} | ${row.verdict} | ${row.expectedVerdict} | ${row.matchedGroundTruth ? 'yes' : 'no'} | ${row.latencyMs} ms | $${row.costUsd.toFixed(6)} | ${escapePipes(row.failureReason || '-')} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function splitEnv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

await main();
