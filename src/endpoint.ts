/*********************************************************************
 * Copyright (c) 2019-2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

export enum EndpointExposure {
    DEVFILE_PUBLIC,

    DEVFILE_PRIVATE,

    DEVFILE_NONE,

    PORT_FORWARDING,

    USER,
}

export enum EndpointCategory {
    PLUGINS,

    USER
}

export interface Endpoint {
    name: string;
    exposure: EndpointExposure;
    category?: EndpointCategory;
    url: string;
    secured?: boolean;
    targetPort: number;
    protocol?: string;
    path?: string
    // terminal, etc
    type?: string;
}