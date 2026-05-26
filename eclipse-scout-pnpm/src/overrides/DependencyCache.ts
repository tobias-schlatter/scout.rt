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

/**
 * This class may be used to resolve meta information about dependencies, e.g. if a dependency was declared using a npm alias (see {@link resolveVersionInfo}).
 */
export class DependencyCache {

  protected _cache = new Map<string, Record<string, string>>();

  /**
   * Resolves information about the given dependency and its version in the given `package.json`.
   * If the dependency is declared using a npm alias the version returned contains the complete npm alias.
   * The returned fix-flag states whether the dependency was declared using a fix version or a range.
   */
  async resolveVersionInfo(pkgJsonPath: string, depName: string, depVersion: string): Promise<{ version: string; fix: boolean }> {
    // get dependencies for package.json
    const deps = await this._getDependencies(pkgJsonPath);

    // get declared version specifier and split it into name and version
    const specifier = deps?.[depName];
    const {name, version} = this._splitNpmAliasSpecifier(specifier);

    // check whether the declared version is a fix one or a range
    const fix = FIX_SEMVER_VERSION.test(version);

    // return complete npm alias specifier if present
    if (name) {
      return {
        version: NPM_ALIAS_PREFIX + name + '@' + depVersion,
        fix
      };
    }
    return {version: depVersion, fix};
  }

  /**
   * Splits a npm alias specifier into the declared name and version of the dependency.
   * If e.g. a dependency is declared as `"foo": "npm:bar@42.13.7"` the specifier is split into `{name: "bar", version "42.13.7"}`.
   */
  protected _splitNpmAliasSpecifier(specifier: string): { name?: string; version: string } {
    // not a npm alias specifier -> simply return specifier as version
    if (!specifier?.startsWith(NPM_ALIAS_PREFIX)) {
      return {version: specifier};
    }

    // cut off npm alias prefix
    specifier = specifier.substring(NPM_ALIAS_PREFIX.length);

    // cut off namespace marker so it does not interfere with the version delimiter
    const namespaceMarker = '@';
    const hasNamespaceMaker = specifier.startsWith(namespaceMarker);
    const withoutNamespaceMarker = hasNamespaceMaker ? specifier.substring(namespaceMarker.length) : specifier;

    // find version delimiter
    const versionDelimPos = withoutNamespaceMarker.lastIndexOf('@');
    const hasVersion = versionDelimPos > 0;

    // split into name and version
    const name = (hasNamespaceMaker ? namespaceMarker : '') + (hasVersion ? withoutNamespaceMarker.substring(0, versionDelimPos) : withoutNamespaceMarker);
    const version = hasVersion ? withoutNamespaceMarker.substring(versionDelimPos + 1) : null;

    return {name, version};
  }

  /**
   * Gets all dependencies for the given `package.json`, i.e. dependencies, devDependencies, optionalDependencies and peerDependencies.
   * The returned object contains all of these dependencies and their declared versions.
   */
  protected async _getDependencies(pkgJsonPath: string): Promise<Record<string, string>> {
    let deps = this._cache.get(pkgJsonPath);

    // read dependencies from package.json if not in cache already
    if (deps === undefined) {
      deps = await this._readDependencies(pkgJsonPath);
      this._cache.set(pkgJsonPath, deps);
    }

    return deps;
  }

  /**
   * Reads all dependencies from the given `package.json`, i.e. dependencies, devDependencies, optionalDependencies and peerDependencies.
   * The returned object contains all of these dependencies and their declared versions.
   */
  protected async _readDependencies(pkgJsonPath: string): Promise<Record<string, string>> {
    // check if package.json exists
    if (!pkgJsonPath || !(await fileExists(pkgJsonPath))) {
      return null;
    }

    // read package.json and collect dependencies
    const pckJson = await readPackageJsonFromDir(pkgJsonPath);
    return {
      ...pckJson.peerDependencies,
      ...pckJson.optionalDependencies,
      ...pckJson.devDependencies,
      ...pckJson.dependencies
    };
  }
}
