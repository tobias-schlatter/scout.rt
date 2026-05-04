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
import {promises as fs} from 'node:fs';
import {readWorkspaceManifest} from '@pnpm/workspace.read-manifest';
import {WORKSPACE_MANIFEST_FILENAME} from '@pnpm/constants';
import {type NodePackageVisitInfo, visitPnpmWorkspace} from './dependencyVisitor.ts';
import {updateWorkspaceManifest} from '@pnpm/workspace.manifest-writer';
import {readPackageJsonFromDir} from '@pnpm/read-package-json';
import {type PackageManifest} from '@pnpm/types';
import {listFiles} from './listFiles.ts';

const SNAPSHOT_REGEX = /-snapshot|-snapshot\.\d{14}$/i;
const FIX_VERSION_REGEX = /^=?\d+\.\d+\.\d+(-.*)?$/;

const PACKAGE_JSON_CACHE = new Map<string, PackageManifest>(); // TODO: find better solution

export async function updateAllOverrides(dir: string): Promise<void> {
  const workspaces = await findPnpmWorkspaces(dir);
  for (const workspace of workspaces) {
    const overrides = await computeOverrides(dir, workspace);
    await updateOverrides(workspace, overrides);
  }
}

export async function updateOverrides(pnpmWorkspaceDir: string, newOverrides: Record<string, string>): Promise<void> {
  const workspaceManifest = await readWorkspaceManifest(pnpmWorkspaceDir);
  workspaceManifest.overrides = newOverrides;
  return await updateWorkspaceManifest(pnpmWorkspaceDir, {
    updatedFields: {overrides: newOverrides}
  });
}

export async function computeOverrides(lockfileDir: string, workspaceRoot: string, logConverge = false): Promise<Record<string, string>> {
  const collector = new Map<string, Override>();
  const versionCounter = new Map<string, Map<string, string[]>>();
  const packages = await getWorkspacePackages(lockfileDir, workspaceRoot);
  const collectOverrides = visit.bind(null, collector, versionCounter, packages);
  await visitPnpmWorkspace(lockfileDir, packages, collectOverrides);

  compact(collector, versionCounter);
  if (logConverge) {
    logNonUniqueWorkspaceVersions(versionCounter, false);
  }

  const overrides = [...collector]
    .map(([pair, override]) => [pair, override.dependency.version])
    .sort();
  return Object.fromEntries(overrides);
}

async function getWorkspacePackages(lockfileDir: string, pnpmWorkspaceDir: string): Promise<string[]> {
  const workspaceManifest = await readWorkspaceManifest(pnpmWorkspaceDir);
  return workspaceManifest.packages
    .map(p => path.relative(lockfileDir, path.resolve(pnpmWorkspaceDir, p)));
}

async function findPnpmWorkspaces(root: string): Promise<string[]> {
  const workspaceFiles = await listFiles(root, WORKSPACE_MANIFEST_FILENAME, {
    folderExcludes: ['src', 'node_modules', 'target', '.git'],
    maxDepth: 2
  });
  return workspaceFiles.map(f => path.dirname(f));
}

async function visit(collector: Map<string, Override>, versionCounter: Map<string, Map<string, string[]>>, workspacePackages: string[], parent: NodePackageVisitInfo, dependency: NodePackageVisitInfo): Promise<boolean> {
  if (SNAPSHOT_REGEX.test(dependency.version)) {
    // skip snapshot dependencies: they should not be fixed
    return true; // continue stepping into snapshots
  }
  if (dependency.version.startsWith('link:')) {
    // do not store overrides for linked packages
    const isInOwnWorkspace = workspacePackages.some(wsp => dependency.path.endsWith(wsp));
    return !isInOwnWorkspace; // skip subtree if package is part of pnpm-workspace as it will be visited anyway later on
  }
  countDependencyVersions(versionCounter, parent, dependency);
  if (await isFixedDependency(parent, dependency)) {
    // there is no need to apply an override if the dependency is no range
    return true; // continue stepping into dependency
  }
  return registerOverride(collector, parent, dependency);
}

async function isFixedDependency(parent: NodePackageVisitInfo, dependency: NodePackageVisitInfo): Promise<boolean> {
  let dependencyVersionSpecifier = dependency.specifier;
  if (!dependencyVersionSpecifier) {
    let parentPackage = PACKAGE_JSON_CACHE.get(parent.path);
    if (!parentPackage) {
      const exists = await fs.stat(parent.path).then(() => true).catch(() => false);
      parentPackage = exists ? await readPackageJsonFromDir(parent.path) : null;
      PACKAGE_JSON_CACHE.set(parent.path, parentPackage);
    }
    const deps = {...parentPackage?.dependencies, ...parentPackage?.optionalDependencies};
    dependencyVersionSpecifier = deps[dependency.name];
    if (!dependencyVersionSpecifier) {
      // try npm: alias dependencies
      const npmPrefix = `npm:${dependency.name}@`;
      dependencyVersionSpecifier = Object.values(deps)
        .find(d => d.startsWith(npmPrefix))
        ?.substring(npmPrefix.length);
    }
  }
  return dependencyVersionSpecifier && FIX_VERSION_REGEX.test(dependencyVersionSpecifier);
}

function registerOverride(collector: Map<string, Override>, parent: NodePackageVisitInfo, dependency: NodePackageVisitInfo): boolean {
  let parentPart = parent.name;
  const addVersion = !parent.version.startsWith('link:') && !SNAPSHOT_REGEX.test(parent.version);
  if (addVersion) {
    parentPart += `@${parent.version}`;
  }
  const key = `${parentPart}>${dependency.name}`;
  if (collector.has(key)) {
    return false; // skip subtree, has already been processed
  }
  collector.set(key, {parent, dependency});
  return true; // continue stepping
}

function countDependencyVersions(versionCounter: Map<string, Map<string, string[]>>, parent: NodePackageVisitInfo, dep: NodePackageVisitInfo) {
  const name = dep.name;
  let existing = versionCounter.get(name);
  if (!existing) {
    existing = new Map();
    versionCounter.set(name, existing);
  }
  let current = existing.get(dep.version);
  if (!current) {
    current = [];
    existing.set(dep.version, current);
  }
  current.push(parent.path);
}

function compact(collector: Map<string, Override>, versionCounter: Map<string, Map<string, string[]>>) {
  const unique = new Map<string, string>(Array.from(versionCounter)
    .filter(([name, versions]) => versions.size === 1)
    .map(([name, versions]) => [name, versions.keys().next().value]));
  for (const [key, override] of collector.entries()) {
    if (unique.has(override.dependency.name)) {
      collector.delete(key);
    }
  }
  for (const [dependencyName, dependencyVersion] of unique.entries()) {
    collector.set(dependencyName, {dependency: {name: dependencyName, version: dependencyVersion, path: null}});
  }
}

function logNonUniqueWorkspaceVersions(versionCounter: Map<string, Map<string, string[]>>, onlyLogWorkspaceInternal: boolean) {
  const isOutsideWorkspace = (v: string[]) => v.some(p => p.indexOf('.pnpm') >= 0);
  for (const [dependencyName, versionsMap] of versionCounter.entries()) {
    if (versionsMap.size <= 1) {
      continue;
    }
    const versionsFromExternals = [...versionsMap.values()].filter(isOutsideWorkspace).length;
    if (versionsFromExternals === 0) {
      // mixed version in workspace only
      const versionUsages = [...versionsMap.entries()]
        .map(([k, v]) => `${k}: [\n${v.join(',\n')}\n]`)
        .join('\n');
      console.warn(`Dependency '${dependencyName}' does not converge:\n${versionUsages}`);
    } else if (!onlyLogWorkspaceInternal && versionsFromExternals <= 1) {
      // mixed version between the ones from the workspace and the single one from externals
      const versionUsages = [...versionsMap.entries()]
        .map(([k, v]) => `${k}: [\n${v.join(',\n')}\n]`)
        .join('\n');
      console.warn(`Dependency '${dependencyName}' does not converge:\n${versionUsages}`);
    }
  }
}

export type Override = { parent?: NodePackageVisitInfo; dependency: NodePackageVisitInfo };
