import { DynamicStructuredTool } from '@langchain/core/tools'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { z } from 'zod/v3'
import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { getWorkspaceRoot, relativeToWorkspace, resolveInsideWorkspace, sanitizeToolName, toErrorMessage } from '../../../src/vibeflowTools'

const DEFAULT_NAME = 'write'
const DEFAULT_DESCRIPTION =
    'Create one or several files and directories, with any extension, anywhere inside the workspace. Parent directories are created automatically. Content is plain text by default, or base64 when the file must be binary.'

class VibeWrite_Tools implements INode {
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
        this.label = 'WRITE'
        this.name = 'vibeWrite'
        this.version = 1.0
        this.type = 'VibeFlow Write'
        this.icon = 'vibeflow.svg'
        this.category = 'Tools'
        this.description = 'Create one or many files/folders of any format inside the workspace'
        this.baseClasses = [this.type, ...getBaseClasses(DynamicStructuredTool), 'Tool']
        this.inputs = [
            {
                label: 'Overwrite Existing Files',
                name: 'vibeWriteOverwrite',
                type: 'boolean',
                default: true,
                description: 'When disabled, an existing file makes the write fail instead of being replaced',
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
                name: 'vibeWriteToolName',
                type: 'string',
                default: DEFAULT_NAME,
                description: 'Name of the tool',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'vibeWriteToolDescription',
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
        const overwrite = nodeData.inputs?.vibeWriteOverwrite === undefined ? true : Boolean(nodeData.inputs?.vibeWriteOverwrite)
        const workspaceRoot = (nodeData.inputs?.vibeWorkspaceRoot as string) || undefined
        const name = sanitizeToolName((nodeData.inputs?.vibeWriteToolName as string) || DEFAULT_NAME, DEFAULT_NAME)
        const description = (nodeData.inputs?.vibeWriteToolDescription as string) || DEFAULT_DESCRIPTION

        return new DynamicStructuredTool({
            name,
            description: `${description} Workspace root: ${getWorkspaceRoot(workspaceRoot)}.`,
            schema: z.object({
                files: z
                    .array(
                        z.object({
                            path: z.string().describe('File path relative to the workspace root'),
                            content: z.string().describe('File content'),
                            encoding: z.enum(['utf8', 'base64']).optional().describe('utf8 by default, base64 for binary files')
                        })
                    )
                    .describe('Files to create or replace'),
                directories: z.array(z.string()).optional().describe('Directories to create, even when empty'),
                createParents: z.boolean().optional().describe('Create missing parent directories (default true)')
            }),
            func: async ({ files, directories, createParents }: any) => {
                try {
                    const createDirectoryPath: string[] = []
                    for (const directory of directories || []) {
                        const target = resolveInsideWorkspace(directory, workspaceRoot)
                        mkdirSync(target, { recursive: true })
                        createDirectoryPath.push(`- ${relativeToWorkspace(target, workspaceRoot)}/`)
                    }

                    const lines: string[] = []
                    for (const file of files || []) {
                        const target = resolveInsideWorkspace(file.path, workspaceRoot)
                        if (createParents !== false) mkdirSync(path.dirname(target), { recursive: true })
                        const encoding = file.encoding === 'base64' ? 'base64' : 'utf8'
                        try {
                            writeFileSync(target, file.content ?? '', {
                                encoding: encoding as BufferEncoding,
                                flag: overwrite ? 'w' : 'wx'
                            })
                            const written = Buffer.byteLength(file.content ?? '', encoding as BufferEncoding)
                            lines.push(`- wrote ${relativeToWorkspace(target, workspaceRoot)} (${written} bytes)`)
                        } catch (writeError) {
                            lines.push(`- FAILED ${file.path}: ${toErrorMessage(writeError)}`)
                        }
                    }

                    const summary = [...createDirectoryPath, ...lines]
                    return summary.length ? `Write result:\n${summary.join('\n')}` : 'Nothing to write: no file or directory provided'
                } catch (error) {
                    return `[write error] ${toErrorMessage(error)}`
                }
            }
        })
    }
}

module.exports = { nodeClass: VibeWrite_Tools }
