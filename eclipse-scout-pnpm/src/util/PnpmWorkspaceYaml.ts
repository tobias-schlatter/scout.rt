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
import YAML from 'yaml';
import {WORKSPACE_MANIFEST_FILENAME} from '@pnpm/constants';
import {listFiles} from './files.ts';

export class PnpmWorkspaceYaml {

  path: string;
  dir: string;
  doc: YAML.Document;

  constructor(path: string, dir: string, doc: YAML.Document) {
    this.path = path;
    this.dir = dir;
    this.doc = doc;
  }

  static async parse(pnpmWorkspaceDir: string): Promise<PnpmWorkspaceYaml> {
    const pnpmWorkspaceManifestPath = path.resolve(pnpmWorkspaceDir, WORKSPACE_MANIFEST_FILENAME);
    const existingFile = await fs.readFile(pnpmWorkspaceManifestPath, 'utf8');
    const doc = YAML.parseDocument(existingFile);
    if (doc.errors?.length) {
      let hasError = false;
      doc?.errors?.forEach(err => {
        if (err.name === 'YAMLParseError') {
          hasError = true;
          console.error(`Error parsing yaml '${pnpmWorkspaceManifestPath}': ${err.message} (code ${err.code}) at ${err.pos}.`);
        } else {
          console.warn(`Warning parsing yaml '${pnpmWorkspaceManifestPath}': ${err.message} (code ${err.code}) at ${err.pos}.`);
        }
      });
      if (hasError) {
        process.exitCode = 1;
        throw new Error('Yaml parse errors.');
      }
    }
    return new PnpmWorkspaceYaml(pnpmWorkspaceManifestPath, pnpmWorkspaceDir, doc);
  }

  static async findPnpmWorkspaceDirs(root: string): Promise<string[]> {
    const workspaceFiles = await listFiles(root, WORKSPACE_MANIFEST_FILENAME, {
      folderExcludes: ['src', 'node_modules', 'target', '.git'],
      maxDepth: 2
    });
    return workspaceFiles.map(f => path.dirname(f));
  }

  getPackages(): string[] {
    const packages = this.doc.get('packages') as YAML.YAMLSeq<YAML.Scalar<string>>;
    return packages.items
      .map(i => i.value)
      .map(p => path.resolve(this.dir, p));
  }

  removeScoutOverrides() {
    const existingOverrides = this.doc.get('overrides') as YAML.YAMLMap;
    if (!existingOverrides) {
      // there are no overrides: nothing to remove and nothing to restore
      return;
    }
    existingOverrides.delete('<<');
  }

  updateScoutOverrides(newScoutOverrides: Record<string, string>) {
    // create new scout overrides block
    const scoutOverridesAnchorName = 'scout-overrides';
    const scoutOverrides = new YAML.YAMLMap();
    scoutOverrides.anchor = scoutOverridesAnchorName;
    Object.entries(newScoutOverrides).forEach(([name, override]) => scoutOverrides.set(name, override));
    const scout = new YAML.YAMLMap();
    scout.set('overrides', scoutOverrides);
    this.doc.set('scout', scout);

    // assert scout-overrides block is linked in overrides (alias)
    this._assertScoutOverridesAlias(scoutOverrides, scoutOverridesAnchorName);
  }

  _assertScoutOverridesAlias(scoutOverrides: YAML.YAMLMap, scoutOverridesAnchorName: string) {
    const key = '<<';
    const existingOverrides = this.doc.get('overrides') as YAML.YAMLMap;
    if (existingOverrides?.items?.length) {
      const first = existingOverrides.items[0] as YAML.Pair<YAML.Scalar>;
      if (first?.key?.value === key && first?.value instanceof YAML.Alias) {
        const alias = first.value as YAML.Alias;
        if (alias?.source === scoutOverridesAnchorName) {
          return; // all fine
        }
      }

      // alias is missing: add at the beginning
      existingOverrides.items = [new YAML.Pair(new YAML.Scalar(key), this.doc.createAlias(scoutOverrides, scoutOverridesAnchorName)), ...existingOverrides.items];
    } else {
      // create new overrides block including the alias
      const newOverrides = {};
      newOverrides[key] = this.doc.createAlias(scoutOverrides, scoutOverridesAnchorName);
      this.doc.set('overrides', newOverrides);
    }
  }

  async flush() {
    // Do not use @pnpm/workspace.manifest-writer as it changes order and removes comments
    const content = YAML.stringify(this.doc);
    return await fs.writeFile(this.path, content, 'utf8');
  }
}
