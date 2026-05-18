/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import {readPackageJsonFromDir} from '@pnpm/read-package-json';
import {fileExists} from '../util/files.ts';

const FIX_SEMVER_VERSION = /^=?\d+\.\d+\.\d+(-.*)?$/;

export class DependencyCache {

  cache: Map<string, Record<string, string>>;

  constructor() {
    this.cache = new Map();
  }

  async isFixedDependency(pkgJsonPath: string, depName: string): Promise<boolean> {
    const deps = await this.getDeclaredDependencies(pkgJsonPath);
    const dependencyVersionSpecifier = deps?.[depName];
    return FIX_SEMVER_VERSION.test(dependencyVersionSpecifier);
  }

  async getDeclaredDependencies(pkgJsonPath: string): Promise<Record<string, string>> {
    let deps = this.cache.get(pkgJsonPath);
    if (deps === undefined) {
      deps = await this._readDependencies(pkgJsonPath);
      this.cache.set(pkgJsonPath, deps);
    }
    return deps;
  }

  async _readDependencies(pkgJsonPath: string): Promise<Record<string, string>> {
    const exists = await fileExists(pkgJsonPath);
    const pckJson = exists ? await readPackageJsonFromDir(pkgJsonPath) : null;
    if (!pckJson) {
      return null;
    }

    const allDeps = {...pckJson.peerDependencies, ...pckJson.optionalDependencies, ...pckJson.devDependencies, ...pckJson.dependencies};
    // resolve npm alias dependencies
    const npmAliasPrefix = 'npm:';
    for (const [key, value] of Object.entries(allDeps)) {
      if (value.startsWith(npmAliasPrefix)) {
        const {name, version} = this._resolveNpmAlias(value, npmAliasPrefix);
        delete allDeps[key];
        allDeps[name] = version;
      }
    }
    return allDeps;
  }

  _resolveNpmAlias(specifier: string, npmAliasPrefix: string): { name: string; version: string } {
    const bareSpecifier = specifier.substring(npmAliasPrefix.length);
    const delimPos = bareSpecifier.lastIndexOf('@');
    const hasVersion = delimPos > 0;
    const name = hasVersion ? bareSpecifier.substring(0, delimPos) : bareSpecifier;
    const version = hasVersion ? bareSpecifier.substring(delimPos + 1) : '*';
    return {name, version};
  }
}
