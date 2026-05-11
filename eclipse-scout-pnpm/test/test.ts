/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import {pnpmInstall} from '../src/install.ts';

// e.g. '/home/bsiag.local/mvi/IdeaProjects/hellojs/hellojs'
// e.g. '/home/bsiag.local/mvi/dev/projects/suite/26.2'
const pnpmWorkspaceRoot = process.cwd();

await pnpmInstall(pnpmWorkspaceRoot, {updateMode: 'required', logConverge: 'all'});
