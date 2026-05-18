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
import {type ConvergeLogLevel} from './overrides/OverridesComputer.ts';
import {updateAllOverrides} from './overrides/updateOverrides.ts';

export async function pnpmInstall(dir: string, options: UpdateOptions = {updateMode: 'snapshots', logConverge: 'own'}): Promise<void> {
  const commonPnpmConfig = ['--recursive', '--no-lockfile', '--ignore-scripts', '--config.link-workspace-packages=true', '--config.prefer-workspace-packages=true'];
  if (options.updateMode === 'possible') {
    await disableScoutOverrides(dir);
  }
  await forkPnpm(dir, ...['update', '--no-save', ...commonPnpmConfig]);
  if (options.updateMode === 'required') {
    await disableScoutOverrides(dir);
    await forkPnpm(dir, ...['install', ...commonPnpmConfig]);
  }
  return await updateAllOverrides(dir, options.logConverge);
}

export async function disableScoutOverrides(dir: string): Promise<void> {
  const wsYaml = await PnpmWorkspaceYaml.parse(dir);
  wsYaml.removeScoutOverrides();
  return wsYaml.flush();
}

export interface UpdateOptions {
  updateMode?: 'required' | 'possible' | 'snapshots';
  logConverge?: ConvergeLogLevel;
}
