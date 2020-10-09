/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as theia from '@theia/plugin';
import { PortChangesDetector } from './port-changes-detector';
import { ListeningPort } from './listening-port';
import { PortRedirectListener } from './port-redirect-listener';
import { EndpointsTreeDataProvider, ITreeNodeItem } from './endpoints-tree-data-provider';
import { Endpoint, EndpointExposure, EndpointCategory } from './endpoint';
import { CheServerDevfileHandlerImpl } from './devfile-handler-che-server-impl';
import { DevfileHandler } from './devfile-handler';

/**
 * Plugin that is monitoring new port being opened and closed.
 * Check README file for more details
 * @author Florent Benoit
 */


// map a listener and the endpoint port used
export interface ForwardedPort {

    portRedirectListener: PortRedirectListener;

    endpoint: Endpoint;

}

export interface MessageItem {
    title: string;
}

export class PortsPlugin {

    // constants
    public static readonly LISTEN_ALL_IPV4 = '0.0.0.0';
    public static readonly LISTEN_ALL_IPV6 = '::';
    public static readonly SERVER_REDIRECT_PATTERN = 'theia-redirect-';
    public static readonly PORT_EXCLUDE_ENV_VAR_PREFIX: string = 'PORT_PLUGIN_EXCLUDE_';

    private devfileHandler: DevfileHandler;
    private devfileEndpoints: Endpoint[];
    private currentEndpoints: Endpoint[];
    private redirectPorts: Endpoint[];
    private redirectListeners: Map<number, ForwardedPort>;
    private excludedPorts: number[];
    private outputChannel: theia.OutputChannel;
    private endpointsTreeDataProvider: EndpointsTreeDataProvider;
    private portChangesDetector: PortChangesDetector;
    private showPluginEndpoints: boolean;

    constructor(private context: theia.PluginContext) {
        this.devfileEndpoints = [];
        this.currentEndpoints = [];
        this.redirectPorts = [];
        this.showPluginEndpoints = false;
        this.devfileHandler = new CheServerDevfileHandlerImpl();
        this.redirectListeners = new Map();
        this.excludedPorts = [];
        this.endpointsTreeDataProvider = new EndpointsTreeDataProvider();
        this.portChangesDetector = new PortChangesDetector();
        this.outputChannel = theia.window.createOutputChannel('Ports Plug-in');

    }
    /**
     * Prompt user to create a port redirect for the specific port
     * @param port the port that needs to be redirected
     * @param redirectMessage the message if there are 'free ports' in workspace
     * @param errorMessage  if no free port are available
     */
    async askRedirect(port: ListeningPort, redirectMessage: string, errorMessage: string): Promise<void> {

        // grab a free redirect
        if (this.redirectPorts.length === 0) {
            await theia.window.showErrorMessage(errorMessage, { modal: true });
            return;
        }

        const interactions: MessageItem[] = [{ title: 'yes' }, { title: 'no' }];
        const result = await theia.window.showInformationMessage(redirectMessage, ...interactions);
        if (result && result.title === 'yes') {
            // takes first available port
            const endpoint = this.redirectPorts.pop()!;

            // start a new listener
            const portRedirectListener = new PortRedirectListener(endpoint.targetPort, 'localhost', port.portNumber);
            portRedirectListener.start();

            // store port taken
            const forwardedPort = { portRedirectListener, endpoint };
            this.redirectListeners.set(port.portNumber, forwardedPort);
            this.updateEndpoints();

            // show redirect
            const redirectInteractions: MessageItem[] = [{ title: 'Open In New Tab' }];
            if (endpoint.protocol === 'https') {
                redirectInteractions.push({ title: 'Open In Preview' });
            }
            const msg = `Redirect is now enabled on port ${port.portNumber}.`;
            const resultShow = await theia.window.showInformationMessage(msg, ...redirectInteractions);
            if (resultShow && resultShow.title === 'Open In New Tab') {
                theia.commands.executeCommand('theia.open', endpoint.url);
            } else if (resultShow && resultShow.title === 'Open In Preview') {
                theia.commands.executeCommand('mini-browser.openUrl', endpoint.url);
            }
        }
    }

    async updateEndpoints(): Promise<void> {

        // first, start with current devfile endpoints (copying them)
        this.currentEndpoints = [...this.devfileEndpoints];

        // Add new forwarded endpoint on matching devfile
        // override public endpoint that are redirect with a Port Forward name
        this.currentEndpoints.filter(endpoint => endpoint.exposure === EndpointExposure.DEVFILE_PUBLIC).forEach(publicEndpoint => {
            Array.from(this.redirectListeners.keys()).forEach(redirectPort => {
                const forwardedPort = this.redirectListeners.get(redirectPort);
                if (forwardedPort && forwardedPort.endpoint.targetPort === publicEndpoint.targetPort) {
                    const portForwardEndpoint = { ...publicEndpoint };
                    portForwardEndpoint.name = `user-port-forward (${redirectPort})`;
                    portForwardEndpoint.exposure = EndpointExposure.PORT_FORWARDING;
                    portForwardEndpoint.targetPort = redirectPort;
                    portForwardEndpoint.category = EndpointCategory.USER;
                    this.currentEndpoints.push(portForwardEndpoint)
                }
            })
        });

        // and then, we need to add all ports not defined in the devfile
        const listeningPorts = this.portChangesDetector.getOpenedPorts();
        listeningPorts.forEach(listeningPort => {
            const existInDevfile = this.currentEndpoints.some(endpoint => endpoint.targetPort === listeningPort.portNumber);
            if (!existInDevfile) {
                // need to add it as a custom user endpoint
                const endpoint: Endpoint = {
                    name: 'user',
                    exposure: EndpointExposure.USER,
                    url: 'N/A',
                    protocol: 'unknown',
                    targetPort: listeningPort.portNumber,
                    category: EndpointCategory.USER
                }
                this.currentEndpoints.push(endpoint);
            }
        })

        if (!this.showPluginEndpoints) {
            this.currentEndpoints = this.currentEndpoints.filter(endpoint => endpoint.category === EndpointCategory.USER);
        }

        // refresh the tree data provider
        this.endpointsTreeDataProvider.refresh(this.currentEndpoints, listeningPorts);
    }


    // Callback when a new port is being opened in workspace
    async onOpenPort(port: ListeningPort): Promise<void> {
        this.updateEndpoints();

        // skip excluded
        if (this.excludedPorts.includes(port.portNumber)) {
            // this port is excluded so just print a notice but does not propose a redirect
            this.outputChannel.appendLine(`Ignoring excluded port ${port.portNumber}`);
            return;
        }

        // handle ephemeral ports
        if (port.portNumber >= 32000) {
            // this port is ephemeral so just print a notice but does not propose a redirect
            this.outputChannel.appendLine(`Ephemeral port now listening on port ${port.portNumber} (port range >= 32000). No redirect proposed for ephemerals.`);
            return;
        }

        // if not listening on 0.0.0.0 then raise a prompt to add a port redirect
        if (port.interfaceListen !== PortsPlugin.LISTEN_ALL_IPV4 && port.interfaceListen !== PortsPlugin.LISTEN_ALL_IPV6) {
            const desc = `A new process is now listening on port ${port.portNumber} but is listening on interface ${port.interfaceListen} which is internal.
        You should change to be remotely available. Would you want to add a redirect for this port so it becomes available ?`;
            const err = `A new process is now listening on port ${port.portNumber} but is listening on interface ${port.interfaceListen} which is internal.
        This port is not available outside. You should change the code to listen on 0.0.0.0 for example.`;
            await this.askRedirect(port, desc, err);
            return;
        }

        // check now if the port is in workspace definition ?
        const matchingEndpoint = this.devfileEndpoints.find(endpoint => endpoint.targetPort === port.portNumber);

        // if there, show prompt
        if (matchingEndpoint) {

            // internal stuff, no need to display anything
            if (matchingEndpoint.name.startsWith(PortsPlugin.SERVER_REDIRECT_PATTERN)) {
                return;
            }

            // check if endpoint has preview url, and if so do not show dialog to avoid duplication with task plugin
            if (matchingEndpoint.path) {
                return;
            }

            //

            const interactions: MessageItem[] = [{ title: 'Open In New Tab' }];
            if (matchingEndpoint.protocol === 'https') {
                interactions.push({ title: 'Open In Preview' });
            }

            const msg = `Process ${matchingEndpoint.name} is now listening on port ${matchingEndpoint.targetPort}. Open it ?`;
            const result = await theia.window.showInformationMessage(msg, {}, ...interactions);
            if (result && result.title === 'Open In New Tab') {
                theia.commands.executeCommand('theia.open', matchingEndpoint.url);
            } else if (result && result.title === 'Open In Preview') {
                theia.commands.executeCommand('mini-browser.openUrl', matchingEndpoint.url);
            }
        } else {
            const desc = `A new process is now listening on port ${port.portNumber} but this port is not a current endpoint.
         Would you want to add a redirect for this port so it becomes available ?`;
            const err = `A new process is now listening on port ${port.portNumber} but this port is not exposed in the workspace as a server.
         You should add a new server with this port in order to access it`;
            await this.askRedirect(port, desc, err);
        }
        console.info(`The port ${port.portNumber} is now listening on interface ${port.interfaceListen}`);
    }

    async freeRedirectPort(portNumber: number): Promise<void> {

        // stop the redirect
        const forwardedPort = this.redirectListeners.get(portNumber)!;
        forwardedPort.portRedirectListener.stop();

        // free up the redirect endpoint
        this.redirectPorts.push(forwardedPort.endpoint);

        // remove entry
        this.redirectListeners.delete(portNumber);
    }

    onClosedPort(port: ListeningPort): void {

        // free redirect listener if there is one
        const portNumber = port.portNumber;
        if (this.redirectListeners.has(portNumber)) {
            this.freeRedirectPort(portNumber);
        }
        this.updateEndpoints();

        // just log trace
        console.info(`The port ${port.portNumber} is no longer listening on interface ${port.interfaceListen}`);
    }


    async registerCommands(): Promise<void> {
        // register commands
        const openTab = theia.commands.registerCommand('portPlugin.openNewTabPort', (node: ITreeNodeItem) => {
            if (node.endpoint && node.endpoint.url) {
                theia.commands.executeCommand('theia.open', node.endpoint.url);
            }
        });
        const previewCommand = theia.commands.registerCommand('portPlugin.preview', (node: ITreeNodeItem) => {
            if (node.endpoint && node.endpoint.url) {
                theia.commands.executeCommand('mini-browser.openUrl', node.endpoint.url);
            }
        });

        this.context.subscriptions.push(openTab, previewCommand);
    }

    async start(): Promise<void> {

        this.registerCommands();

        // default mode
        await theia.commands.executeCommand('setContext', 'portPluginShowPlugins', this.showPluginEndpoints);

        // initiate excluded ports
        const excludedPortProperties: string[] = Object.keys(process.env).filter(key => key.startsWith(PortsPlugin.PORT_EXCLUDE_ENV_VAR_PREFIX));
        excludedPortProperties.forEach(key => {
            const value = process.env[key]!.toLocaleLowerCase() || '';
            if (value !== 'no' && value !== 'false') {
                this.excludedPorts.push(parseInt(key.substring(PortsPlugin.PORT_EXCLUDE_ENV_VAR_PREFIX.length)));
            }
        });

        // first, grab ports of workspace
        this.devfileHandler = new CheServerDevfileHandlerImpl();
        this.devfileEndpoints = await this.devfileHandler.getEndpoints();


        this.redirectPorts = this.devfileEndpoints.filter(endpoint => endpoint.name.startsWith(PortsPlugin.SERVER_REDIRECT_PATTERN));

        this.portChangesDetector.onDidOpenPort(async (port) => {
            return this.onOpenPort(port)
        });
        this.portChangesDetector.onDidClosePort(async (port) => {
            return this.onClosedPort(port)
        });

        // start port changes
        await this.portChangesDetector.init();
        this.portChangesDetector.check();

        // custom view
        const endpointsTreeDataProviderDisposable = theia.Disposable.create(() => {
            this.endpointsTreeDataProvider.dispose();
        });
        this.context.subscriptions.push(endpointsTreeDataProviderDisposable);
        const treeView = theia.window.createTreeView('endpoints', { treeDataProvider: this.endpointsTreeDataProvider });

        this.updateEndpoints();


        theia.commands.registerCommand('portPlugin.filterInPlugins', async (node: ITreeNodeItem) => {
            treeView.title = 'W/ plugins';
            this.showPluginEndpoints = true;
            this.updateContext();
        });
        theia.commands.registerCommand('portPlugin.filterOutPlugins', async (node: ITreeNodeItem) => {
            treeView.title = 'W/O plugins';
            this.showPluginEndpoints = false;
            this.updateContext();
        });
    }

    async updateContext(): Promise<void> {
        await theia.commands.executeCommand('setContext', 'portPluginShowPlugins', this.showPluginEndpoints);
        this.updateEndpoints();
    }


    async stop(): Promise<void> {

    }

}
