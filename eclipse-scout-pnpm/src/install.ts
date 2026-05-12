/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import {fork} from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import YAML from 'yaml';

import {type ConvergeLogLevel, parseYaml, updateAllOverrides, writeYaml} from './overridesComputer.ts';
import {WORKSPACE_MANIFEST_FILENAME} from '@pnpm/constants';
import {fileExists} from './fileExists.ts';

export async function pnpmInstall(dir: string, options: UpdateOptions = {updateMode: 'snapshots', logConverge: 'own'}): Promise<void> {
  const commonPnpmConfig = ['--recursive', '--no-lockfile', '--ignore-scripts', '--config.link-workspace-packages=true', '--config.prefer-workspace-packages=true'];
  if (options.updateMode === 'possible') {
    await disableScoutOverrides(dir);
  }
  await runPnpm(dir, ...['update', '--no-save', ...commonPnpmConfig]);
  if (options.updateMode === 'required') {
    await disableScoutOverrides(dir);
    await runPnpm(dir, ...['install', ...commonPnpmConfig]);
  }
  return await updateAllOverrides(dir, options.logConverge);
}

export async function disableScoutOverrides(dir: string): Promise<void> {
  const pnpmWorkspaceManifestPath = path.resolve(dir, WORKSPACE_MANIFEST_FILENAME);
  const pnpmWorkspaceManifest = await parseYaml(pnpmWorkspaceManifestPath);
  const existingOverrides = pnpmWorkspaceManifest.get('overrides') as YAML.YAMLMap;
  if (!existingOverrides) {
    // there are no overrides: nothing to remove and nothing to restore
    return;
  }
  existingOverrides.delete('<<');
  await writeYaml(pnpmWorkspaceManifestPath, pnpmWorkspaceManifest);
}

export async function restoreOverrides(dir: string, origOverrides: YAML.YAMLMap): Promise<void> {
  if (!origOverrides) {
    return; // nothing to restore
  }
  const pnpmWorkspaceManifestPath = path.resolve(dir, WORKSPACE_MANIFEST_FILENAME);
  const pnpmWorkspaceManifest = await parseYaml(pnpmWorkspaceManifestPath);
  pnpmWorkspaceManifest.set('overrides', origOverrides);
  return await writeYaml(pnpmWorkspaceManifestPath, pnpmWorkspaceManifest);
}

export async function runPnpm(workingDir: string, ...args: string[]): Promise<number> {
  const pnpm = await pnpmCjs();
  return new Promise((resolve, reject) => {
    const child = fork(pnpm, args, {
      cwd: workingDir,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code: number, signal: NodeJS.Signals) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Child exited with code ${code}${signal ? `, signal ${signal}` : ''}`));
      }
    });
  });
}

export interface UpdateOptions {
  updateMode?: 'required' | 'possible' | 'snapshots';
  logConverge?: ConvergeLogLevel;
}

export async function pnpmCjs(): Promise<string> {
  const pathCandidates = [
    '../../lib/node_modules/pnpm/bin/pnpm.cjs', // e.g. Linux
    '../node_modules/pnpm/bin/pnpm.cjs' // e.g. Windows
  ];
  const pnpmCjs = pathCandidates.find(fileExists);
  return path.resolve(process.execPath, pnpmCjs);
}
