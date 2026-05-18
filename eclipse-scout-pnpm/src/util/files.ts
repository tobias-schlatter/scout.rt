/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import {promises as fs} from 'node:fs';
import {join, resolve} from 'node:path';

export type ListFilesOptions = {
  /** Folder names to exclude – if omitted all folders are traversed */
  folderExcludes?: string[];

  /** Maximum recursion depth (0 = only root). Omit for unlimited */
  maxDepth?: number;
};

/**
 * Recursively list absolute paths of files that exactly match `fileName`.
 *
 * @param root Starting directory (absolute or relative)
 * @param fileName Name of the file to match (case‑sensitive)
 * @param opts Optional folder filters and max depth
 * @returns Array of matching absolute file paths
 */
export async function listFiles(root: string, fileName: string, opts: ListFilesOptions = {}): Promise<string[]> {
  const results: string[] = [];
  const start = resolve(root);
  const maxDepth = opts.maxDepth ?? Infinity;
  const exclusions = opts.folderExcludes ? new Set(opts.folderExcludes) : null;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    const entries = await fs.readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!exclusions || !exclusions.has(entry.name)) {
          await walk(fullPath, depth + 1);
        }
      } else if (entry.isFile() && entry.name === fileName) {
        results.push(fullPath);
      }
    }
  }

  await walk(start, 0);
  return results;
}

export async function fileExists(path: string): Promise<boolean> {
  return await fs.access(path, fs.constants.R_OK).then(() => true).catch(() => false);
}
