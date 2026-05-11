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
import {WORKSPACE_MANIFEST_FILENAME} from '@pnpm/constants';
import {type NodePackageVisitInfo, visitPnpmWorkspace} from './dependencyVisitor.ts';
import YAML from 'yaml';
import {readPackageJsonFromDir} from '@pnpm/read-package-json';
import {type PackageManifest} from '@pnpm/types';
import {listFiles} from './listFiles.ts';
import {fileExists} from './fileExists.ts';

const SNAPSHOT_REGEX = /-snapshot|-snapshot\.\d{14}$/i;
const FIX_VERSION_REGEX = /^=?\d+\.\d+\.\d+(-.*)?$/;

const PACKAGE_JSON_CACHE = new Map<string, PackageManifest>(); // TODO: find better solution

export async function updateAllOverrides(dir: string, logConverge: ConvergeLogLevel): Promise<void> {
  const workspaces = (await findPnpmWorkspaces(dir)).sort(); // root workspace first
  if (!workspaces?.length) {
    process.exitCode = 2;
    throw new Error(`No pnpm-workspaces found in directory '${dir}'.`);
  }

  for (const workspace of workspaces) {
    const isFirst = workspace === workspaces[0];
    const overrides = await computeOverrides(dir, workspace, isFirst ? logConverge : 'none');
    await updateOverrides(workspace, overrides);
  }
}

// Do not use @pnpm/workspace.manifest-writer as it changes order and removes comments
export async function updateOverrides(pnpmWorkspaceDir: string, newScoutOverrides: Record<string, string>): Promise<void> {
  const pnpmWorkspaceManifestPath = path.resolve(pnpmWorkspaceDir, WORKSPACE_MANIFEST_FILENAME);

  // read existing manifest
  const pnpmWorkspaceManifest = await parseYaml(pnpmWorkspaceManifestPath);

  // create new scout overrides block
  const scoutOverridesAnchorName = 'scout-overrides';
  const scoutOverrides = new YAML.YAMLMap();
  scoutOverrides.anchor = scoutOverridesAnchorName;
  Object.entries(newScoutOverrides).forEach(([name, override]) => scoutOverrides.set(name, override));
  const scout = new YAML.YAMLMap();
  scout.set('overrides', scoutOverrides);
  pnpmWorkspaceManifest.set('scout', scout);

  // assert scout-overrides block is linked in overrides (alias)
  assertScoutOverridesAlias(pnpmWorkspaceManifest, scoutOverrides, scoutOverridesAnchorName);

  // flush new manifest
  return await writeYaml(pnpmWorkspaceManifestPath, pnpmWorkspaceManifest);
}

export function assertScoutOverridesAlias(doc: YAML.Document, scoutOverrides: YAML.YAMLMap, scoutOverridesAnchorName: string) {
  const key = '<<';
  const existingOverrides = doc.get('overrides') as YAML.YAMLMap;
  if (existingOverrides?.items?.length) {
    const first = existingOverrides.items[0] as YAML.Pair<YAML.Scalar>;
    if (first?.key?.value === key && first?.value instanceof YAML.Alias) {
      const alias = first.value as YAML.Alias;
      if (alias?.source === scoutOverridesAnchorName) {
        return; // all fine
      }
    }

    // alias is missing: add at the beginning
    existingOverrides.items = [new YAML.Pair(new YAML.Scalar(key), doc.createAlias(scoutOverrides, scoutOverridesAnchorName)), ...existingOverrides.items];
  } else {
    // create new overrides block including the alias
    const newOverrides = {};
    newOverrides[key] = doc.createAlias(scoutOverrides, scoutOverridesAnchorName);
    doc.set('overrides', newOverrides);
  }
}

export async function parseYaml(file: string): Promise<YAML.Document> {
  const existingFile = await fs.readFile(file, 'utf8');
  const doc = YAML.parseDocument(existingFile);
  if (doc.errors?.length) {
    let hasError = false;
    doc?.errors?.forEach(err => {
      if (err.name === 'YAMLParseError') {
        hasError = true;
        console.error(`Error parsing yaml '${file}': ${err.message} (code ${err.code}) at ${err.pos}.`);
      } else {
        console.warn(`Warning parsing yaml '${file}': ${err.message} (code ${err.code}) at ${err.pos}.`);
      }
    });
    if (hasError) {
      process.exitCode = 1;
      throw new Error('Yaml parse errors. Scout overrides update aborted.');
    }
  }
  return doc;
}

export async function writeYaml(file: string, doc: YAML.Document): Promise<void> {
  const content = YAML.stringify(doc);
  return await fs.writeFile(file, content, 'utf8');
}

export async function computeOverrides(lockfileDir: string, workspaceRoot: string, logConverge: ConvergeLogLevel): Promise<Record<string, string>> {
  const collector = new Map<string, Override>();
  const versionCounter = new Map<string, Map<string, Set<string>>>();
  const packages = await getWorkspacePackages(lockfileDir, workspaceRoot);
  const collectOverrides = visit.bind(null, collector, versionCounter, packages);
  await visitPnpmWorkspace(lockfileDir, packages, collectOverrides);

  compact(collector, versionCounter);
  logNonUniqueWorkspaceVersions(versionCounter, logConverge);

  const overrides = [...collector]
    .map(([key, override]) => [key, override.dependency.version])
    .sort();
  return Object.fromEntries(overrides);
}

async function getWorkspacePackages(lockfileDir: string, pnpmWorkspaceDir: string): Promise<string[]> {
  const workspaceManifest = await parseYaml(path.resolve(pnpmWorkspaceDir, WORKSPACE_MANIFEST_FILENAME));
  const packages = workspaceManifest.get('packages') as YAML.YAMLSeq<YAML.Scalar<string>>;
  return packages.items
    .map(i => i.value)
    .map(p => path.relative(lockfileDir, path.resolve(pnpmWorkspaceDir, p)));
}

async function findPnpmWorkspaces(root: string): Promise<string[]> {
  const workspaceFiles = await listFiles(root, WORKSPACE_MANIFEST_FILENAME, {
    folderExcludes: ['src', 'node_modules', 'target', '.git'],
    maxDepth: 2
  });
  return workspaceFiles.map(f => path.dirname(f));
}

async function visit(collector: Map<string, Override>, versionCounter: Map<string, Map<string, Set<string>>>, workspacePackages: string[], parent: NodePackageVisitInfo, dependency: NodePackageVisitInfo): Promise<boolean> {
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
  const isRangeDependency = !await isFixedDependency(parent, dependency);
  return registerOverride(collector, parent, dependency, isRangeDependency);
}

async function isFixedDependency(parent: NodePackageVisitInfo, dependency: NodePackageVisitInfo): Promise<boolean> {
  let parentPackage = PACKAGE_JSON_CACHE.get(parent.path);
  if (parentPackage === undefined) {
    const exists = await fileExists(parent.path);
    parentPackage = exists ? await readPackageJsonFromDir(parent.path) : null;
    PACKAGE_JSON_CACHE.set(parent.path, parentPackage);
  }
  const deps = {...parentPackage?.peerDependencies, ...parentPackage?.optionalDependencies, ...parentPackage?.devDependencies, ...parentPackage?.dependencies};
  let dependencyVersionSpecifier = deps[dependency.name];
  if (!dependencyVersionSpecifier) {
    // try npm: alias dependencies
    const npmPrefix = `npm:${dependency.name}@`;
    dependencyVersionSpecifier = Object.values(deps)
      .find(d => d.startsWith(npmPrefix))
      ?.substring(npmPrefix.length);
  }
  return dependencyVersionSpecifier && FIX_VERSION_REGEX.test(dependencyVersionSpecifier);
}

function registerOverride(collector: Map<string, Override>, parent: NodePackageVisitInfo, dependency: NodePackageVisitInfo, isRangeDependency: boolean): boolean {
  let parentPart = parent.name;
  const addVersion = !parent.version.startsWith('link:') && !SNAPSHOT_REGEX.test(parent.version);
  if (addVersion) {
    parentPart += `@${parent.version}`;
  }
  const key = `${parentPart}>${dependency.name}`;
  if (collector.has(key)) {
    return false; // skip subtree, has already been processed
  }
  collector.set(key, {parent, dependency, isRangeDependency});
  return true; // continue stepping
}

function countDependencyVersions(versionCounter: Map<string, Map<string, Set<string>>>, parent: NodePackageVisitInfo, dep: NodePackageVisitInfo) {
  const name = dep.name;
  let existing = versionCounter.get(name);
  if (!existing) {
    existing = new Map();
    versionCounter.set(name, existing);
  }
  let current = existing.get(dep.version);
  if (!current) {
    current = new Set();
    existing.set(dep.version, current);
  }
  current.add(parent.path);
}

function compact(collector: Map<string, Override>, versionCounter: Map<string, Map<string, Set<string>>>) {
  const unique = new Map<string, string>(Array.from(versionCounter)
    .filter(([name, versions]) => versions.size === 1)
    .map(([name, versions]) => [name, versions.keys().next().value]));
  const newEntries = new Map<string, Override>();
  for (const [key, override] of collector.entries()) {
    if (!override.isRangeDependency) {
      collector.delete(key);
    } else if (unique.has(override.dependency.name)) {
      // dependency completely unique: replace with a single override without parent
      newEntries.set(override.dependency.name, override);
      collector.delete(key);
    } else if (unique.has(override.parent.name)) {
      // parent version is unique: no need to add version to key: remove old one having the version and add a new one without
      newEntries.set(`${override.parent.name}>${override.dependency.name}`, override);
      collector.delete(key);
    }
  }
  for (const [key, value] of newEntries.entries()) {
    collector.set(key, value);
  }
}

function logNonUniqueWorkspaceVersions(versionCounter: Map<string, Map<string, Set<string>>>, logConverge: ConvergeLogLevel) {
  if (logConverge === 'none') {
    return;
  }

  const isOutsideWorkspace = (v: Set<string>) => [...v].some(p => p.indexOf('.pnpm') >= 0);
  for (const [dependencyName, versionsMap] of versionCounter.entries()) {
    if (versionsMap.size <= 1) {
      continue;
    }
    const versionsFromExternals = [...versionsMap.values()].filter(isOutsideWorkspace).length;
    if (versionsFromExternals === 0 || (logConverge === 'all' && versionsFromExternals === 1)) {
      // mixed versions
      const versionUsages = [...versionsMap.entries()]
        .map(([k, v]) => `${k}: [\n  ${[...v].sort().join(',\n  ')}\n]`)
        .join('\n');
      console.warn(`Dependency '${dependencyName}' does not converge:\n${versionUsages}\n`);
    }
  }
}

export type Override = { parent?: NodePackageVisitInfo; dependency: NodePackageVisitInfo; isRangeDependency: boolean };
export type ConvergeLogLevel = 'all' | 'own' | 'none';
