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
const NPM_ALIAS_PREFIX = 'npm:';

export class DependencyCache {

  cache: Map<string, Record<string, string>>;

  constructor() {
    this.cache = new Map();
  }

  async resolveVersionInfo(pkgJsonPath: string, depName: string, depVersion: string): Promise<{ version: string; fix: boolean }> {
    const deps = await this.getDeclaredDependencies(pkgJsonPath);
    const specifier = deps?.[depName];
    const {name, version} = this._splitNpmAliasSpecifier(specifier);
    const fix = FIX_SEMVER_VERSION.test(version);
    if (name) {
      return {
        version: NPM_ALIAS_PREFIX + name + '@' + depVersion,
        fix
      };
    }
    return {version: depVersion, fix};
  }

  _splitNpmAliasSpecifier(specifier: string): { name: string; version: string } {
    if (!specifier?.startsWith(NPM_ALIAS_PREFIX)) {
      return {name: null, version: specifier};
    }
    specifier = specifier.substring(NPM_ALIAS_PREFIX.length);

    const namespaceMarker = '@';
    const hasNamespaceMaker = specifier.startsWith(namespaceMarker);
    const withoutNamespaceMarker = hasNamespaceMaker ? specifier.substring(namespaceMarker.length) : specifier;
    const versionDelimPos = withoutNamespaceMarker.lastIndexOf('@');
    const hasVersion = versionDelimPos > 0;
    const name = (hasNamespaceMaker ? namespaceMarker : '') + (hasVersion ? withoutNamespaceMarker.substring(0, versionDelimPos) : withoutNamespaceMarker);
    const version = hasVersion ? withoutNamespaceMarker.substring(versionDelimPos + 1) : null;
    return {name, version};
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

    return {...pckJson.peerDependencies, ...pckJson.optionalDependencies, ...pckJson.devDependencies, ...pckJson.dependencies};
  }
}
