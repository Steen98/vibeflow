import { Tool } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../../src/Interface'
import { buildMcpStdioParams, parseExtraArgs } from '../../../../src/vibeflowTools'
import { MCPToolkit } from '../core'

/**
 * Serena MCP server (https://github.com/oraios/serena).
 * Semantic code retrieval / editing toolkit, run locally with uvx.
 */
class Serena_MCP implements INode {
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
        this.label = 'Serena MCP'
        this.name = 'serenaMCP'
        this.version = 1.0
        this.type = 'Serena MCP Tool'
        this.icon = 'mcp.svg'
        this.category = 'Tools (MCP)'
        this.description = 'MCP server that provides semantic code retrieval and editing actions on a local project'
        this.documentation = 'https://github.com/oraios/serena'
        this.inputs = [
            {
                label: 'Available Actions',
                name: 'mcpActions',
                type: 'asyncMultiOptions',
                loadMethod: 'listActions',
                refresh: true
            },
            {
                label: 'Package',
                name: 'serenaPackage',
                type: 'string',
                default: 'git+https://github.com/oraios/serena',
                description: 'Package passed to uvx with --from',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Context',
                name: 'serenaContext',
                type: 'options',
                options: [
                    { label: 'IDE Assistant', name: 'ide-assistant' },
                    { label: 'Desktop App', name: 'desktop-app' },
                    { label: 'Agent', name: 'agent' },
                    { label: 'Chatbot', name: 'chatbot' }
                ],
                default: 'ide-assistant',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Project Path',
                name: 'serenaProjectPath',
                type: 'string',
                acceptVariable: true,
                description: 'Absolute path of the project Serena should work on (recommended)',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Extra Arguments',
                name: 'serenaExtraArgs',
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
                console.error('Error listing Serena actions:', error)
                return [
                    {
                        label: 'No Available Actions',
                        name: 'error',
                        description: 'Serena is not available (uvx missing, package not installable, ...). Check the server logs'
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
        const serenaPackage = (nodeData.inputs?.serenaPackage as string) || 'git+https://github.com/oraios/serena'
        const context = (nodeData.inputs?.serenaContext as string) || 'ide-assistant'
        const projectPath = (nodeData.inputs?.serenaProjectPath as string) || ''
        const extraArgs = parseExtraArgs(nodeData.inputs?.serenaExtraArgs)

        const args = ['--from', serenaPackage, 'serena-mcp-server', '--context', context]
        if (projectPath && projectPath.trim().length) {
            args.push('--project', projectPath.trim())
        }
        args.push(...extraArgs)

        const serverParams = buildMcpStdioParams('uvx', args)

        const toolkit = new MCPToolkit(serverParams, 'stdio')
        await toolkit.initialize()

        const tools = toolkit.tools ?? []
        return tools as Tool[]
    }
}

module.exports = { nodeClass: Serena_MCP }
