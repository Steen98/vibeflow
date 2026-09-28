import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import {
    formatCommandResult,
    GIT_ALLOWED_SUBCOMMANDS,
    GIT_BLOCKED_SUBCOMMANDS,
    getWorkspaceRoot,
    runGitCommand,
    sanitizeToolName,
    toErrorMessage
} from '../../../src/vibeflowTools'

const DEFAULT_NAME = 'git'
const DEFAULT_DESCRIPTION = `Manage a local git repository. Allowed subcommands: ${GIT_ALLOWED_SUBCOMMANDS.join(
    ', '
)}. Permanently disabled: ${GIT_BLOCKED_SUBCOMMANDS.join(', ')}.`

class VibeGit_Tools implements INode {
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
        this.label = 'GIT'
        this.name = 'vibeGit'
        this.version = 1.0
        this.type = 'VibeFlow Git'
        this.icon = 'vibeflow.svg'
        this.category = 'Tools'
        this.description =
            'Run whitelisted git commands on a local repository (init, clone, fetch, branch, checkout, switch, add, commit, log, status, diff, show, grep)'
        this.baseClasses = [this.type, ...getBaseClasses(DynamicStructuredTool), 'Tool']
        this.inputs = [
            {
                label: 'Repository Path',
                name: 'vibeGitRepoPath',
                type: 'string',
                acceptVariable: true,
                description: 'Repository directory, relative to the workspace root. Defaults to the workspace root',
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
                label: 'Timeout (ms)',
                name: 'vibeGitTimeoutMs',
                type: 'number',
                default: 120000,
                description: 'Maximum execution time of a single git command',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Max Output Length',
                name: 'vibeMaxOutputLength',
                type: 'number',
                default: 20000,
                description: 'Maximum number of characters returned to the model',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Name',
                name: 'vibeGitToolName',
                type: 'string',
                default: DEFAULT_NAME,
                description: 'Name of the tool',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'vibeGitToolDescription',
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
        const workspaceRoot = (nodeData.inputs?.vibeWorkspaceRoot as string) || undefined
        const repoPath = (nodeData.inputs?.vibeGitRepoPath as string) || undefined
        const timeoutMs = Number(nodeData.inputs?.vibeGitTimeoutMs) || 120000
        const maxOutputLength = Number(nodeData.inputs?.vibeMaxOutputLength) || 20000
        const name = sanitizeToolName((nodeData.inputs?.vibeGitToolName as string) || DEFAULT_NAME, DEFAULT_NAME)
        const description = (nodeData.inputs?.vibeGitToolDescription as string) || DEFAULT_DESCRIPTION
        const cwdLabel = getWorkspaceRoot(workspaceRoot)

        return new DynamicStructuredTool({
            name,
            description: `${description} Workspace root: ${cwdLabel}${repoPath ? ` | repository: ${repoPath}` : ''}.`,
            schema: z.object({
                subcommand: z.enum(GIT_ALLOWED_SUBCOMMANDS as [string, ...string[]]).describe('git subcommand to run'),
                args: z.array(z.string()).optional().describe('Arguments passed to the git subcommand'),
                repoPath: z.string().optional().describe('Optional repository directory, relative to the workspace root')
            }),
            func: async ({ subcommand, args, repoPath: perCallRepo }: any) => {
                try {
                    const result = await runGitCommand(subcommand, args || [], {
                        cwd: perCallRepo || repoPath,
                        timeoutMs,
                        maxOutputLength,
                        workspaceRoot
                    })
                    return formatCommandResult(result)
                } catch (error) {
                    return `[git error] ${toErrorMessage(error)}`
                }
            }
        })
    }
}

module.exports = { nodeClass: VibeGit_Tools }
