import type { ModelConfig } from '../agent/types.ts';

export const MODEL_CONFIGS: ModelConfig[] = [
  {
    id: 'claude-sonnet-4',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    temperature: 0.1,
    maxOutputTokens: 1400,
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
    notes:
      'Frontier reasoning baseline. Pricing defaults follow Anthropic standard input/output pricing for Claude Sonnet 4.',
  },
  {
    id: 'claude-3.5-haiku',
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    label: 'Claude 3.5 Haiku',
    temperature: 0.1,
    maxOutputTokens: 1400,
    inputUsdPerMillionTokens: 0.8,
    outputUsdPerMillionTokens: 4,
    notes:
      'Smaller low-latency baseline. Pricing defaults follow Anthropic standard input/output pricing for Claude 3.5 Haiku.',
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    temperature: 0.1,
    maxOutputTokens: 1400,
    inputUsdPerMillionTokens: 1.25,
    outputUsdPerMillionTokens: 10,
    notes:
      'Frontier reasoning baseline. Pricing defaults follow Google AI Developer API paid standard text pricing for prompts under 200k tokens.',
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    temperature: 0.1,
    maxOutputTokens: 1400,
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
    notes:
      'Smaller price-performance baseline. Pricing defaults follow Google AI Developer API paid standard text pricing.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    model: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    temperature: 0.1,
    maxOutputTokens: 1400,
    inputUsdPerMillionTokens: 0.1,
    outputUsdPerMillionTokens: 0.4,
    notes:
      'Smallest Gemini cost baseline. Pricing defaults follow Google AI Developer API paid standard text pricing.',
  },
  {
    id: 'mock-adjudicator',
    provider: 'mock',
    model: 'mock-adjudicator',
    label: 'Deterministic mock adjudicator',
    temperature: 0,
    maxOutputTokens: 400,
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
    notes:
      'Offline fallback for harness verification only; not counted as a real model comparison.',
  },
];

export function getModelConfig(modelId: string): ModelConfig {
  const config = MODEL_CONFIGS.find((candidate) => candidate.id === modelId);
  if (!config) {
    const known = MODEL_CONFIGS.map((candidate) => candidate.id).join(', ');
    throw new Error(`Unknown model config "${modelId}". Known configs: ${known}`);
  }

  return config;
}
