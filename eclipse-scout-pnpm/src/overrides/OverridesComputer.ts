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
import {visitDependenciesForPackages} from '../pkgvisitor/PackageVisitor.ts';
import {type PnpmWorkspaceYaml} from '../util/PnpmWorkspaceYaml.ts';
import {type PackageVisitInfo} from '../pkgvisitor/PackageVisitInfo.ts';
import {DependencyCache} from './DependencyCache.ts';

/**
 * Regex to decide whether a version is a snapshot version (e.g. `1.2.3-snapshot` or `1.2.3-snapshot.19700101000000`)
 */
const SNAPSHOT_REGEX = /-snapshot|-snapshot\.\d{14}$/i;

/**
 * This class may be used to compute overrides for a given `pnpm-workspace.yaml`.
 */
export class OverridesComputer {

  /**
   * Directory of the `pnpm-lock.yaml`.
   */
  lockfileDir: string;
  /**
   * Parsed `pnpm-workspace.yaml`.
   */
  pnpmWorkspaceYaml: PnpmWorkspaceYaml;

  protected _depUsageByVersion = new Map<string /* dep alias */, Map<string /* dep version */, Map<string /* parent PackageVisitInfo.id() */, DependencyUsage>>>();
  protected _depCache = new DependencyCache();

  constructor(lockfileDir: string, pnpmWorkspaceYaml: PnpmWorkspaceYaml) {
    this.lockfileDir = lockfileDir;
    this.pnpmWorkspaceYaml = pnpmWorkspaceYaml;
  }

  /**
   * Computes overrides from all packages in {@link pnpmWorkspaceYaml}.
   */
  async computeOverrides(logConverge?: ConvergeLogLevel): Promise<Record<string, string>> {
    // get all workspace packages
    const workspacePackages = this.pnpmWorkspaceYaml.getPackages().map(p => path.relative(this.lockfileDir, p));

    // visit all workspace packages and collect all non workspace dependencies
    await visitDependenciesForPackages(
      this.lockfileDir,
      workspacePackages,
      async (owner: PackageVisitInfo, dependency: PackageVisitInfo) => {
        // skip subtree if package is part of pnpm-workspace.yaml as it will be visited anyway later on
        if (dependency.version.startsWith('link:')) {
          const isInOwnWorkspace = workspacePackages.some(wsp => dependency.path.endsWith(wsp));
          if (isInOwnWorkspace) {
            return false;
          }
        }

        // not a linked workspace dependency -> register usage
        return await this._registerDependencyUsage(owner, dependency);
      }
    );

    // log non unique packages
    this._logNonUniqueWorkspaceVersions(logConverge);

    // build overrides
    return this._buildOverrides();
  }

  /**
   * Registers a dependency usage for the given parent.
   * Returns `true` if the dependency was not registered already.
   */
  protected async _registerDependencyUsage(owner: PackageVisitInfo, dependency: PackageVisitInfo): Promise<boolean> {
    // ensure version usages for dependency
    let usagesByVersion = this._depUsageByVersion.get(dependency.alias);
    if (!usagesByVersion) {
      usagesByVersion = new Map();
      this._depUsageByVersion.set(dependency.alias, usagesByVersion);
    }

    // resolve version info
    const {version, fix} = await this._depCache.resolveVersionInfo(owner.path, dependency.alias, dependency.version);

    // flag whether the dependency was already registered
    let isNewDependency = false;

    // ensure usages for resolved version
    let usages = usagesByVersion.get(version);
    if (!usages) {
      usages = new Map();
      usagesByVersion.set(version, usages);
      isNewDependency = true;
    }

    // register owner as usage
    usages.set(owner.id, {owner, fix});

    return isNewDependency;
  }

  /**
   * Builds overrides from {@link _depUsageByVersion}.
   */
  protected _buildOverrides(): Record<string, string> {
    const result = new Map<string, string>();

    // checks whether all usages are fixed usages
    const allFixed = (usages: Map<string, DependencyUsage>) => [...usages.values()]
      .every(usage => usage.fix);

    for (const [depAlias, versions] of this._depUsageByVersion.entries()) {
      const versionsSorted = this._getDependencyVersionsSorted(versions);

      // most used version of a dependency -> use override without parent
      const [mostUsedVersion, mostUsedUsages] = versionsSorted[0];
      let allowSkipFixed = true;
      // add version without parent if possible
      if (this._isOverrideVersionAllowed(mostUsedVersion) && !allFixed(mostUsedUsages)) {
        result.set(depAlias, mostUsedVersion);
        // even fixed version need to be added to overrides, as otherwise they are overridden by the recently added override without a parent
        allowSkipFixed = false;
      }

      // less used versions -> use override with parent
      for (let i = 1; i < versionsSorted.length; i++) {
        const [version, usages] = versionsSorted[i];
        // add overrides for all versions and owners
        if (this._isOverrideVersionAllowed(version)) {
          for (const usage of usages.values()) {
            this._addOverride(result, depAlias, version, usage, allowSkipFixed);
          }
        }
      }
    }

    // sort alphabetically by alias
    return Object.fromEntries([...result].sort(([alias1, version1], [alias2, version2]) => alias1.localeCompare(alias2)));
  }

  /**
   * Sort versions by usage count (from high to low).
   */
  protected _getDependencyVersionsSorted(versions: Map<string, Map<string, DependencyUsage>>): [string, Map<string, DependencyUsage>][] {
    return [...versions.entries()]
      .sort(([version1, usages1], [version2, usages2]) => {
        // compare usage count
        const sizeDiff = usages2.size - usages1.size;
        if (sizeDiff) {
          return sizeDiff;
        }

        // ensure stable sort in case of same size (prevents flip-flop changes)
        return version1.localeCompare(version2);
      });
  }

  /**
   * Checks whether an override is allowed for the given version.
   * It is allowed if the version is not a link (i.e. starts with 'link:') and not a snapshot version.
   */
  protected _isOverrideVersionAllowed(version: string): boolean {
    return !version.startsWith('link:') && !SNAPSHOT_REGEX.test(version);
  }

  /**
   * Adds an override for the given alias and version to the given {@link Map}.
   * Skips fix versions if skip is allowed.
   */
  protected _addOverride(overrides: Map<string, string>, depAlias: string, depVersion: string, usage: DependencyUsage, allowSkipFixed: boolean) {
    // nothing to fix and skip allowed
    if (usage.fix && allowSkipFixed) {
      return;
    }
    // check whether the parent occurs in multiple versions and its version needs to be included
    const addParentVersion = this._depUsageByVersion.get(usage.owner.name)?.size > 1 && this._isOverrideVersionAllowed(usage.owner.version);
    const parentPart = usage.owner.name + (addParentVersion ? `@${usage.owner.version}` : '');

    // add override
    overrides.set(`${parentPart}>${depAlias}`, depVersion);
  }

  /**
   * Logs non unique packages (see {@link ConvergeLogLevel}).
   */
  protected _logNonUniqueWorkspaceVersions(logConverge: ConvergeLogLevel) {
    // nothing to log
    if (logConverge === convergeLogLevel.NONE) {
      return;
    }
    logConverge = logConverge || convergeLogLevel.OWN;

    // check if at least one usage comes from an external package
    const isOutsideWorkspace = (usages: Map<string, DependencyUsage>) => [...usages.values()].some(usage => usage.owner.path.indexOf('.pnpm') >= 0);

    for (const [depAlias, versionsMap] of this._depUsageByVersion.entries()) {
      // version occurs only once -> nothing to log
      if (versionsMap.size <= 1) {
        continue;
      }

      // count versions from externals
      const versionsFromExternalsCount = [...versionsMap.values()].filter(isOutsideWorkspace).length;

      // log warning depending on requested convergence
      if (logConverge === convergeLogLevel.ALL || (logConverge === convergeLogLevel.SINGLE_EXTERNAL && versionsFromExternalsCount === 1) || versionsFromExternalsCount === 0) {
        const versionUsages = [...versionsMap.entries()]
          .map(([version, usages]) => `${version}: [\n  ${[...usages.keys()].sort().join(',\n  ')}\n]`)
          .join('\n');
        console.warn(`Dependency '${depAlias}' does not converge:\n${versionUsages}\n`);
      }
    }
  }
}

export type DependencyUsage = { owner?: PackageVisitInfo; fix: boolean };

/**
 * @see convergeLogLevel
 */
export type ConvergeLogLevel = typeof convergeLogLevel[keyof typeof convergeLogLevel];
/**
 * Determines whether convergence information is logged for dependencies...
 * - `all`: ...of all packages
 * - `single-external`: ...where exactly one of the different versions comes from an external package
 * - `own`: ...where all different versions come from own packages
 * - `none`: ...of no package
 */
export const convergeLogLevel = {
  ALL: 'all',
  SINGLE_EXTERNAL: 'single-external',
  OWN: 'own',
  NONE: 'none'
} as const;
