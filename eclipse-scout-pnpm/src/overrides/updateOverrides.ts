/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import {type ConvergeLogLevel, OverridesComputer} from './OverridesComputer.ts';
import {PnpmWorkspaceYaml} from '../util/PnpmWorkspaceYaml.ts';

export async function updateAllOverrides(lockfileDir: string, logConverge?: ConvergeLogLevel): Promise<void> {
  const workspaceDirs = (await PnpmWorkspaceYaml.findPnpmWorkspaceDirs(lockfileDir)).sort(); // root workspace first
  if (!workspaceDirs?.length) {
    process.exitCode = 2;
    throw new Error(`No pnpm-workspaces found in directory '${lockfileDir}'.`);
  }
  return Promise.all(workspaceDirs.map(async workspaceDir => updateOverrides(lockfileDir, workspaceDir, workspaceDir === workspaceDirs[0] ? logConverge : 'none')))
    .then(arr => null);
}

export async function updateOverrides(lockfileDir: string, workspaceDir: string, logConverge?: ConvergeLogLevel): Promise<void> {
  const wsYaml = await PnpmWorkspaceYaml.parse(workspaceDir);
  const overridesComputer = new OverridesComputer(lockfileDir, wsYaml);
  const overrides = await overridesComputer.computeOverrides(logConverge);
  wsYaml.updateScoutOverrides(overrides);
  return await wsYaml.flush();
}
