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
import realpathMissing from 'realpath-missing';

import {readModulesManifest} from '@pnpm/modules-yaml';
import {normalizeRegistries} from '@pnpm/normalize-registries';
import {getLockfileImporterId, type LockfileObject, readCurrentLockfile, readWantedLockfile} from '@pnpm/lockfile.fs';
import {type DepTypes, detectDepTypes} from '@pnpm/lockfile.detect-dep-types';
import {readPackageJsonFromDir} from '@pnpm/read-package-json';
import {WORKSPACE_MANIFEST_FILENAME} from '@pnpm/constants';
import {DEPENDENCIES_FIELDS, type DependenciesField, type Registries} from '@pnpm/types';
import {type GetTreeOpts, Keypath, visitTree} from './getTree.ts';
import {type TreeNodeId} from './TreeNodeId.ts';
import {DependenciesCache} from './DependenciesCache.ts';
import {getTreeNodeChildId} from './getTreeNodeChildId.ts';
import {getPkgInfo} from './getPkgInfo.ts';

export async function visitDependenciesForPackages(lockfileDir: string, packages: string[], visitor: NodePackageVisitor) {
  const modulesDir = await realpathMissing(path.join(lockfileDir, 'node_modules'));
  const modules = await readModulesManifest(modulesDir);
  const registries = normalizeRegistries({...modules?.registries});
  const internalPnpmDir = path.join(modulesDir, '.pnpm');
  const currentLockfile = await readCurrentLockfile(internalPnpmDir, {ignoreIncompatible: false});
  const wantedLockfile = await readWantedLockfile(lockfileDir, {ignoreIncompatible: false});
  const depTypes = detectDepTypes(currentLockfile);
  const dependenciesCache = new DependenciesCache();
  const opts = {
    depth: Infinity,
    excludePeerDependencies: true,
    include: {dependencies: true, devDependencies: true, optionalDependencies: true},
    registries,
    onlyProjects: false,
    skipped: new Set(modules?.skipped ?? []),
    lockfileDir: lockfileDir,
    checkWantedLockfileOnly: false,
    virtualStoreDir: modules?.virtualStoreDir,
    virtualStoreDirMaxLength: modules?.virtualStoreDirMaxLength ?? (process.platform === 'win32' ? 60 : 120)
  };
  await Promise.all(packages.map(async pkg => await visitDependenciesForPackage(pkg, currentLockfile, wantedLockfile, depTypes, dependenciesCache, visitor, opts)));
}

async function visitDependenciesForPackage(packagePath: string, currentLockfile: LockfileObject, wantedLockfile: LockfileObject, depTypes: DepTypes, cache: DependenciesCache,
  visitor: NodePackageVisitor, opts: PackageVisitOptions): Promise<void> {
  const importerId = getLockfileImporterId(opts.lockfileDir, path.resolve(opts.lockfileDir, packagePath));
  const parentId: TreeNodeId = {type: 'importer', importerId};
  const rootInfo = toNodePackageVisitInfo(opts.lockfileDir, await readPackageJson(opts.lockfileDir, packagePath));
  for (const dependenciesField of DEPENDENCIES_FIELDS.sort().filter(dependenciesField => opts.include[dependenciesField])) {
    let importer = currentLockfile.importers[importerId];
    if (!importer) {
      throw new Error(`Module of pnpm-workspace not found: '${importerId}'. Ensure the module is listed in each ${WORKSPACE_MANIFEST_FILENAME} and try again.`);
    }
    const resolvedDependencies = importer[dependenciesField] ?? {};
    for (const alias in resolvedDependencies) {
      const ref = resolvedDependencies[alias];
      const {pkgInfo: packageInfo} = getPkgInfo({
        alias,
        currentPackages: currentLockfile.packages ?? {},
        depTypes,
        rewriteLinkVersionDir: packagePath,
        linkedPathBaseDir: packagePath,
        ref,
        registries: opts.registries,
        skipped: opts.skipped,
        wantedPackages: wantedLockfile?.packages ?? {},
        virtualStoreDir: opts.virtualStoreDir,
        virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength
      });
      const depNodePackageVisitInfo = toNodePackageVisitInfo(opts.lockfileDir, packageInfo);
      const stepInto = await visitor(rootInfo, depNodePackageVisitInfo);
      if (stepInto) {
        const childNodeId = getTreeNodeChildId({parentId, dep: {alias, ref}, lockfileDir: opts.lockfileDir, importers: currentLockfile.importers});
        const visitOptions: GetTreeOpts = {
          currentPackages: currentLockfile.packages ?? {},
          excludePeerDependencies: opts.excludePeerDependencies,
          importers: currentLockfile.importers,
          includeOptionalDependencies: opts.include.optionalDependencies,
          depTypes,
          lockfileDir: opts.lockfileDir,
          onlyProjects: opts.onlyProjects,
          rewriteLinkVersionDir: packagePath,
          maxDepth: opts.depth,
          registries: opts.registries,
          skipped: opts.skipped,
          wantedPackages: wantedLockfile?.packages ?? {},
          virtualStoreDir: opts.virtualStoreDir,
          virtualStoreDirMaxLength: opts.virtualStoreDirMaxLength
        };
        await visitTree(cache, visitOptions, Keypath.initialize(childNodeId), childNodeId, depNodePackageVisitInfo, visitor);
      }
    }
  }
}

async function readPackageJson(workspaceRoot: string, packagePath: string): Promise<NodePackageVisitInfo> {
  const dir = path.join(workspaceRoot, packagePath);
  const content = await readPackageJsonFromDir(dir);
  return {name: content.name, version: content.version, path: dir};
}

export function toNodePackageVisitInfo(lockfileDir: string, packageInfo: { name: string; version: string; path: string }): NodePackageVisitInfo {
  const packagePath = path.isAbsolute(packageInfo.path) ? packageInfo.path : path.resolve(lockfileDir, packageInfo.path);
  if (!packageInfo?.name || !packageInfo?.version) {
    throw new Error(`'name' and 'version' attributes are missing in '${packagePath}'.`);
  }
  return {
    name: packageInfo.name,
    version: packageInfo.version,
    path: packagePath
  };
}

export type NodePackageVisitInfo = {
  name: string;
  version: string;
  /**
   * absolute path
   */
  path: string;
};

export type NodePackageVisitor = (parent: NodePackageVisitInfo, dep: NodePackageVisitInfo) => Promise<boolean>;

type PackageVisitOptions = {
  depth: number;
  excludePeerDependencies?: boolean;
  include: { [dependenciesField in DependenciesField]: boolean };
  registries: Registries;
  onlyProjects?: boolean;
  skipped: Set<string>;
  lockfileDir: string;
  checkWantedLockfileOnly?: boolean;
  virtualStoreDir?: string;
  virtualStoreDirMaxLength: number;
};
