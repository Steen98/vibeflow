import { Tool } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../../src/Interface'
import { buildMcpStdioParams, parseExtraArgs } from '../../../../src/vibeflowTools'
import { MCPToolkit } from '../core'

/**
 * Playwright MCP server (https://github.com/microsoft/playwright-mcp).
 * Browser automation actions (navigate, click, type, snapshot, ...) run headless or headed.
 */
class Playwright_MCP implements INode {
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
        this.label = 'Playwright MCP'
        this.name = 'playwrightMCP'
        this.version = 1.0
        this.type = 'Playwright MCP Tool'
        this.icon = 'mcp.svg'
        this.category = 'Tools (MCP)'
        this.description = 'MCP server that drives a real browser (Chromium, Firefox, WebKit or Edge) through Playwright'
        this.documentation = 'https://github.com/microsoft/playwright-mcp'
        this.inputs = [
            {
                label: 'Available Actions',
                name: 'mcpActions',
                type: 'asyncMultiOptions',
                loadMethod: 'listActions',
                refresh: true
            },
            {
                label: 'Browser',
                name: 'playwrightBrowser',
                type: 'options',
                options: [
                    { label: 'Default (Chromium)', name: 'default' },
                    { label: 'Chrome', name: 'chrome' },
                    { label: 'Microsoft Edge', name: 'msedge' },
                    { label: 'Firefox', name: 'firefox' },
                    { label: 'WebKit', name: 'webkit' }
                ],
                default: 'default',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Headless',
                name: 'playwrightHeadless',
                type: 'boolean',
                default: true,
                description: 'Run the browser without a visible window',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Isolated Session',
                name: 'playwrightIsolated',
                type: 'boolean',
                default: false,
                description: 'Use an in-memory profile so the browser state is not persisted',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Extra Arguments',
                name: 'playwrightExtraArgs',
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
                console.error('Error listing Playwright actions:', error)
                return [
                    {
                        label: 'No Available Actions',
                        name: 'error',
                        description: 'Playwright MCP is not available (npx missing, browser not installed, ...). Check the server logs'
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
        const browser = (nodeData.inputs?.playwrightBrowser as string) || 'default'
        const headless = nodeData.inputs?.playwrightHeadless === undefined ? true : Boolean(nodeData.inputs?.playwrightHeadless)
        const isolated = Boolean(nodeData.inputs?.playwrightIsolated)
        const extraArgs = parseExtraArgs(nodeData.inputs?.playwrightExtraArgs)

        const args = ['-y', '@playwright/mcp@latest']
        if (browser && browser !== 'default') args.push(`--browser=${browser}`)
        if (headless) args.push('--headless')
        if (isolated) args.push('--isolated')
        args.push(...extraArgs)

        const serverParams = buildMcpStdioParams('npx', args)

        const toolkit = new MCPToolkit(serverParams, 'stdio')
        await toolkit.initialize()

        const tools = toolkit.tools ?? []
        return tools as Tool[]
    }
}

module.exports = { nodeClass: Playwright_MCP }
