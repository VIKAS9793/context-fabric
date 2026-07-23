// src/config.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface GlobalConfig {
  telemetryOptIn?: boolean;
  runCount: number;
  lastPing?: number;
}

const CONFIG_PATH = join(homedir(), '.context-fabric-global.json');

const DEFAULT_CONFIG: GlobalConfig = {
  runCount: 0,
};

export function readGlobalConfig(): GlobalConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const data = readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeGlobalConfig(config: GlobalConfig): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    // Silently fail if unable to write config (e.g., permissions)
  }
}

export function incrementRunCount(): number {
  const config = readGlobalConfig();
  config.runCount += 1;
  writeGlobalConfig(config);
  return config.runCount;
}

export function updateTelemetryPreference(optIn: boolean): void {
  const config = readGlobalConfig();
  config.telemetryOptIn = optIn;
  writeGlobalConfig(config);
}

export function pingTelemetryIfNeeded(): void {
  const config = readGlobalConfig();
  if (config.telemetryOptIn !== true) return;

  const now = Date.now();
  // Only ping once every 24 hours
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (config.lastPing && (now - config.lastPing) < ONE_DAY) {
    return;
  }

  // Fire and forget (dummy endpoint)
  fetch('https://api.contextfabric.dev/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      os: process.platform,
      version: '1.2.0',
      timestamp: new Date().toISOString()
    })
  }).catch(() => {
    // Ignore network errors completely
  });

  config.lastPing = now;
  writeGlobalConfig(config);
}
