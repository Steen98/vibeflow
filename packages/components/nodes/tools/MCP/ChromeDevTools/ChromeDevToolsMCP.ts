import { Tool } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../../src/Interface'
import { buildMcpStdioParams, parseExtraArgs } from '../../../../src/vibeflowTools'
import { MCPToolkit } from '../core'

/**
 * Chrome DevTools MCP server (https://github.com/ChromeDevTools/chrome-devtools-mcp).
 * Inspect, profile and debug a live Chrome instance (performance traces, network, console, ...).
 */
class ChromeDevTools_MCP implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    documentation: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'Chrome DevTools MCP'
        this.name = 'chromeDevToolsMCP'
        this.version = 1.0
        this.type = 'Chrome DevTools MCP Tool'
        this.icon = 'mcp.svg'
        this.category = 'Tools (MCP)'
        this.description = 'MCP server that controls and inspects Chrome DevTools (performance, network, console, screenshots)'
        this.documentation = 'https://github.com/ChromeDevTools/chrome-devtools-mcp'
        this.inputs = [
            {
                label: 'Available Actions',
                name: 'mcpActions',
                type: 'asyncMultiOptions',
                loadMethod: 'listActions',
                refresh: true
            },
            {
                label: 'Headless',
                name: 'chromeDevToolsHeadless',
                type: 'boolean',
                default: false,
                description: 'Launch Chrome without a visible window',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Browser URL',
                name: 'chromeDevToolsBrowserUrl',
                type: 'string',
                description: 'Connect to an already running Chrome instance (e.g. http://127.0.0.1:9222)',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Isolated Session',
                name: 'chromeDevToolsIsolated',
                type: 'boolean',
                default: false,
                description: 'Use a temporary user data directory',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Extra Arguments',
                name: 'chromeDevToolsExtraArgs',
                type: 'string',
                description: 'Additional CLI arguments, space separated',
                additionalParams: true,
                optional: true
            }
        ]
        this.baseClasses = ['Tool']
    }

    //@ts-ignore
    loadMethods = {
        listActions: async (nodeData: INodeData, options: ICommonObject): Promise<INodeOptionsValue[]> => {
            try {
                const toolset = await this.getTools(nodeData, options)
                toolset.sort((a: any, b: any) => a.name.localeCompare(b.name))

                return toolset.map(({ name, ...rest }) => ({
                    label: name.toUpperCase(),
                    name: name,
                    description: rest.description || name
                }))
            } catch (error) {
                console.error('Error listing Chrome DevTools actions:', error)
                return [
                    {
                        label: 'No Available Actions',
                        name: 'error',
                        description: 'Chrome DevTools MCP is not available (npx missing, Chrome not installed, ...). Check the server logs'
                    }
                ]
            }
        }
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const tools = await this.getTools(nodeData, options)

        const _mcpActions = nodeData.inputs?.mcpActions
        let mcpActions = []
        if (_mcpActions) {
            try {
                mcpActions = typeof _mcpActions === 'string' ? JSON.parse(_mcpActions) : _mcpActions
            } catch (error) {
                console.error('Error parsing mcp actions:', error)
            }
        }

        if (!mcpActions || !mcpActions.length) return tools
        return tools.filter((tool: any) => mcpActions.includes(tool.name))
    }

    async getTools(nodeData: INodeData, _options: ICommonObject): Promise<Tool[]> {
        const headless = Boolean(nodeData.inputs?.chromeDevToolsHeadless)
        const browserUrl = (nodeData.inputs?.chromeDevToolsBrowserUrl as string) || ''
        const isolated = Boolean(nodeData.inputs?.chromeDevToolsIsolated)
        const extraArgs = parseExtraArgs(nodeData.inputs?.chromeDevToolsExtraArgs)

        const args = ['-y', 'chrome-devtools-mcp@latest']
        if (headless) args.push('--headless')
        if (browserUrl && browserUrl.trim().length) args.push(`--browser-url=${browserUrl.trim()}`)
        if (isolated) args.push('--isolated')
        args.push(...extraArgs)

        const serverParams = buildMcpStdioParams('npx', args)

        const toolkit = new MCPToolkit(serverParams, 'stdio')
        await toolkit.initialize()

        const tools = toolkit.tools ?? []
        return tools as Tool[]
    }
}

module.exports = { nodeClass: ChromeDevTools_MCP }
