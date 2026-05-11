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
import {fileExists} from './fileExists.ts';

/**
 * Gets the directory closest to the file-system root that contains a 'pnpm-workspace.yaml' file. The search starts at the given start dir stepping up the parent directories.
 * @param dir where to start searching.
 */
export async function findWorkspaceFileDir(dir: string): Promise<string> {
  let pnpmWorkspace: string = null;
  let parentDir = dir;
  let currentDir: string;
  do {
    currentDir = parentDir;
    parentDir = path.join(currentDir, '../');
    const candidate = path.join(currentDir, WORKSPACE_MANIFEST_FILENAME);
    if (await fileExists(candidate)) {
      pnpmWorkspace = currentDir;
    }
  } while (currentDir !== parentDir);
  return pnpmWorkspace;
}

export async function collectModulesInWorkspace(startDir: string, workspaceRoot?: string): Promise<Project[]> {
  if (workspaceRoot) {
    console.log(`use given workspace root: ${workspaceRoot}`);
  } else {
    workspaceRoot = await findWorkspaceFileDir(startDir);
    if (workspaceRoot) {
      console.log(`use workspace root found at: ${workspaceRoot}`);
    } else {
      workspaceRoot = path.join(startDir, '../'); // parent folder as default if no workspace file could be found
      console.log(`unable to find workspace file. Use parent directory as workspace root: ${workspaceRoot}`);
    }
  }
  return await findWorkspacePackages(workspaceRoot);
}
