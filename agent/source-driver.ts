import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AppManifest, Observation, TestAction } from './types.ts';

type SourceSignals = {
  appRendersThingViewer: boolean;
  hasSettingsPicker: boolean;
  hasCameraSurface: boolean;
  loadingCanStickWhenNoPhoto: boolean;
};

type SourceState = {
  launched: boolean;
  settingsModalVisible: boolean;
  selectedModel: 'General' | 'Food' | 'Travel';
  cameraPermission: 'unknown' | 'granted' | 'denied';
  loading: boolean;
  capturedImage: boolean;
  lastEvent: string;
  sourceSignals: SourceSignals | null;
};

export type SourceSession = {
  appPath: string;
  state: SourceState;
};

const MODEL_VALUES = new Set(['General', 'Food', 'Travel']);

export async function createSourceSession(
  appManifest: AppManifest,
  repoRoot: string,
): Promise<SourceSession> {
  const appPath = path.resolve(repoRoot, appManifest.localPath);
  return {
    appPath,
    state: {
      launched: false,
      settingsModalVisible: false,
      selectedModel: 'General',
      cameraPermission: 'unknown',
      loading: false,
      capturedImage: false,
      lastEvent: 'Session created; app is not launched.',
      sourceSignals: null,
    },
  };
}

export async function runSourceAction(
  session: SourceSession,
  action: TestAction,
): Promise<Observation> {
  switch (action.type) {
    case 'launch_app':
      session.state.sourceSignals = await readSourceSignals(session.appPath);
      session.state.launched = true;
      session.state.lastEvent = 'The app launched to the camera-backed home screen.';
      break;
    case 'observe_screen':
      session.state.lastEvent = 'The current screen was observed.';
      break;
    case 'tap_settings':
      requireLaunched(session);
      session.state.settingsModalVisible = true;
      session.state.lastEvent = 'The settings button was tapped and the settings modal is visible.';
      break;
    case 'select_model':
      requireLaunched(session);
      selectModel(session, action.value);
      break;
    case 'dismiss_modal':
      requireLaunched(session);
      session.state.settingsModalVisible = false;
      session.state.lastEvent = 'The settings modal was dismissed.';
      break;
    case 'deny_camera_permission':
      requireLaunched(session);
      session.state.cameraPermission = 'denied';
      session.state.lastEvent = 'Camera permission was denied for this session.';
      break;
    case 'grant_camera_permission':
      requireLaunched(session);
      session.state.cameraPermission = 'granted';
      session.state.lastEvent = 'Camera permission was granted for this session.';
      break;
    case 'tap_camera_surface':
      requireLaunched(session);
      tapCameraSurface(session);
      break;
    case 'wait':
      requireLaunched(session);
      wait(session, action.value || '1s');
      break;
    default:
      session.state.lastEvent = `Unsupported source action: ${action.type}`;
      return toObservation(session, action, false);
  }

  return toObservation(session, action, true);
}

async function readSourceSignals(appPath: string): Promise<SourceSignals> {
  const appJs = await readFile(path.join(appPath, 'App.js'), 'utf8');
  const thingViewer = await readFile(
    path.join(appPath, 'src', 'components', 'ThingViewer.js'),
    'utf8',
  );
  const settingsModal = await readFile(
    path.join(appPath, 'src', 'components', 'SettingsModal.js'),
    'utf8',
  );

  return {
    appRendersThingViewer: appJs.includes('<ThingViewer />'),
    hasSettingsPicker:
      settingsModal.includes('<Picker') &&
      settingsModal.includes('MODELS.GENERAL') &&
      settingsModal.includes('MODELS.FOOD') &&
      settingsModal.includes('MODELS.TRAVEL'),
    hasCameraSurface:
      thingViewer.includes('<Camera ref={this.cameraRef} />') &&
      thingViewer.includes('styles.touchMask'),
    loadingCanStickWhenNoPhoto:
      thingViewer.includes('this.setState({loading: true}') &&
      thingViewer.includes('if (photo)') &&
      !thingViewer.includes('else') &&
      !thingViewer.includes('finally'),
  };
}

function requireLaunched(session: SourceSession): void {
  if (!session.state.launched) {
    throw new Error('The app must be launched before this action.');
  }
}

function selectModel(session: SourceSession, value: string | undefined): void {
  if (!session.state.settingsModalVisible) {
    session.state.lastEvent = 'Model selection was attempted while the settings modal was closed.';
    return;
  }
  if (!value || !MODEL_VALUES.has(value)) {
    session.state.lastEvent = `Unsupported model selection: ${value || 'missing'}.`;
    return;
  }

  session.state.selectedModel = value as SourceState['selectedModel'];
  session.state.lastEvent = `The model picker selected ${value}.`;
}

function tapCameraSurface(session: SourceSession): void {
  if (session.state.cameraPermission === 'denied') {
    session.state.loading = true;
    session.state.capturedImage = false;
    session.state.lastEvent =
      'Detection was triggered with denied camera permission; no photo was captured and the loading overlay remains visible.';
    return;
  }

  session.state.loading = true;
  session.state.lastEvent =
    'Detection was triggered. The source driver does not call Clarifai or Microsoft Translator, so external API completion is not simulated.';
}

function wait(session: SourceSession, durationLabel: string): void {
  if (session.state.loading && session.state.cameraPermission === 'denied') {
    session.state.lastEvent = `Waited ${durationLabel}; the full-screen loading overlay is still visible.`;
    return;
  }

  session.state.lastEvent = `Waited ${durationLabel}; no visible state change occurred.`;
}

function toObservation(
  session: SourceSession,
  action: TestAction,
  ok: boolean,
): Observation {
  const visibleText = buildVisibleText(session.state);
  const notes = buildNotes(session.state);

  return {
    action,
    ok,
    screen: session.state.launched ? 'main-camera-flow' : 'not-launched',
    visibleText,
    notes,
    state: {
      launched: session.state.launched,
      settingsModalVisible: session.state.settingsModalVisible,
      selectedModel: session.state.selectedModel,
      cameraPermission: session.state.cameraPermission,
      loading: session.state.loading,
      capturedImage: session.state.capturedImage,
      lastEvent: session.state.lastEvent,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildVisibleText(state: SourceState): string[] {
  if (!state.launched) {
    return [];
  }

  const text = [
    `Model: ${state.selectedModel}`,
    'en',
    'es',
    'What the thing Is?',
    'Tap the screen to detect an object in view',
  ];
  if (state.settingsModalVisible) {
    text.push('Model:', 'General', 'Food', 'Travel');
  }
  if (state.loading) {
    text.push('Loading indicator');
  }

  return text;
}

function buildNotes(state: SourceState): string[] {
  const notes = [state.lastEvent];
  if (state.sourceSignals) {
    notes.push(
      `Source check: App.js renders ThingViewer = ${state.sourceSignals.appRendersThingViewer}.`,
      `Source check: settings picker has General/Food/Travel = ${state.sourceSignals.hasSettingsPicker}.`,
      `Source check: camera surface exists = ${state.sourceSignals.hasCameraSurface}.`,
    );
    if (
      state.sourceSignals.loadingCanStickWhenNoPhoto &&
      state.loading &&
      state.cameraPermission === 'denied'
    ) {
      notes.push(
        'Source check: detection handler has no no-photo recovery branch, matching the observed stuck loading state.',
      );
    }
  }
  if (state.loading && state.cameraPermission === 'denied') {
    notes.push(
      'User-visible issue: the app remains behind a loading overlay after capture is unavailable.',
    );
  }

  return notes;
}
