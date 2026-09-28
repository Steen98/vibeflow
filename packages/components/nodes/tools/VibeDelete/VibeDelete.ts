import { DynamicStructuredTool } from '@langchain/core/tools'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import path from 'path'
import { z } from 'zod/v3'
import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { getWorkspaceRoot, relativeToWorkspace, resolveInsideWorkspace, sanitizeToolName, toErrorMessage } from '../../../src/vibeflowTools'

const DEFAULT_NAME = 'delete'
const DEFAULT_DESCRIPTION =
    'Delete one or several files or directories inside the workspace. Deletion requires an explicit confirmation flag, and the node itself can require it too.'

class VibeDelete_Tools implements INode {
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
        this.label = 'DELETE'
        this.name = 'vibeDelete'
        this.version = 1.0
        this.type = 'VibeFlow Delete'
        this.icon = 'vibeflow.svg'
        this.category = 'Tools'
        this.description = 'Delete one or many files/folders inside the workspace (confirmation required)'
        this.baseClasses = [this.type, ...getBaseClasses(DynamicStructuredTool), 'Tool']
        this.inputs = [
            {
                label: 'Require Confirmation',
                name: 'vibeDeleteRequireConfirmation',
                type: 'boolean',
                default: true,
                description:
                    'The model must pass confirm=true for the deletion to happen. Keep enabled and also enable "Require Human Input" on the Agent node for a human gate',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Move To Trash Instead Of Deleting',
                name: 'vibeDeleteSoftDelete',
                type: 'boolean',
                default: false,
                description: 'When enabled, items are moved into .vibeflow-trash/<timestamp>/ instead of being permanently deleted',
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
                name: 'vibeDeleteToolName',
                type: 'string',
                default: DEFAULT_NAME,
                description: 'Name of the tool',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'vibeDeleteToolDescription',
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
        const requireConfirmation =
            nodeData.inputs?.vibeDeleteRequireConfirmation === undefined ? true : Boolean(nodeData.inputs?.vibeDeleteRequireConfirmation)
        const softDelete = nodeData.inputs?.vibeDeleteSoftDelete === undefined ? false : Boolean(nodeData.inputs?.vibeDeleteSoftDelete)
        const workspaceRoot = (nodeData.inputs?.vibeWorkspaceRoot as string) || undefined
        const name = sanitizeToolName((nodeData.inputs?.vibeDeleteToolName as string) || DEFAULT_NAME, DEFAULT_NAME)
        const description = (nodeData.inputs?.vibeDeleteToolDescription as string) || DEFAULT_DESCRIPTION

        return new DynamicStructuredTool({
            name,
            description: `${description} Workspace root: ${getWorkspaceRoot(workspaceRoot)}.`,
            schema: z.object({
                paths: z.array(z.string()).describe('Files or directories to delete, relative to the workspace root'),
                confirm: z.boolean().describe('Explicit confirmation. Must be true for the deletion to be executed'),
                reason: z.string().optional().describe('Short explanation of why these items are deleted')
            }),
            func: async ({ paths, confirm, reason }: any) => {
                try {
                    const requested: string[] = Array.isArray(paths) ? paths : [paths]
                    if (!requested.length) return 'Nothing to delete: no path provided'

                    if (requireConfirmation && confirm !== true) {
                        return (
                            `[confirmation required] Deletion of ${requested.join(', ')} was NOT executed. ` +
                            `Call this tool again with confirm=true once the user agreed to the deletion.`
                        )
                    }

                    const root = getWorkspaceRoot(workspaceRoot)
                    const trashDir = path.join(root, '.vibeflow-trash', new Date().toISOString().replace(/[:.]/g, '-'))
                    const lines: string[] = []

                    for (const requestedPath of requested) {
                        const target = resolveInsideWorkspace(requestedPath, workspaceRoot)
                        if (!existsSync(target)) {
                            lines.push(`- SKIPPED ${requestedPath}: not found`)
                            continue
                        }
                        if (path.resolve(target) === path.resolve(root)) {
                            lines.push(`- REFUSED ${requestedPath}: the workspace root itself cannot be deleted`)
                            continue
                        }
                        const stats = statSync(target)
                        if (softDelete) {
                            mkdirSync(trashDir, { recursive: true })
                            const destination = path.join(trashDir, path.basename(target))
                            renameSync(target, destination)
                            lines.push(
                                `- moved to trash ${relativeToWorkspace(target, workspaceRoot)} -> ${relativeToWorkspace(
                                    destination,
                                    workspaceRoot
                                )}`
                            )
                        } else {
                            rmSync(target, { recursive: stats.isDirectory(), force: false })
                            lines.push(
                                `- deleted ${stats.isDirectory() ? 'directory' : 'file'} ${relativeToWorkspace(target, workspaceRoot)}`
                            )
                        }
                    }

                    const header = `Delete result (confirmation received${reason ? `, reason: ${reason}` : ''}):`
                    return `${header}\n${lines.join('\n')}`
                } catch (error) {
                    return `[delete error] ${toErrorMessage(error)}`
                }
            }
        })
    }
}

module.exports = { nodeClass: VibeDelete_Tools }
