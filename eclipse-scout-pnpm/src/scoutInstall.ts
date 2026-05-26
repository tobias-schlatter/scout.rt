/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import {forkPnpm} from './util/forkPnpm.ts';
import {PnpmWorkspaceYaml} from './util/PnpmWorkspaceYaml.ts';
import {convergeLogLevel, type ConvergeLogLevel} from './overrides/OverridesComputer.ts';
import {updateAllScoutOverrides} from './overrides/updateScoutOverrides.ts';

/**
 * Installs pnpm dependencies for the given directory and updates scout overrides.
 * The {@link options.updateMode} determines which dependencies are updated.
 */
export async function scoutInstall(dir: string, options: UpdateOptions = {updateMode: updateMode.SNAPSHOTS, logConverge: convergeLogLevel.OWN}): Promise<void> {
  const commonPnpmArguments = [
    '--recursive',
    '--no-lockfile',
    '--ignore-scripts',
    '--config.link-workspace-packages=true',
    '--config.prefer-workspace-packages=true'
  ];

  // 'pnpm update' updates all non overridden dependencies to the newest version available that fulfills the required version
  // if scout overrides are present, 'pnpm update' will only update dependencies that are not part of the scout overrides, i.e. snapshot dependencies
  // -> disable scout overrides depending on the updateMode
  if (options.updateMode === updateMode.POSSIBLE) {
    await disableScoutOverrides(dir);
  }

  // update
  await forkPnpm(dir, 'update', '--no-save', ...commonPnpmArguments);

  // 'pnpm install' updates all non overridden dependencies that do not fulfill the required version
  // -> disable scout overrides and call 'pnpm install' depending on the updateMode
  if (options.updateMode === updateMode.REQUIRED) {
    await disableScoutOverrides(dir);
    await forkPnpm(dir, 'install', ...commonPnpmArguments);
  }

  // update scout overrides
  return await updateAllScoutOverrides(dir, options.logConverge);
}

/**
 * Disables scout overrides of the `pnpm-workspace.yaml` in the given directory (see {@link PnpmWorkspaceYaml.removeScoutOverrides}).
 */
export async function disableScoutOverrides(dir: string): Promise<void> {
  const wsYaml = await PnpmWorkspaceYaml.parse(dir);
  wsYaml.removeScoutOverrides();
  return wsYaml.flush();
}

export interface UpdateOptions {
  /**
   * @see UpdateMode
   */
  updateMode?: UpdateMode;
  /**
   * @see ConvergeLogLevel
   */
  logConverge?: ConvergeLogLevel;
}

/**
 * @see updateMode
 */
export type UpdateMode = typeof updateMode[keyof typeof updateMode];
/**
 * Determines which dependencies are updated:
 * - `required`: all dependencies that do not fulfill the required version are updated
 * - `possible`: all dependencies are updated to the newest version available that fulfills the required version
 * - `snapshots`: only snapshot dependencies are updated to the newest version available
 */
export const updateMode = {
  REQUIRED: 'required',
  POSSIBLE: 'possible',
  SNAPSHOTS: 'snapshots'
} as const;
