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

export class PackageVisitInfo {
  name: string;
  version: string;
  /**
   * absolute path to package
   */
  path: string;

  constructor(lockfileDir: string, model: { name: string; version: string; path: string }) {
    this.path = path.isAbsolute(model.path) ? model.path : path.resolve(lockfileDir, model.path);
    if (!model?.name || !model?.version) {
      throw new Error(`'name' or 'version' attribute missing in '${this.path}'.`);
    }
    this.name = model.name;
    this.version = model.version;
  }

  id(): string {
    return `${this.name}@${this.version}`;
  }

  static async fromPackageJson(lockfileDir: string, packagePath: string): Promise<PackageVisitInfo> {
    const dir = path.join(lockfileDir, packagePath);
    const content = await readPackageJsonFromDir(dir);
    return new PackageVisitInfo(lockfileDir, {name: content.name, version: content.version, path: dir});
  }
}
