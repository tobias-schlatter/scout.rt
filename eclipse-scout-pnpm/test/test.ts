/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import {test, type TestContext} from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import {pnpmInstall} from '../src/install.ts';

test('install required', async (t: TestContext) => {
  const pnpmWorkspaceRoot = path.resolve(process.cwd(), '../..');
  await pnpmInstall(pnpmWorkspaceRoot, {updateMode: 'required', logConverge: 'all'});
  assert.strictEqual(1, 1);
});
