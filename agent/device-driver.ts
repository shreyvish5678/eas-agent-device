import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import type { AppManifest, Observation, TestAction } from './types.ts';

type CommandResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ExecFileError = Error & {
  code?: number | string;
  stdout?: string;
  stderr?: string;
};

export type DeviceSession = {
  applicationId: string;
  appPath: string;
  platform: 'android' | 'ios';
};

const execFile = promisify(execFileCallback);

export function createDeviceSession(appManifest: AppManifest): DeviceSession {
  const platform = process.env.QA_PLATFORM === 'ios' ? 'ios' : 'android';
  const applicationId =
    process.env.APPLICATION_ID ||
    (platform === 'ios'
      ? appManifest.platforms.ios.bundleIdentifier
      : appManifest.platforms.android.applicationId);

  return {
    applicationId,
    appPath: process.env.APP_PATH || '',
    platform,
  };
}

export async function runDeviceAction(
  session: DeviceSession,
  action: TestAction,
): Promise<Observation> {
  if (action.type === 'launch_app') {
    return launchApp(session, action);
  }
  if (action.type === 'observe_screen') {
    const snapshot = await runAgentDevice(['snapshot']);
    return toObservation(action, snapshot.ok, 'device-snapshot', [
      snapshot.stdout || snapshot.stderr,
    ]);
  }
  if (action.type === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return toObservation(action, true, 'device-wait', [
      `Waited ${action.value || '1s'} in the bound device session.`,
    ]);
  }

  return toObservation(action, false, 'device-unsupported-action', [
    `The lightweight device driver does not map "${action.type}" to coordinates or accessibility refs. Use scripts/agent-qa/index.ts for free-form agent-device exploration on a real APK/.app.`,
  ]);
}

async function launchApp(
  session: DeviceSession,
  action: TestAction,
): Promise<Observation> {
  const notes: string[] = [];
  if (session.appPath) {
    const install =
      session.platform === 'android'
        ? await runAgentDevice(['install', session.applicationId, session.appPath])
        : await runAgentDevice(['reinstall', session.applicationId, session.appPath]);
    notes.push(formatCommandResult('install/reinstall', install));
    if (!install.ok) {
      return toObservation(action, false, 'device-launch', notes);
    }
  }

  const open = await runAgentDevice(['open', session.applicationId, '--relaunch']);
  notes.push(formatCommandResult('open', open));
  return toObservation(action, open.ok, 'device-launch', notes);
}

async function runAgentDevice(args: string[]): Promise<CommandResult> {
  try {
    const result = await execFile('agent-device', args, {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (unknownError) {
    const error = unknownError as ExecFileError;
    return {
      ok: false,
      exitCode: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
    };
  }
}

function toObservation(
  action: TestAction,
  ok: boolean,
  screen: string,
  notes: string[],
): Observation {
  return {
    action,
    ok,
    screen,
    visibleText: [],
    notes,
    state: {
      ok,
    },
    timestamp: new Date().toISOString(),
  };
}

function formatCommandResult(label: string, result: CommandResult): string {
  const output = (result.stdout || result.stderr).trim();
  const trimmedOutput = output.length > 1200 ? `${output.slice(0, 1200)}...` : output;
  return `${label}: exit=${result.exitCode}, ok=${result.ok}${trimmedOutput ? `, output=${trimmedOutput}` : ''}`;
}
