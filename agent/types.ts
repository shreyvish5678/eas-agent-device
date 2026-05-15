export type Verdict = 'passed' | 'failed' | 'blocked' | 'unsure';

export type DriverName = 'source' | 'agent-device';

export type TestActionType =
  | 'launch_app'
  | 'observe_screen'
  | 'tap_settings'
  | 'select_model'
  | 'dismiss_modal'
  | 'deny_camera_permission'
  | 'grant_camera_permission'
  | 'tap_camera_surface'
  | 'wait';

export type TestAction = {
  type: TestActionType;
  value?: string;
  note?: string;
};

export type GroundTruth = {
  expected_verdict: Verdict;
  rationale: string;
  known_failure_mode?: string;
};

export type TestCase = {
  id: string;
  name: string;
  category: string;
  goal: string;
  steps: string[];
  agent_actions: TestAction[];
  expected_result: string;
  success_criteria: string[];
  ground_truth: GroundTruth;
};

export type ModelConfig = {
  id: string;
  provider: 'anthropic' | 'gemini' | 'mock';
  model: string;
  label: string;
  temperature: number;
  maxOutputTokens: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  notes: string;
};

export type AppManifest = {
  name: string;
  repo: string;
  localPath: string;
  description: string;
  platforms: {
    android: {
      applicationId: string;
    };
    ios: {
      bundleIdentifier: string;
    };
  };
  requiredSecrets: string[];
  primaryFlows: string[];
};

export type Observation = {
  action: TestAction;
  ok: boolean;
  screen: string;
  visibleText: string[];
  notes: string[];
  state: Record<string, string | boolean | number | null>;
  timestamp: string;
};

export type AgentDecision = {
  verdict: Verdict;
  summary: string;
  failure_reason: string | null;
  confidence: number;
  observed_success_criteria: string[];
  missed_or_risky_criteria: string[];
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type ModelCallResult = {
  decision: AgentDecision;
  rawText: string;
  latencyMs: number;
  usage: ModelUsage;
};

export type TrajectoryLog = {
  schemaVersion: '1.0';
  runId: string;
  generatedAt: string;
  testCaseId: string;
  testCaseName: string;
  model: {
    id: string;
    provider: string;
    label: string;
  };
  driver: DriverName;
  appUnderTest: AppManifest;
  prompt: string;
  actions: Observation[];
  finalVerdict: AgentDecision;
  rawModelResponse: string;
  groundTruth: GroundTruth;
  matchedGroundTruth: boolean;
  metrics: {
    latencyMs: number;
    modelLatencyMs: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    stepCount: number;
    retryCount: number;
    screenshotCount: number;
  };
};
