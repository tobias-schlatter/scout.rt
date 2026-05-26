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
import {readPackageJsonFromDir} from '@pnpm/read-package-json';

/**
 * This class contains information about a package.
 * This information may depend on the context.
 * E.g. if the package is used as a dependency which is declared using a npm alias, both alias and name are set.
 **/
// TODO fsh name
export class PackageVisitInfo {
  /**
   * Name of the package.
   */
  name: string;
  /**
   * Alias the package is used by.
   */
  alias: string;
  /**
   * Version of the package.
   */
  version: string;
  /**
   * Absolute path to package.
   */
  path: string;

  constructor(lockfileDir: string, model: { name: string; alias: string; version: string; path: string }) {
    this.path = path.isAbsolute(model.path) ? model.path : path.resolve(lockfileDir, model.path);
    if (!model?.name || !model?.alias || !model?.version) {
      throw new Error(`'name', 'alias' or 'version' attribute missing in '${this.path}'.`);
    }
    this.name = model.name;
    this.alias = model.alias;
    this.version = model.version;
  }

  /**
   * {@link name} and {@link version} combined (e.g. `foo@1.2.3`)
   */
  get id(): string {
    return `${this.name}@${this.version}`;
  }

  /**
   * Parses a {@link PackageVisitInfo} from a `package.json` file in the given directory.
   */
  static async fromPackageJson(directory: string): Promise<PackageVisitInfo> {
    const content = await readPackageJsonFromDir(directory);
    return new PackageVisitInfo(
      null,
      {
        name: content.name,
        alias: content.name,
        version: content.version,
        path: directory
      }
    );
  }
}
