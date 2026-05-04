/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import {type DepPath} from '@pnpm/types';

export type TreeNodeId = TreeNodeIdImporter | TreeNodeIdPackage;

/**
 * A project local to the pnpm workspace.
 */
interface TreeNodeIdImporter {
  readonly type: 'importer';
  readonly importerId: string;
}

/**
 * A npm package depended on externally.
 */
interface TreeNodeIdPackage {
  readonly type: 'package';
  readonly depPath: DepPath;
}

export function serializeTreeNodeId(treeNodeId: TreeNodeId): string {
  switch (treeNodeId.type) {
    case 'importer': {
      // Only serialize known fields from TreeNodeId. TypeScript is duck typed and
      // objects can have any number of unknown extra fields.
      const {type, importerId} = treeNodeId;
      return JSON.stringify({type, importerId});
    }
    case 'package': {
      const {type, depPath} = treeNodeId;
      return JSON.stringify({type, depPath});
    }
  }
}
