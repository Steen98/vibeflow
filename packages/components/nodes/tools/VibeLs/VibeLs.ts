import { DynamicStructuredTool } from '@langchain/core/tools'
import { existsSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { z } from 'zod/v3'
import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { getWorkspaceRoot, relativeToWorkspace, resolveInsideWorkspace, sanitizeToolName, toErrorMessage } from '../../../src/vibeflowTools'

const DEFAULT_NAME = 'ls'
const DEFAULT_DESCRIPTION =
    'List the content of a directory (files and sub-directories). Supports the classic flavours: simple list, long format with size and modification date and permissions, hidden files, and human readable sizes.'

const humanSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }
    return `${value.toFixed(1)}${units[unitIndex]}`
}

const permissionString = (mode: number): string => {
    const flags = ['r', 'w', 'x']
    let result = ''
    for (let shift = 8; shift >= 0; shift--) {
        result += mode & (1 << shift) ? flags[(8 - shift) % 3] : '-'
    }
    return result
}

class VibeLs_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'LS'
        this.name = 'vibeLs'
        this.version = 1.0
        this.type = 'VibeFlow List'
        this.icon = 'vibeflow.svg'
        this.category = 'Tools'
        this.description = 'List files and sub-directories of a folder (supports -l, -a, -lh, recursive)'
        this.baseClasses = [this.type, ...getBaseClasses(DynamicStructuredTool), 'Tool']
        this.inputs = [
            {
                label: 'Default Format',
                name: 'vibeLsDefaultFormat',
                type: 'options',
                options: [
                    { label: 'Simple (ls)', name: 'simple' },
                    { label: 'Long (ls -l)', name: 'long' },
                    { label: 'Human readable (ls -lh)', name: 'human' },
                    { label: 'All files (ls -a)', name: 'all' }
                ],
                default: 'simple',
                description: 'Default rendering when the model does not specify flags',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Excluded Directories',
                name: 'vibeLsExcludedDirs',
                type: 'string',
                default: 'node_modules,.git,dist,build,.next,.turbo,coverage',
                description: 'Comma separated list of directories skipped in recursive mode',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Working Directory',
                name: 'vibeWorkspaceRoot',
                type: 'string',
                acceptVariable: true,
                description: 'Absolute path of the workspace root. Defaults to VIBEFLOW_WORKSPACE_ROOT or the server working directory',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Name',
                name: 'vibeLsToolName',
                type: 'string',
                default: DEFAULT_NAME,
                description: 'Name of the tool',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'vibeLsToolDescription',
                type: 'string',
                rows: 4,
                default: DEFAULT_DESCRIPTION,
                description: 'Describe to LLM when it should use this tool',
                additionalParams: true,
                optional: true
            }
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const defaultFormat = (nodeData.inputs?.vibeLsDefaultFormat as string) || 'simple'
        const excludedDirs = ((nodeData.inputs?.vibeLsExcludedDirs as string) || 'node_modules,.git,dist,build')
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        const workspaceRoot = (nodeData.inputs?.vibeWorkspaceRoot as string) || undefined
        const name = sanitizeToolName((nodeData.inputs?.vibeLsToolName as string) || DEFAULT_NAME, DEFAULT_NAME)
        const description = (nodeData.inputs?.vibeLsToolDescription as string) || DEFAULT_DESCRIPTION

        return new DynamicStructuredTool({
            name,
            description: `${description} Workspace root: ${getWorkspaceRoot(workspaceRoot)}.`,
            schema: z.object({
                path: z.string().optional().describe('Directory to list, relative to the workspace root (default ".")'),
                long: z.boolean().optional().describe('Long format: size, modification date and permissions'),
                all: z.boolean().optional().describe('Include hidden entries (starting with a dot)'),
                humanReadable: z.boolean().optional().describe('Human readable sizes (e.g. 2.1MB instead of 2147483648)'),
                recursive: z.boolean().optional().describe('List sub-directories recursively'),
                depth: z.number().optional().describe('Maximum recursion depth (default 3)')
            }),
            func: async ({ path: requestedPath, long, all, humanReadable, recursive, depth }: any) => {
                try {
                    const target = resolveInsideWorkspace(requestedPath || '.', workspaceRoot)
                    if (!existsSync(target)) return `[ls error] directory not found: ${requestedPath || '.'}`

                    const useLong = long === true || (!long && !recursive && ['long', 'human'].includes(defaultFormat))
                    const readable = humanReadable === true || (humanReadable === undefined && defaultFormat === 'human')
                    const showHidden = all === true || defaultFormat === 'all'
                    const maxDepth = recursive ? Number(depth) || 3 : 0

                    const lines: string[] = [`${relativeToWorkspace(target, workspaceRoot)}:`]

                    const walk = (directory: string, currentDepth: number): void => {
                        const entries = readdirSync(directory, { withFileTypes: true })
                            .filter((entry) => showHidden || !entry.name.startsWith('.'))
                            .filter((entry) => !(currentDepth < maxDepth && excludedDirs.includes(entry.name)))
                            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))

                        for (const entry of entries) {
                            const fullPath = path.join(directory, entry.name)
                            const relative = relativeToWorkspace(fullPath, workspaceRoot)
                            if (useLong) {
                                const stats = statSync(fullPath)
                                const size = readable ? humanSize(stats.size) : `${stats.size}`
                                const permissions = `${permissionString(stats.mode)} (${(stats.mode & 0o777).toString(8)})`
                                const modified = stats.mtime.toISOString()
                                lines.push(
                                    `${entry.isDirectory() ? 'd' : '-'} ${permissions} ${size.padStart(9)} ${modified} ${relative}${
                                        entry.isDirectory() ? '/' : ''
                                    }`
                                )
                            } else {
                                lines.push(`${relative}${entry.isDirectory() ? '/' : ''}`)
                            }
                            if (entry.isDirectory() && currentDepth < maxDepth) {
                                walk(fullPath, currentDepth + 1)
                            }
                        }
                    }

                    walk(target, 0)

                    if (lines.length === 1) lines.push('(empty directory)')
                    return lines.join('\n')
                } catch (error) {
                    return `[ls error] ${toErrorMessage(error)}`
                }
            }
        })
    }
}

module.exports = { nodeClass: VibeLs_Tools }
