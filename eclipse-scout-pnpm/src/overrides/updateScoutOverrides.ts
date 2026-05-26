/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import {convergeLogLevel, type ConvergeLogLevel, OverridesComputer} from './OverridesComputer.ts';
import {PnpmWorkspaceYaml} from '../util/PnpmWorkspaceYaml.ts';

/**
 * Updates overrides of all `pnpm-workspace.yaml` in the given directory and its subdirectories.
 */
export async function updateAllScoutOverrides(lockfileDir: string, logConverge?: ConvergeLogLevel): Promise<void> {
  // collect directories with pnpm-workspace.yaml, root workspace first
  const workspaceDirs = (await PnpmWorkspaceYaml.findPnpmWorkspaceDirs(lockfileDir)).sort();

  if (!workspaceDirs?.length) {
    process.exitCode = 2;
    throw new Error(`No pnpm-workspaces found in directory '${lockfileDir}'.`);
  }

  // update overrides of the pnpm-workspace.yaml in all directories
  await Promise.all(workspaceDirs.map(workspaceDir => updateScoutOverrides(workspaceDir, lockfileDir, workspaceDir === workspaceDirs[0] ? logConverge : convergeLogLevel.NONE)));
}

/**
 * Updates overrides of the `pnpm-workspace.yaml` in the given directory.
 */
export async function updateScoutOverrides(workspaceDir: string, lockfileDir: string, logConverge?: ConvergeLogLevel): Promise<void> {
  // parse pnpm-workspace.yaml
  const wsYaml = await PnpmWorkspaceYaml.parse(workspaceDir);

  // compute overrides
  const overridesComputer = new OverridesComputer(lockfileDir, wsYaml);
  const overrides = await overridesComputer.computeOverrides(logConverge);

  // update overrides and flush pnpm-workspace.yaml
  wsYaml.updateScoutOverrides(overrides);
  await wsYaml.flush();
}
