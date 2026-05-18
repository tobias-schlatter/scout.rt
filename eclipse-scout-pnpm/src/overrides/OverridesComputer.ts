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
import {PnpmWorkspaceYaml} from '../util/PnpmWorkspaceYaml.ts';
import {PackageVisitInfo} from '../pkgvisitor/PackageVisitInfo.ts';
import {DependencyCache} from './DependencyCache.ts';

const SNAPSHOT_REGEX = /-snapshot|-snapshot\.\d{14}$/i;

export class OverridesComputer {

  lockfileDir: string;
  yaml: PnpmWorkspaceYaml;
  depUsageByVersion: Map<string /* dep-name */, Map<string /* dep-version */, Map<string /* parent PackageVisitInfo.id() */, DependencyOwner>>>;
  depCache: DependencyCache;

  constructor(lockfileDir: string, yaml: PnpmWorkspaceYaml) {
    this.lockfileDir = lockfileDir;
    this.yaml = yaml;
    this.depUsageByVersion = new Map();
    this.depCache = new DependencyCache();
  }

  async computeOverrides(logConverge?: ConvergeLogLevel): Promise<Record<string, string>> {
    const packages = this.yaml.getPackages().map(p => path.relative(this.lockfileDir, p));
    await visitDependenciesForPackages(this.lockfileDir, packages, this._collect.bind(this, packages));
    this._logNonUniqueWorkspaceVersions(logConverge);
    return this._buildOverrides();
  }

  async _collect(workspacePackages: string[], parent: PackageVisitInfo, dependency: PackageVisitInfo): Promise<boolean> {
    if (dependency.version.startsWith('link:')) {
      const isInOwnWorkspace = workspacePackages.some(wsp => dependency.path.endsWith(wsp));
      if (isInOwnWorkspace) {
        return false; // skip subtree if package is part of pnpm-workspace as it will be visited anyway later on
      }
    }
    const newDependency = !this.depUsageByVersion.get(dependency.name)?.has(dependency.version);
    await this._registerDependencyUsage(parent, dependency);
    return newDependency;
  }

  async _registerDependencyUsage(parent: PackageVisitInfo, dep: PackageVisitInfo) {
    const name = dep.name;
    let existing = this.depUsageByVersion.get(name);
    if (!existing) {
      existing = new Map();
      this.depUsageByVersion.set(name, existing);
    }
    let currentVersionUsage = existing.get(dep.version);
    if (!currentVersionUsage) {
      currentVersionUsage = new Map();
      existing.set(dep.version, currentVersionUsage);
    }
    const owner = parent.id();
    const fix = await this.depCache.isFixedDependency(parent.path, name);
    currentVersionUsage.set(owner, {parent, fix});
  }

  _buildOverrides(): Record<string, string> {
    const result = new Map<string, string>();
    const allFixed = (usages: Map<string, DependencyOwner>) => [...usages.values()].every(owner => owner.fix);

    for (const [depName, versions] of this.depUsageByVersion.entries()) {
      // sort versions by usage count (highest usage first)
      const versionSorted = [...versions.entries()]
        .sort(([k, v], [s, t]) => t.size - v.size);

      // most used version of a dependency: use override without parent
      const mostOftenUsed = versionSorted[0];
      const [version, usages] = mostOftenUsed;
      let allowSkipFixed = true;
      if (this._isOverrideVersionAllowed(version) && !allFixed(usages)) {
        result.set(depName, version);
        allowSkipFixed = false;
      }

      // less used versions: use override with parent
      for (let i = 1; i < versionSorted.length; i++) {
        const [version, usages] = versionSorted[i];
        if (this._isOverrideVersionAllowed(version)) {
          for (const owner of usages.values()) {
            this._addOverride(owner, depName, version, result, allowSkipFixed);
          }
        }
      }
    }

    return Object.fromEntries([...result]
      .sort(([k, v], [s, t]) => k.localeCompare(s)));
  }

  _isOverrideVersionAllowed(version: string): boolean {
    return !version.startsWith('link:') && !SNAPSHOT_REGEX.test(version);
  }

  _addOverride(owner: DependencyOwner, depName: string, depVersion: string, overrides: Map<string, string>, allowSkipFixed: boolean): void {
    if (allowSkipFixed && owner.fix) {
      return;
    }
    const addParentVersion = this.depUsageByVersion.get(owner.parent.name)?.size > 1 && this._isOverrideVersionAllowed(owner.parent.version);
    const parentPart = owner.parent.name + (addParentVersion ? `@${owner.parent.version}` : '');
    const key = `${parentPart}>${depName}`;
    overrides.set(key, depVersion);
  }

  _logNonUniqueWorkspaceVersions(logConverge: ConvergeLogLevel) {
    if (logConverge === 'none') {
      return;
    }
    logConverge = logConverge || 'own';

    const isOutsideWorkspace = (v: Map<string, DependencyOwner>) => [...v.values()].some(o => o.parent.path.indexOf('.pnpm') >= 0);
    for (const [dependencyName, versionsMap] of this.depUsageByVersion.entries()) {
      if (versionsMap.size <= 1) {
        continue;
      }

      const versionsFromExternals = [...versionsMap.values()].filter(isOutsideWorkspace).length;
      if (versionsFromExternals === 0 || logConverge === 'all' || (logConverge === 'single-external' && versionsFromExternals === 1)) {
        const versionUsages = [...versionsMap.entries()]
          .map(([k, v]) => `${k}: [\n  ${[...v].sort().join(',\n  ')}\n]`)
          .join('\n');
        console.warn(`Dependency '${dependencyName}' does not converge:\n${versionUsages}\n`);
      }
    }
  }
}

type DependencyOwner = { parent?: PackageVisitInfo; fix: boolean };
export type ConvergeLogLevel = 'all' | 'single-external' | 'own' | 'none';
