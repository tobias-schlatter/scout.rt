/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import {updateAllOverrides} from './overridesComputer.ts';
import {type InstallCommandOptions} from '@pnpm/plugin-commands-installation';

export async function pnpmInstall(dir: string, updateSnapshots = true): Promise<void> {
  // const overrides = {}; // TODO
  //
  // const updateOptions: UpdateCommandOptions = {
  //   ...baseConfig,
  //   recursive: true,
  //   overrides: overrides,
  //   dir: dir,
  //   rootProjectManifestDir: dir,
  //   latest: true,
  //   save: false,
  //   linkWorkspacePackages: true,
  //   preferWorkspacePackages: true
  // };
  // await update.handler(updateOptions);
  //
  //
  // const installConfig = await getConfig({recursive: true}, {
  //   excludeReporter: false,
  //   globalDirShouldAllowWrite: true,
  //   rcOptionsTypes: install.rcOptionsTypes(),
  //   workspaceDir: dir,
  //   checkUnknownSetting: false,
  //   ignoreNonAuthSettingsFromLocal: false
  // });
  // const installOptions: InstallCommandOptions = {
  //   ...installConfig,
  //   recursive: true,
  //   overrides: undefined,
  //   dir: dir,
  //   rootProjectManifestDir: dir,
  //   save: false,
  //   linkWorkspacePackages: true,
  //   preferWorkspacePackages: true
  // };
  // await install.handler(installOptions);

  await updateAllOverrides(dir);
}

export type UpdateCommandOptions = InstallCommandOptions & {
  interactive?: boolean;
  latest?: boolean;
};

