import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import {
    assertCommandsAllowed,
    DEFAULT_COMMAND_ALLOWLIST,
    formatCommandResult,
    getWorkspaceRoot,
    parseAllowlist,
    runShellCommand,
    sanitizeToolName,
    toErrorMessage
} from '../../../src/vibeflowTools'

const DEFAULT_NAME = 'bash'
const DEFAULT_DESCRIPTION =
    'Run a shell command on the host machine and return stdout, stderr and the exit code. Works on Windows (cmd.exe), Linux and macOS (sh). Pipes, redirections and chained commands are supported. Always work inside the configured workspace.'

class VibeBash_Tools implements INode {
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
        this.label = 'BASH'
        this.name = 'vibeBash'
        this.version = 1.0
        this.type = 'VibeFlow Bash'
        this.icon = 'vibeflow.svg'
        this.category = 'Tools'
        this.description = 'Execute shell commands on the host (Windows, Linux, macOS), restricted to an allowlist'
        this.baseClasses = [this.type, ...getBaseClasses(DynamicStructuredTool), 'Tool']
        this.inputs = [
            {
                label: 'Command Allowlist',
                name: 'vibeBashAllowlist',
                type: 'string',
                rows: 3,
                default: DEFAULT_COMMAND_ALLOWLIST.join(','),
                description: 'Comma separated list of commands the agent is allowed to run',
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
                name: 'vibeBashTimeoutMs',
                type: 'number',
                default: 120000,
                description: 'Maximum execution time of a single command',
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
                name: 'vibeBashToolName',
                type: 'string',
                default: DEFAULT_NAME,
                description: 'Name of the tool',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'vibeBashToolDescription',
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
        const allowlist = parseAllowlist(nodeData.inputs?.vibeBashAllowlist as string)
        const timeoutMs = Number(nodeData.inputs?.vibeBashTimeoutMs) || 120000
        const maxOutputLength = Number(nodeData.inputs?.vibeMaxOutputLength) || 20000
        const name = sanitizeToolName((nodeData.inputs?.vibeBashToolName as string) || DEFAULT_NAME, DEFAULT_NAME)
        const description = (nodeData.inputs?.vibeBashToolDescription as string) || DEFAULT_DESCRIPTION
        const cwdLabel = getWorkspaceRoot(workspaceRoot)

        return new DynamicStructuredTool({
            name,
            description: `${description} Workspace root: ${cwdLabel}. Allowed commands: ${allowlist.join(', ')}.`,
            schema: z.object({
                command: z.string().describe('Full command line to execute, for example "npm run build" or "ls -la src"'),
                cwd: z.string().optional().describe('Optional working directory, relative to the workspace root'),
                timeoutMs: z.number().optional().describe('Optional timeout in milliseconds for this specific command')
            }),
            func: async ({ command, cwd, timeoutMs: perCallTimeout }: any) => {
                try {
                    assertCommandsAllowed(command, allowlist)
                    const result = await runShellCommand(command, {
                        cwd,
                        timeoutMs: perCallTimeout || timeoutMs,
                        maxOutputLength,
                        workspaceRoot
                    })
                    return formatCommandResult(result)
                } catch (error) {
                    return `[bash error] ${toErrorMessage(error)}`
                }
            }
        })
    }
}

module.exports = { nodeClass: VibeBash_Tools }
