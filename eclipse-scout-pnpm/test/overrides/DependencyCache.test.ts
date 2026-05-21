/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {DependencyCache} from '../../src/overrides/DependencyCache.ts';

describe('DependencyCache', () => {
  describe('splitNpmAliasSpecifier', () => {
    it('no alias', () => {
      assertNpmAlias('^11.3.0', null, '^11.3.0');
      assertNpmAlias(null, null, null);
      assertNpmAlias(undefined, null, undefined);
      assertNpmAlias('', null, '');
    });

    it('with namespace', () => {
      assertNpmAlias('npm:@eclipse-scout/core@26.2.0', '@eclipse-scout/core', '26.2.0');
      assertNpmAlias('npm:@eclipse-scout/core@^26.2.0', '@eclipse-scout/core', '^26.2.0');
      assertNpmAlias('npm:@eclipse-scout/core', '@eclipse-scout/core', null);
    });

    it('without namespace', () => {
      assertNpmAlias('npm:mylib@26.2.0', 'mylib', '26.2.0');
      assertNpmAlias('npm:mylib@^26.2.0', 'mylib', '^26.2.0');
      assertNpmAlias('npm:mylib', 'mylib', null);
    });

    function assertNpmAlias(rawSpecifier: string, expectedName: string, expectedVersion: string) {
      const {name, version} = new DependencyCache()._splitNpmAliasSpecifier(rawSpecifier);
      assert.equal(name, expectedName);
      assert.equal(version, expectedVersion);
    }
  });
});
