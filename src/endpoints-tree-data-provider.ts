import * as theia from '@theia/plugin';
import { Endpoint, EndpointExposure } from './endpoint';
import { ListeningPort } from './listening-port';

export interface ITreeNodeItem {
    id: string;
    name: string;
    tooltip?: string;
    iconPath?: string;
    parentId?: string;
    command?: {
        id: string;
        arguments?: any[]
    },
    isExpanded?: boolean;
    contextValue?: string;
    endpoint?: Endpoint;
}


export class EndpointsTreeDataProvider implements theia.TreeDataProvider<ITreeNodeItem> {

    private onDidChangeTreeDataEmitter: theia.EventEmitter<undefined>;
    private ids: string[];
    readonly onDidChangeTreeData: theia.Event<undefined>;
    private treeNodeItems: ITreeNodeItem[];

    constructor() {
        this.treeNodeItems = [];
        this.onDidChangeTreeDataEmitter = new theia.EventEmitter<undefined>();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        this.ids = [];
    }


    refresh(endpoints: Endpoint[], openedPorts: ListeningPort[]) {
        this.ids.length = 0;
        this.treeNodeItems.length = 0;

        const publicEndpointsGroup = {
            id: this.getRandId(),
            name: 'Public',
            iconPath: 'fa-cloud',
            tooltip: 'Public endpoints referenced in the devfile',
            isExpanded: true
        };
        const privateEndpointsGroup = {
            id: this.getRandId(),
            iconPath: 'fa-circle',
            name: 'Private',
            tooltip: 'Private endpoints (only available within workspace)',
            isExpanded: true
        };


        // public endpoints are:
        //  - the one defined in the devfile 
        //  - and the current port forwarding
        const publicEndpoints: Endpoint[] = endpoints.filter(endpoint => endpoint.exposure === EndpointExposure.DEVFILE_PUBLIC || endpoint.exposure === EndpointExposure.PORT_FORWARDING);


        publicEndpoints.sort((ep1: Endpoint, ep2: Endpoint) => {
            return ep1.name.localeCompare(ep2.name);
        })

        publicEndpoints.forEach(endpoint => {

            let targetPort = endpoint.targetPort;
            let displayName;
            if (endpoint.exposure === EndpointExposure.PORT_FORWARDING) {
                displayName = endpoint.name;
            } else {
                displayName = `${endpoint.name} (${targetPort}/${endpoint.protocol})`;
            }

            const publicEndpointNode: ITreeNodeItem = {
                id: this.getRandId(),
                name: displayName
            };
            const isOnline = openedPorts.some(listeningPort => listeningPort.portNumber === targetPort);
            if (isOnline) {
                publicEndpointNode.iconPath = 'fa-cloud medium-green';
                publicEndpointNode.tooltip = 'Public Port';
                if (endpoint.url.startsWith('https://')) {
                    publicEndpointNode.contextValue = "publicHttpsEndpointOnline";
                } else {
                    publicEndpointNode.contextValue = "publicPortOnline";
                }
            } else {
                publicEndpointNode.iconPath = 'fa-circle-thin medium-grey';
                publicEndpointNode.tooltip = 'Public Port offline';
                publicEndpointNode.contextValue = "publicDevfilePortOffline";
            }
            publicEndpointNode.parentId = publicEndpointsGroup.id;

            // add endpoint inside the node
            publicEndpointNode.endpoint = endpoint;


            this.treeNodeItems.push(publicEndpointNode);
        });


        const privateEndpoints: Endpoint[] = endpoints.filter(endpoint => (endpoint.exposure === EndpointExposure.DEVFILE_PRIVATE || endpoint.exposure === EndpointExposure.USER));

        // now, add all listening ports not defined in the devfile.
        // not excluded
        // not ephemeral


        privateEndpoints.sort((ep1: Endpoint, ep2: Endpoint) => {
            return ep1.name.localeCompare(ep2.name);
        })
        privateEndpoints.forEach(endpoint => {

            let redirectName = `${endpoint.name} (${endpoint.targetPort}/${endpoint.protocol})`;
            const privateEndpointNode: ITreeNodeItem = {
                id: this.getRandId(),
                name: `${redirectName}`
            };
            const isOnline = openedPorts.some(listeningPort => listeningPort.portNumber === endpoint.targetPort);
            if (isOnline) {
                privateEndpointNode.iconPath = 'fa-circle medium-green';
                privateEndpointNode.tooltip = 'Private Port';
                // user defined ?
                if (endpoint.exposure === EndpointExposure.USER) {
                    privateEndpointNode.contextValue = "privateUserPortOnline";
                } else {
                    privateEndpointNode.contextValue = "privateDevfilePortOnline";
                }
            } else {
                privateEndpointNode.iconPath = 'fa-circle-thin medium-grey';
                privateEndpointNode.tooltip = 'Private Port offline';
                privateEndpointNode.contextValue = "privateDevfilePortOffline";
            }
            privateEndpointNode.parentId = privateEndpointsGroup.id;

            // add endpoint inside the node
            privateEndpointNode.endpoint = endpoint;


            this.treeNodeItems.push(privateEndpointNode);
        });

        if (publicEndpoints.length > 0) {
            this.treeNodeItems.push(publicEndpointsGroup);
        }

        if (privateEndpoints.length > 0) {
            this.treeNodeItems.push(privateEndpointsGroup);
        }

        this.onDidChangeTreeDataEmitter.fire();
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
        if (element.contextValue) {
            treeItem.contextValue = element.contextValue;
        }
        return treeItem;
    }

    dispose(): void {
        this.onDidChangeTreeDataEmitter.dispose();
    }

}

