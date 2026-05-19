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
import path from 'node:path';
import process from 'node:process';
import {fileExists} from './files.ts';

export async function forkPnpm(workingDir: string, ...args: string[]): Promise<number> {
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

export async function pnpmCjs(): Promise<string> {
  const pathCandidates = [
    '../../lib/node_modules/pnpm/bin/pnpm.cjs', // e.g. Linux
    '../node_modules/pnpm/bin/pnpm.cjs' // e.g. Windows
  ];
  for (const candidate of pathCandidates) {
    const abs = path.resolve(process.execPath, candidate);
    if (await fileExists(abs)) {
      return abs;
    }
  }
  throw new Error(`Cannot find 'pnpm.cjs' in node installation '${process.execPath}'.`);
}
