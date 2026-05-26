/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import path from 'node:path';
import {WORKSPACE_MANIFEST_FILENAME} from '@pnpm/constants';
import {findWorkspacePackages, type Project} from '@pnpm/workspace.find-packages';
import {fileExists} from './util/files.ts';

/**
 * Collects all modules in the given directory.
 * The workspace root is given is determined using {@link ensureWorkspaceRoot}.
 */
export async function collectModulesInWorkspace(dir: string, workspaceRoot?: string): Promise<Project[]> {
  // ensure workspace root
  workspaceRoot = await ensureWorkspaceRoot(dir, workspaceRoot);

  // collect modules
  return await findWorkspacePackages(workspaceRoot);
}

/**
 * Ensures the workspace root for the given directory.
 * If no workspace root is given it is determined from the given directory using {@link findWorkspaceFileDir}.
 */
export async function ensureWorkspaceRoot(dir: string, workspaceRoot?: string): Promise<string> {
  // workspace root given -> simply return
  if (workspaceRoot) {
    console.log(`use given workspace root: ${workspaceRoot}`);
    return workspaceRoot;
  }

  // no workspace root given -> try to find workspace file
  workspaceRoot = await findWorkspaceFileDir(dir);
  if (workspaceRoot) {
    console.log(`use workspace root found at: ${workspaceRoot}`);
    return workspaceRoot;
  }

  // parent folder as default if no workspace file could be found
  workspaceRoot = path.join(dir, '../');
  console.log(`unable to find workspace file. Use parent directory as workspace root: ${workspaceRoot}`);

  return workspaceRoot;
}

/**
 * Gets the directory closest to the file-system root that contains a `pnpm-workspace.yaml` file.
 * The search starts at the given start directory stepping up the parent directories.
 */
export async function findWorkspaceFileDir(dir: string): Promise<string> {
  // no directory given -> nothing to look for
  if (!dir) {
    return;
  }

  let pnpmWorkspaceDir: string;
  let currentDir: string;
  let nextDir = dir;
  // process until current and next directory are equal, which is the case when the root folder is reached
  while (currentDir !== nextDir) {
    // update current and next directory, next is the parent directory of the current
    currentDir = nextDir;
    nextDir = path.join(currentDir, '../');

    // look for a pnpm-workspace.yaml file
    const candidate = path.join(currentDir, WORKSPACE_MANIFEST_FILENAME);
    if (await fileExists(candidate)) {
      pnpmWorkspaceDir = currentDir;
    }
  }
  return pnpmWorkspaceDir;
}
