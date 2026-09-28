import { DynamicStructuredTool } from '@langchain/core/tools'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { z } from 'zod/v3'
import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { getWorkspaceRoot, relativeToWorkspace, resolveInsideWorkspace, sanitizeToolName, toErrorMessage } from '../../../src/vibeflowTools'

const DEFAULT_NAME = 'edit'
const DEFAULT_DESCRIPTION =
    'Edit one or several files (partial replacement of a string, or full rewrite), and rename/move files and directories. Works with any extension, anywhere inside the workspace.'

class VibeEdit_Tools implements INode {
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
        this.label = 'EDIT'
        this.name = 'vibeEdit'
        this.version = 1.0
        this.type = 'VibeFlow Edit'
        this.icon = 'vibeflow.svg'
        this.category = 'Tools'
        this.description = 'Modify/rewrite one or many files and rename files or folders inside the workspace'
        this.baseClasses = [this.type, ...getBaseClasses(DynamicStructuredTool), 'Tool']
        this.inputs = [
            {
                label: 'Allow Full Rewrite',
                name: 'vibeEditAllowFullRewrite',
                type: 'boolean',
                default: true,
                description: 'Allow replacing the whole content of a file (not only a matching fragment)',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Allow Rename',
                name: 'vibeEditAllowRename',
                type: 'boolean',
                default: true,
                description: 'Allow renaming or moving files and directories',
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
                name: 'vibeEditToolName',
                type: 'string',
                default: DEFAULT_NAME,
                description: 'Name of the tool',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'vibeEditToolDescription',
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
        const allowFullRewrite =
            nodeData.inputs?.vibeEditAllowFullRewrite === undefined ? true : Boolean(nodeData.inputs?.vibeEditAllowFullRewrite)
        const allowRename = nodeData.inputs?.vibeEditAllowRename === undefined ? true : Boolean(nodeData.inputs?.vibeEditAllowRename)
        const workspaceRoot = (nodeData.inputs?.vibeWorkspaceRoot as string) || undefined
        const name = sanitizeToolName((nodeData.inputs?.vibeEditToolName as string) || DEFAULT_NAME, DEFAULT_NAME)
        const description = (nodeData.inputs?.vibeEditToolDescription as string) || DEFAULT_DESCRIPTION

        return new DynamicStructuredTool({
            name,
            description: `${description} Workspace root: ${getWorkspaceRoot(workspaceRoot)}.`,
            schema: z.object({
                edits: z
                    .array(
                        z.object({
                            path: z.string().describe('File path relative to the workspace root'),
                            find: z.string().optional().describe('Exact text fragment to replace'),
                            replace: z.string().optional().describe('Replacement text for "find"'),
                            replaceAll: z.boolean().optional().describe('Replace every occurrence instead of the first one'),
                            content: z.string().optional().describe('New full content of the file (full rewrite)'),
                            newPath: z.string().optional().describe('Rename/move the file to this path')
                        })
                    )
                    .describe('Edits to apply, in order'),
                newDirectories: z.array(z.string()).optional().describe('Directories to create before applying the edits')
            }),
            func: async ({ edits, newDirectories }: any) => {
                try {
                    const lines: string[] = []
                    for (const directory of newDirectories || []) {
                        const target = resolveInsideWorkspace(directory, workspaceRoot)
                        mkdirSync(target, { recursive: true })
                        lines.push(`- created directory ${relativeToWorkspace(target, workspaceRoot)}/`)
                    }

                    for (const edit of edits || []) {
                        const target = resolveInsideWorkspace(edit.path, workspaceRoot)
                        if (!existsSync(target)) {
                            lines.push(`- FAILED ${edit.path}: file not found`)
                            continue
                        }

                        if (edit.content !== undefined) {
                            if (!allowFullRewrite) {
                                lines.push(`- REFUSED ${edit.path}: full rewrite is disabled on this node`)
                                continue
                            }
                            writeFileSync(target, edit.content, 'utf8')
                            lines.push(`- rewrote ${relativeToWorkspace(target, workspaceRoot)}`)
                        }

                        if (edit.find !== undefined && edit.replace !== undefined) {
                            const original = readFileSync(target, 'utf8')
                            if (!original.includes(edit.find)) {
                                lines.push(`- FAILED ${edit.path}: "find" fragment not present in the file`)
                                continue
                            }
                            const occurrences = original.split(edit.find).length - 1
                            const updated = edit.replaceAll
                                ? original.split(edit.find).join(edit.replace)
                                : original.replace(edit.find, edit.replace)
                            writeFileSync(target, updated, 'utf8')
                            lines.push(
                                `- patched ${relativeToWorkspace(target, workspaceRoot)} (${
                                    edit.replaceAll ? occurrences : 1
                                } occurrence(s))`
                            )
                        }

                        if (edit.newPath) {
                            if (!allowRename) {
                                lines.push(`- REFUSED ${edit.path}: rename is disabled on this node`)
                                continue
                            }
                            const destination = resolveInsideWorkspace(edit.newPath, workspaceRoot)
                            mkdirSync(path.dirname(destination), { recursive: true })
                            renameSync(target, destination)
                            lines.push(
                                `- renamed ${relativeToWorkspace(target, workspaceRoot)} -> ${relativeToWorkspace(
                                    destination,
                                    workspaceRoot
                                )}`
                            )
                        }
                    }

                    return lines.length ? `Edit result:\n${lines.join('\n')}` : 'Nothing to edit: no edit provided'
                } catch (error) {
                    return `[edit error] ${toErrorMessage(error)}`
                }
            }
        })
    }
}

module.exports = { nodeClass: VibeEdit_Tools }
