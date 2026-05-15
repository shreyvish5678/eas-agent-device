import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

import { createDeviceSession, runDeviceAction } from './device-driver.ts';
import { createSourceSession, runSourceAction } from './source-driver.ts';
import type {
  AgentDecision,
  AppManifest,
  DriverName,
  ModelCallResult,
  ModelConfig,
  ModelUsage,
  Observation,
  TestCase,
  TrajectoryLog,
  Verdict,
} from './types.ts';
import { getModelConfig } from '../prompts/models.ts';

type RunAgentOptions = {
  testCasePath: string;
  modelId: string;
  driver: DriverName;
  outputPath?: string;
  repoRoot?: string;
};

type CliArgs = {
  testCasePath: string;
  modelId: string;
  driver: DriverName;
  outputPath?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

type AnthropicResponse = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

const DEFAULT_TEST_CASE = 'test-cases/smoke.json';
const DEFAULT_APP_MANIFEST = 'app-under-test/whatthethingis.json';
const DEFAULT_PROMPT = 'prompts/qa-agent.md';
const VERDICTS = new Set<Verdict>(['passed', 'failed', 'blocked', 'unsure']);

export async function runQaAgent(options: RunAgentOptions): Promise<TrajectoryLog> {
  const repoRoot = options.repoRoot || process.cwd();
  const modelConfig = getModelConfig(options.modelId);
  const appManifest = await readJson<AppManifest>(
    path.join(repoRoot, DEFAULT_APP_MANIFEST),
  );
  const testCase = await readJson<TestCase>(
    path.resolve(repoRoot, options.testCasePath),
  );
  const basePrompt = await readFile(path.join(repoRoot, DEFAULT_PROMPT), 'utf8');
  const startedAt = performance.now();
  const actions = await executeActions(
    options.driver,
    appManifest,
    testCase,
    repoRoot,
  );
  const prompt = buildPrompt(basePrompt, appManifest, testCase, actions);
  const modelResult = await callModel(modelConfig, prompt);
  const latencyMs = Math.round(performance.now() - startedAt);
  const matchedGroundTruth =
    modelResult.decision.verdict === testCase.ground_truth.expected_verdict;
  const trajectory: TrajectoryLog = {
    schemaVersion: '1.0',
    runId: `${testCase.id}__${modelConfig.id}__${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}`,
    generatedAt: new Date().toISOString(),
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    model: {
      id: modelConfig.id,
      provider: modelConfig.provider,
      label: modelConfig.label,
    },
    driver: options.driver,
    appUnderTest: appManifest,
    prompt,
    actions,
    finalVerdict: modelResult.decision,
    rawModelResponse: modelResult.rawText,
    groundTruth: testCase.ground_truth,
    matchedGroundTruth,
    metrics: {
      latencyMs,
      modelLatencyMs: modelResult.latencyMs,
      costUsd: roundMoney(modelResult.usage.estimatedCostUsd),
      inputTokens: modelResult.usage.inputTokens,
      outputTokens: modelResult.usage.outputTokens,
      totalTokens: modelResult.usage.totalTokens,
      stepCount: actions.length,
      retryCount: 0,
      screenshotCount: 0,
    },
  };

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(trajectory, null, 2)}\n`);
  }

  return trajectory;
}

async function executeActions(
  driver: DriverName,
  appManifest: AppManifest,
  testCase: TestCase,
  repoRoot: string,
): Promise<Observation[]> {
  const observations: Observation[] = [];
  if (driver === 'source') {
    const session = await createSourceSession(appManifest, repoRoot);
    for (const action of testCase.agent_actions) {
      observations.push(await runSourceAction(session, action));
    }

    return observations;
  }

  const session = createDeviceSession(appManifest);
  for (const action of testCase.agent_actions) {
    observations.push(await runDeviceAction(session, action));
  }

  return observations;
}

async function callModel(
  modelConfig: ModelConfig,
  prompt: string,
): Promise<ModelCallResult> {
  if (modelConfig.provider === 'mock' || process.env.QA_MODEL_PROVIDER === 'mock') {
    return callMockModel(modelConfig, prompt);
  }
  if (modelConfig.provider === 'anthropic') {
    return callAnthropicModel(modelConfig, prompt);
  }

  return callGeminiModel(modelConfig, prompt);
}

async function callAnthropicModel(
  modelConfig: ModelConfig,
  prompt: string,
): Promise<ModelCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing ANTHROPIC_API_KEY. Set it in your shell or run with QA_MODEL_PROVIDER=mock for structural verification.',
    );
  }

  const startedAt = performance.now();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: modelConfig.model,
      max_tokens: modelConfig.maxOutputTokens,
      temperature: modelConfig.temperature,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const body = (await response.json()) as AnthropicResponse;
  if (!response.ok) {
    throw new Error(
      `Anthropic API request failed for ${modelConfig.id}: ${body.error?.message || response.statusText}`,
    );
  }

  const rawText =
    body.content
      ?.filter((part) => part.type === 'text' || part.text)
      .map((part) => part.text || '')
      .join('')
      .trim() || '';
  const usage = buildUsage(modelConfig, {
    inputTokens: body.usage?.input_tokens || estimateTokens(prompt),
    outputTokens: body.usage?.output_tokens || estimateTokens(rawText),
    totalTokens:
      (body.usage?.input_tokens || estimateTokens(prompt)) +
      (body.usage?.output_tokens || estimateTokens(rawText)),
  });

  return {
    decision: parseDecision(rawText),
    rawText,
    latencyMs,
    usage,
  };
}

async function callGeminiModel(
  modelConfig: ModelConfig,
  prompt: string,
): Promise<ModelCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing GEMINI_API_KEY. Set it in your shell or run with QA_MODEL_PROVIDER=mock for structural verification.',
    );
  }

  const startedAt = performance.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: modelConfig.temperature,
          maxOutputTokens: modelConfig.maxOutputTokens,
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  const latencyMs = Math.round(performance.now() - startedAt);
  const body = (await response.json()) as GeminiResponse & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(
      `Gemini API request failed for ${modelConfig.id}: ${body.error?.message || response.statusText}`,
    );
  }

  const rawText =
    body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim() || '';
  const usage = buildUsage(modelConfig, {
    inputTokens: body.usageMetadata?.promptTokenCount || estimateTokens(prompt),
    outputTokens:
      body.usageMetadata?.candidatesTokenCount || estimateTokens(rawText),
    totalTokens:
      body.usageMetadata?.totalTokenCount ||
      estimateTokens(prompt) + estimateTokens(rawText),
  });

  return {
    decision: parseDecision(rawText),
    rawText,
    latencyMs,
    usage,
  };
}

function callMockModel(
  modelConfig: ModelConfig,
  prompt: string,
): ModelCallResult {
  const startedAt = performance.now();
  const lowerPrompt = prompt.toLowerCase();
  const detectedFailure =
    lowerPrompt.includes('loading overlay is still visible') ||
    lowerPrompt.includes('remains behind a loading overlay') ||
    lowerPrompt.includes('stuck loading');
  const decision: AgentDecision = detectedFailure
    ? {
        verdict: 'failed',
        summary:
          'The trajectory shows the detection flow remains stuck behind a loading overlay.',
        failure_reason:
          'The app does not recover after capture is unavailable.',
        confidence: 0.86,
        observed_success_criteria: ['The adverse detection path was exercised.'],
        missed_or_risky_criteria: [
          'The app does not return to a recoverable idle state.',
        ],
      }
    : {
        verdict: 'passed',
        summary: 'The observed trajectory satisfies the requested success criteria.',
        failure_reason: null,
        confidence: 0.8,
        observed_success_criteria: ['The expected visible state was observed.'],
        missed_or_risky_criteria: [],
      };
  const rawText = JSON.stringify(decision);
  const usage = buildUsage(modelConfig, {
    inputTokens: estimateTokens(prompt),
    outputTokens: estimateTokens(rawText),
    totalTokens: estimateTokens(prompt) + estimateTokens(rawText),
  });

  return {
    decision,
    rawText,
    latencyMs: Math.round(performance.now() - startedAt),
    usage,
  };
}

function buildPrompt(
  basePrompt: string,
  appManifest: AppManifest,
  testCase: TestCase,
  actions: Observation[],
): string {
  const publicTestCase = {
    id: testCase.id,
    name: testCase.name,
    category: testCase.category,
    goal: testCase.goal,
    steps: testCase.steps,
    expected_result: testCase.expected_result,
    success_criteria: testCase.success_criteria,
  };

  return [
    basePrompt.trim(),
    '',
    'App under test:',
    JSON.stringify(
      {
        name: appManifest.name,
        repo: appManifest.repo,
        description: appManifest.description,
        platforms: appManifest.platforms,
        requiredSecrets: appManifest.requiredSecrets,
        primaryFlows: appManifest.primaryFlows,
      },
      null,
      2,
    ),
    '',
    'Test case:',
    JSON.stringify(publicTestCase, null, 2),
    '',
    'Executed trajectory observations:',
    JSON.stringify(actions, null, 2),
  ].join('\n');
}

function parseDecision(rawText: string): AgentDecision {
  const parsed = parseJsonObject(rawText);
  const verdict = parsed.verdict || extractStringField(rawText, 'verdict');
  const normalizedVerdict = typeof verdict === 'string' ? verdict.toLowerCase() : '';
  const summary = parsed.summary || extractStringField(rawText, 'summary');
  const failureReason =
    parsed.failure_reason || extractStringField(rawText, 'failure_reason');

  return {
    verdict: VERDICTS.has(normalizedVerdict as Verdict)
      ? (normalizedVerdict as Verdict)
      : 'unsure',
    summary:
      typeof summary === 'string'
        ? summary
        : 'The model did not provide a usable summary.',
    failure_reason:
      typeof failureReason === 'string'
        ? failureReason
        : parsed.failure_reason === null ||
            rawText.includes('"failure_reason": null') ||
            normalizedVerdict === 'passed'
          ? null
          : 'The model response did not include a valid failure reason.',
    confidence:
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
    observed_success_criteria: toStringArray(parsed.observed_success_criteria),
    missed_or_risky_criteria: toStringArray(parsed.missed_or_risky_criteria),
  };
}

function parseJsonObject(rawText: string): Record<string, unknown> {
  try {
    const value = JSON.parse(rawText) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const value = JSON.parse(rawText.slice(start, end + 1)) as unknown;
        return isRecord(value) ? value : {};
      } catch {
        return {};
      }
    }

    return {};
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

function buildUsage(
  modelConfig: ModelConfig,
  counts: Omit<ModelUsage, 'estimatedCostUsd'>,
): ModelUsage {
  return {
    ...counts,
    estimatedCostUsd:
      (counts.inputTokens / 1_000_000) *
        modelConfig.inputUsdPerMillionTokens +
      (counts.outputTokens / 1_000_000) *
        modelConfig.outputUsdPerMillionTokens,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractStringField(rawText: string, fieldName: string): string | undefined {
  const match = rawText.match(
    new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*(?:\\\\.[^"]*)*)`),
  );
  if (!match?.[1]) {
    return undefined;
  }

  return match[1].replace(/\\"/g, '"').trim();
}

function parseCliArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error(
        'Usage: node agent/run-agent.ts --test test-cases/smoke.json --model gemini-2.5-flash [--driver source] [--output artifacts/eval/trajectory.json]',
      );
    }

    args.set(key.slice(2), value);
  }

  const driver = (args.get('driver') || process.env.QA_DRIVER || 'source') as DriverName;
  if (driver !== 'source' && driver !== 'agent-device') {
    throw new Error('Driver must be "source" or "agent-device".');
  }

  return {
    testCasePath: args.get('test') || DEFAULT_TEST_CASE,
    modelId: args.get('model') || process.env.QA_MODEL_CONFIG || 'gemini-2.5-flash',
    driver,
    outputPath: args.get('output'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseCliArgs(process.argv.slice(2));
  const trajectory = await runQaAgent(options);
  console.log(
    JSON.stringify(
      {
        testCaseId: trajectory.testCaseId,
        model: trajectory.model.id,
        verdict: trajectory.finalVerdict.verdict,
        matchedGroundTruth: trajectory.matchedGroundTruth,
        latencyMs: trajectory.metrics.latencyMs,
        costUsd: trajectory.metrics.costUsd,
      },
      null,
      2,
    ),
  );
}
