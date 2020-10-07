import * as theia from '@theia/plugin';
import { WorkspacePort } from './workspace-port';
import { PortChangesDetector } from './port-changes-detector';
import { BusyPort } from './ports-plugin';
import { Port } from './port';

interface ITreeNodeItem {
    id: string;
    name: string;
    tooltip: string;
    iconPath?: string;
    parentId?: string;
    command?: {
        id: string;
        arguments?: any[]
    },
    isExpanded?: boolean;
}

export class EndpointsTreeDataProvider implements theia.TreeDataProvider<ITreeNodeItem> {

    private static readonly LISTEN_ALL_IPV4 = '0.0.0.0';
    private static readonly LISTEN_ALL_IPV6 = '::';
    private static readonly SERVER_REDIRECT_PATTERN = 'theia-redirect-';
    private static readonly PORT_PLUGIN_CANCEL_PORT_FORWARDING_COMMAND_ID = 'port-plugin-cancel-port-forwarding-command-id';

    private onDidChangeTreeDataEmitter: theia.EventEmitter<undefined>;
    private ids: string[];


    readonly onDidChangeTreeData: theia.Event<undefined>;

    private treeNodeItems: ITreeNodeItem[];

    constructor(private portChangesDetector: PortChangesDetector, private workspacePorts: WorkspacePort[], private redirectListeners: Map<number, BusyPort>, private freeRedirectPort: (portNumber: number) => void) {
        this.treeNodeItems = [];
        this.onDidChangeTreeDataEmitter = new theia.EventEmitter<undefined>();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        this.ids = [];
        this.init();
    }

    init() {
        const  handler = async (portNumber: number): Promise<void> => {
            this.freeRedirectPort(portNumber);
        }
        theia.commands.registerCommand(EndpointsTreeDataProvider.PORT_PLUGIN_CANCEL_PORT_FORWARDING_COMMAND_ID, handler);
    }

    refresh() {
        this.ids.length = 0;
        this.treeNodeItems.length = 0;
        theia.window.showInformationMessage('Refreshing the ports...');

        // create top level groups
        const endpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-plug',
            name: 'Endpoints',
            tooltip: 'Available Endpoints',
            isExpanded: true
        };

        const publicEndpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-cloud',
            name: 'Ports listening and remotely available',
            tooltip: 'Remotely available',
            parentId: endpointsGroup.id,
            isExpanded: true
        };
        const privateEndpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-circle',
            name: 'Ports listening but private',
            parentId: endpointsGroup.id,
            tooltip: 'Available locally',
            isExpanded: true
        };
        const offlineEndpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-circle-thin',
            name: 'offline',
            parentId: endpointsGroup.id,
            tooltip: 'Declared in devfile but not listening',
            isExpanded: true
        };

        this.treeNodeItems.push(endpointsGroup);
        this.treeNodeItems.push(publicEndpointsGroup);
        this.treeNodeItems.push(privateEndpointsGroup);
        this.treeNodeItems.push(offlineEndpointsGroup);


        // ok now handle public listening ports
        const openedPorts = this.portChangesDetector.getOpenedPorts();

        // public port need to listen on all interfaces + be declared in workspace port
        let publicPorts = openedPorts.filter(port => ((port.interfaceListen === EndpointsTreeDataProvider.LISTEN_ALL_IPV4 || port.interfaceListen === EndpointsTreeDataProvider.LISTEN_ALL_IPV6) || (this.workspacePorts.some(workspacePort => workspacePort.isSecured && workspacePort.portNumber === `${port.portNumber}`))) );
        publicPorts = publicPorts.filter(port => this.workspacePorts.some(workspacePort => (workspacePort.portNumber === `${port.portNumber}`)));

        publicPorts.sort((a: Port, b: Port) => {
            return a.portNumber - b.portNumber
        })
        publicPorts.forEach(port => {

            let portListening = port.portNumber;
            let redirectName;
            Array.from(this.redirectListeners.keys()).forEach(redirectPort => {
                const busyPort = this.redirectListeners.get(redirectPort);
                if (busyPort && busyPort.workspacePort.portNumber === port.portNumber.toString()) {
                    theia.window.showInformationMessage('found redirect port' + redirectPort);
                    portListening = redirectPort;
                    redirectName = `User Port Forwarding(${redirectPort}->${busyPort.workspacePort.portNumber})`
                }
            })

            const portListeningNode: ITreeNodeItem = {
                id: this.getRandId(),
                name: `Port ${portListening}`,
                tooltip: 'Port listening '
            };
            portListeningNode.iconPath = 'fa-cloud medium-green';
            portListeningNode.tooltip = 'This port is listening and is available remotely';
            portListeningNode.parentId = publicEndpointsGroup.id;
            this.treeNodeItems.push(portListeningNode);

            let needExpand = false;
            
            // links ?
            const foundWorkspacePort = this.workspacePorts.find(workspacePort => workspacePort.portNumber === `${port.portNumber}`);
            if (foundWorkspacePort && foundWorkspacePort.url.startsWith('http')) {
                needExpand = true;

                let serverName;
                if (redirectName) {
                    serverName = redirectName;
                } else {
                    serverName = foundWorkspacePort.serverName;
                }
                const openNewTabNode: ITreeNodeItem = {
                    id: this.getRandId(),
                    parentId: portListeningNode.id,
                    name: `${serverName} (new tab)`,
                    iconPath: 'fa-external-link medium-blue',
                    command: { id: 'theia.open', arguments: [foundWorkspacePort.url] },
                    tooltip: 'open in a new tab'
                };
                this.treeNodeItems.push(openNewTabNode);

                const openPreviewTabNode: ITreeNodeItem = {
                    id: this.getRandId(),
                    parentId: portListeningNode.id,
                    name: `${serverName} (preview)`,
                    iconPath: 'fa-eye medium-blue',
                    command: { id: 'theia.open', arguments: [foundWorkspacePort.url] },
                    tooltip: 'open in preview  '
                };
                this.treeNodeItems.push(openPreviewTabNode);
            
                if (redirectName) {
                    const cancelPortForwardingNode: ITreeNodeItem = {
                    id: this.getRandId(),
                    parentId: portListeningNode.id,
                    name: `Cancel port forwarding`,
                    iconPath: 'fa-stop-circle-o medium-red',
                    command: { id: EndpointsTreeDataProvider.PORT_PLUGIN_CANCEL_PORT_FORWARDING_COMMAND_ID, arguments: [portListening] },
                    tooltip: 'Cancel redirect (make port private again)'
                };
                this.treeNodeItems.push(cancelPortForwardingNode);
            }
            }
            if (needExpand) {
                portListeningNode.isExpanded = true;
            } else {
                portListeningNode.name = `${portListeningNode.name} (no http endpoints)`
            }


        });


        // workspace port is inside 
        let offlinePorts = this.workspacePorts.filter(workspacePort => !openedPorts.some(openedPort => (openedPort.portNumber.toString() === workspacePort.portNumber)));
        // exclude redirect ports
        offlinePorts = offlinePorts.filter(workspacePort => !workspacePort.serverName.startsWith(EndpointsTreeDataProvider.SERVER_REDIRECT_PATTERN));
        
        // sort
        offlinePorts.sort((a: WorkspacePort, b: WorkspacePort)=> {
            return parseInt(a.portNumber) - parseInt(b.portNumber);
        })
        
        offlinePorts.forEach(offlinePort => {

        const portNotListeningButDeclaredNode: ITreeNodeItem = {
            id: this.getRandId(),
            name: `Port ${offlinePort.portNumber} (${offlinePort.serverName})`,
            iconPath: 'fa-circle-thin medium-grey',
        tooltip : 'This port is declared as public but it is not yet listening',
        parentId : offlineEndpointsGroup.id}

        this.treeNodeItems.push(portNotListeningButDeclaredNode);
        
    });
    this.onDidChangeTreeDataEmitter.fire();
    }


    update() {


        // create top level groups
        const endpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-plug',
            name: 'Endpoints',
            tooltip: 'Available Endpoints',
            isExpanded: true
        };
        const publicEndpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-cloud',
            name: 'Ports listening and remotely available',
            tooltip: 'Remotely available',
            parentId: endpointsGroup.id,
            isExpanded: true
        };
        const privateEndpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-circle',
            name: 'Ports listening but private',
            parentId: endpointsGroup.id,
            tooltip: 'Available locally',
            isExpanded: true
        };
        const offlineEndpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-circle-thin',
            name: 'offline (declared in devfile but not listening)',
            parentId: endpointsGroup.id,
            tooltip: 'Declared but not listening',
            isExpanded: true
        };




        const portListeningNode: ITreeNodeItem = {
            id: this.getRandId(),
            name: 'Port 3100',
            tooltip: 'container name'
        };
        portListeningNode.iconPath = 'fa-cloud medium-green';
        portListeningNode.tooltip = 'container is STARTING';

        portListeningNode.tooltip = 'This port is listening and is available remotely';
        portListeningNode.parentId = publicEndpointsGroup.id;
        portListeningNode.isExpanded = true;

        // add links
        const openNewTabNode: ITreeNodeItem = {
            id: this.getRandId(),
            parentId: portListeningNode.id,
            name: 'Theia',
            iconPath: 'fa-external-link medium-blue',
            command: { id: 'theia.open', arguments: ['https://www.google.fr'] },
            tooltip: 'open in a new tab  '
        };

        this.treeNodeItems.push(openNewTabNode);
        const openPreviewTabNode: ITreeNodeItem = {
            id: this.getRandId(),
            parentId: portListeningNode.id,
            name: 'Theia (preview)',
            iconPath: 'fa-eye medium-blue',
            command: { id: 'theia.open', arguments: ['https://www.google.fr?open-handler=code-editor-preview'] },
            tooltip: 'open in preview  '
        };
        this.treeNodeItems.push(openPreviewTabNode);

        this.treeNodeItems.push(portListeningNode);


        this.treeNodeItems.push(endpointsGroup);


        const portListeningPrivateNode: ITreeNodeItem = {
            id: this.getRandId(),
            name: 'Port 3200',
            tooltip: 'container name'
        };
        portListeningPrivateNode.iconPath = 'fa-circle medium-green';
        portListeningPrivateNode.tooltip = 'This port is listening but is not available remotely';
        portListeningPrivateNode.parentId = privateEndpointsGroup.id;
        portListeningPrivateNode.isExpanded = true;
        this.treeNodeItems.push(portListeningPrivateNode);
        const makeItPublicNode: ITreeNodeItem = {
            id: this.getRandId(),
            parentId: portListeningPrivateNode.id,
            name: 'Make it public 🌐',
            iconPath: 'fa-cloud medium-blue',
            tooltip: 'Make this port available remotely',
        };
        this.treeNodeItems.push(makeItPublicNode);

        const portNotListeningButDeclaredNode: ITreeNodeItem = {
            id: this.getRandId(),
            name: 'Port 3300',
            tooltip: 'container name'
        };
        portNotListeningButDeclaredNode.iconPath = 'fa-circle-thin medium-grey';
        portNotListeningButDeclaredNode.tooltip = 'This port is declared as public but it is not yet listening';
        portNotListeningButDeclaredNode.parentId = offlineEndpointsGroup.id;
        this.treeNodeItems.push(portNotListeningButDeclaredNode);
    }


    private getRandId(): string {
        let uniqueId = '';
        for (let counter = 0; counter < 1000; counter++) {
            uniqueId = `${('0000' + (Math.random() * Math.pow(36, 4) << 0).toString(36)).slice(-4)}`;
            if (this.ids.findIndex(id => id === uniqueId) === -1) {
                break;
            }
        }
        this.ids.push(uniqueId);
        return uniqueId;
    }


    getChildren(element?: ITreeNodeItem | undefined): theia.ProviderResult<ITreeNodeItem[]> {
        console.log('asked to get all children');
        if (element) {
            return this.treeNodeItems.filter(item => item.parentId === element.id);
        } else {
            return this.treeNodeItems.filter(item => item.parentId === undefined);
        }
    }

    getTreeItem(element: ITreeNodeItem): theia.TreeItem {
        const treeItem: theia.TreeItem = {
            label: element.name,
            tooltip: element.tooltip
        };
        if (element.isExpanded === true) {
            treeItem.collapsibleState = theia.TreeItemCollapsibleState.Expanded;
        } else if (element.isExpanded === false) {
            treeItem.collapsibleState = theia.TreeItemCollapsibleState.Collapsed;
        } else {
            treeItem.collapsibleState = theia.TreeItemCollapsibleState.None;
        }
        if (element.iconPath) {
            treeItem.iconPath = element.iconPath;
        }
        if (element.command) {
            treeItem.command = element.command;
        }
        return treeItem;
    }

    dispose(): void {
        this.onDidChangeTreeDataEmitter.dispose();
    }

}

