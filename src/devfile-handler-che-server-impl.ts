/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Endpoint, EndpointExposure, EndpointCategory } from "./endpoint";
import * as che from '@eclipse-che/plugin';
import { CommandPreviewUrl } from "./devfile-handler";

/**
 * Grab endpoints from a devfile.
 * @author Florent Benoit
 */

export class CheServerDevfileHandlerImpl {
    async getEndpoints(): Promise<Array<Endpoint>> {

        const workspace = await che.workspace.getCurrentWorkspace();

        const endpoints: Endpoint[] = [];
        if (!workspace) {
            return endpoints;
        }

        const previewUrls: CommandPreviewUrl[] = [];
        if (workspace.devfile && workspace.devfile.commands) {
            const commands = workspace.devfile.commands;
            for (const command of commands) {
                if (command.previewUrl && command.previewUrl.port) {
                    previewUrls.push({ port: command.previewUrl.port, path: command.previewUrl.path });
                }
            }
        }

        const runtimeMachines = workspace.runtime!.machines || {};
        Object.keys(runtimeMachines).forEach((machineName: string) => {
            const attributes = runtimeMachines[machineName].attributes || {};
            let fromPlugin: string;
            if (attributes.plugin) {
                fromPlugin = attributes.plugin;
            }
            const machineServers = runtimeMachines[machineName].servers || {};
            Object.keys(machineServers).forEach((name: string) => {
                const url = machineServers[name].url!;
                let targetPort = parseInt(machineServers[name].attributes!.port!);
                const previewUrl = previewUrls.find(previewUrlData => previewUrlData.port === targetPort);
                const secure = machineServers[name].attributes!.secure!;
                const internal = machineServers[name].attributes!.internal!;
                let protocol;
                if (url) {
                    const tmpURL = new URL(url);
                    protocol = tmpURL.protocol.slice(0, -1);
                } else {
                    protocol = 'N/A';
                }
                const type = machineServers[name].attributes!.type!;

                const secured = 'true' === secure;
                const isInternal = 'true' === internal;
                let exposure;
                if (isInternal) {
                    exposure = EndpointExposure.DEVFILE_PRIVATE;
                } else {
                    exposure = EndpointExposure.DEVFILE_PUBLIC;
                }
                let path;
                if (previewUrl && previewUrl.path) {
                    path = previewUrl.path;
                }
                let category;
                if (fromPlugin) {
                    category = EndpointCategory.PLUGINS;
                } else {
                    category = EndpointCategory.USER;
                }

                const endpoint: Endpoint = {
                    name,
                    exposure,
                    url,
                    secured,
                    targetPort,
                    protocol,
                    path,
                    type,
                    category,
                }
                endpoints.push(endpoint);
            });

        });

        // Add private JWT proxy ports
        const jwtProxyEnv: string[] = Object.keys(process.env).filter(key => key.includes('_JWTPROXY_SERVICE_PORT_SERVER_'));
        jwtProxyEnv.forEach((key, index) => {
            const value = process.env[key]!.toLocaleLowerCase() || '';
            try {
                let port = parseInt(value);
                const endpoint: Endpoint = {
                    name: `jwt-proxy-${index + 1}`,
                    exposure: EndpointExposure.DEVFILE_PRIVATE,
                    url: '',
                    targetPort: port,
                    protocol: 'tcp',
                    type: 'jwt-proxy',
                    category: EndpointCategory.PLUGINS,
                }
                endpoints.push(endpoint);
            } catch (error) {
                console.log(`unable to parse this JWT PROXY service port env: ${key}=${value}`);
            }
        });

        // Theia sidecar remote endpoint
        endpoints.push({
            name: 'theia-sidecar-endpoint',
            exposure: EndpointExposure.DEVFILE_PRIVATE,
            url: '',
            targetPort: 2503,
            protocol: 'tcp',
            type: 'theia-endpoint',
            category: EndpointCategory.PLUGINS,
        });

        // Telemetry
        if (process.env.CHE_WORKSPACE_TELEMETRY_BACKEND_PORT) {
            const telemetryPort = parseInt(process.env.CHE_WORKSPACE_TELEMETRY_BACKEND_PORT);
            endpoints.push({
                name: 'telemetry',
                exposure: EndpointExposure.DEVFILE_PRIVATE,
                url: '',
                targetPort: telemetryPort,
                protocol: 'tcp',
                type: 'telemetry',
                category: EndpointCategory.PLUGINS,
            });
        }

        return endpoints;
    }
}
