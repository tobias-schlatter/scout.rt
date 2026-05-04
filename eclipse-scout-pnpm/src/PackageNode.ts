/*
 * Copyright (c) 2010, 2026 BSI Business Systems Integration AG
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 */

export interface PackageNode {
  alias: string;
  circular?: true;
  dependencies?: PackageNode[];
  dev?: boolean;
  isPeer: boolean;
  isSkipped: boolean;
  isMissing: boolean;
  name: string;
  optional?: true;
  path: string;
  resolved?: string;
  searched?: true;
  version: string;
  searchMessage?: string;
}
