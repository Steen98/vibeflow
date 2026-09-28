import { DynamicStructuredTool } from '@langchain/core/tools'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { z } from 'zod/v3'
import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import {
    getWorkspaceRoot,
    relativeToWorkspace,
    resolveInsideWorkspace,
    sanitizeToolName,
    toErrorMessage,
    truncateOutput
} from '../../../src/vibeflowTools'

const DEFAULT_NAME = 'read'
const DEFAULT_DESCRIPTION =
    'Read the content of one or several files. Accepts files, directories (read recursively) and glob-like patterns, so it can read the codebase of a project spread over several directories.'
const BINARY_EXTENSIONS = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.ico',
    '.pdf',
    '.zip',
    '.gz',
    '.tar',
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.mp3',
    '.mp4',
    '.mov',
    '.avi',
    '.bin',
    '.class',
    '.jar',
    '.pyc'
]

class VibeRead_Tools implements INode {
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
        this.label = 'READ'
        this.name = 'vibeRead'
        this.version = 1.0
        this.type = 'VibeFlow Read'
        this.icon = 'vibeflow.svg'
        this.category = 'Tools'
        this.description = 'Read one or many files, from one or many directories (codebase aware)'
        this.baseClasses = [this.type, ...getBaseClasses(DynamicStructuredTool), 'Tool']
        this.inputs = [
            {
                label: 'Max File Size (KB)',
                name: 'vibeReadMaxFileSizeKb',
                type: 'number',
                default: 512,
                description: 'Files bigger than this limit are reported but not inlined',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Max Output Length',
                name: 'vibeMaxOutputLength',
                type: 'number',
                default: 60000,
                description: 'Maximum number of characters returned to the model',
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
                label: 'Excluded Directories',
                name: 'vibeReadExcludedDirs',
                type: 'string',
                default: 'node_modules,.git,dist,build,.next,.turbo,coverage',
                description: 'Comma separated list of directories skipped during recursion',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Name',
                name: 'vibeReadToolName',
                type: 'string',
                default: DEFAULT_NAME,
                description: 'Name of the tool',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'vibeReadToolDescription',
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
        const maxFileSizeKb = Number(nodeData.inputs?.vibeReadMaxFileSizeKb) || 512
        const maxOutputLength = Number(nodeData.inputs?.vibeMaxOutputLength) || 60000
        const workspaceRoot = (nodeData.inputs?.vibeWorkspaceRoot as string) || undefined
        const excludedDirs = ((nodeData.inputs?.vibeReadExcludedDirs as string) || 'node_modules,.git,dist,build')
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        const name = sanitizeToolName((nodeData.inputs?.vibeReadToolName as string) || DEFAULT_NAME, DEFAULT_NAME)
        const description = (nodeData.inputs?.vibeReadToolDescription as string) || DEFAULT_DESCRIPTION

        const globToRegex = (pattern: string): RegExp => {
            const escaped = pattern
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.')
            return new RegExp(`^${escaped}$`, 'i')
        }

        const collectFiles = (target: string, files: string[], depth = 0): void => {
            if (depth > 24) return
            const stats = statSync(target)
            if (stats.isDirectory()) {
                for (const entry of readdirSync(target)) {
                    if (excludedDirs.includes(entry)) continue
                    collectFiles(path.join(target, entry), files, depth + 1)
                }
                return
            }
            if (stats.isFile()) files.push(target)
        }

        const readOne = (filePath: string): string => {
            const stats = statSync(filePath)
            const label = relativeToWorkspace(filePath, workspaceRoot)
            if (BINARY_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
                return `--- ${label} ---\n[binary file skipped, ${stats.size} bytes]`
            }
            if (stats.size > maxFileSizeKb * 1024) {
                return `--- ${label} ---\n[file skipped, ${stats.size} bytes > ${maxFileSizeKb} KB limit]`
            }
            const content = readFileSync(filePath, 'utf8')
            return `--- ${label} ---\n${content}`
        }

        return new DynamicStructuredTool({
            name,
            description: `${description} Workspace root: ${getWorkspaceRoot(workspaceRoot)}.`,
            schema: z.object({
                paths: z.array(z.string()).describe('Files, directories or patterns (e.g. "src/**/*.ts", "packages/server/src") to read'),
                maxBytesPerFile: z.number().optional().describe('Optional per-file size limit in bytes')
            }),
            func: async ({ paths }: any) => {
                try {
                    const requested: string[] = Array.isArray(paths) ? paths : [paths]
                    const collected: string[] = []

                    for (const requestedPath of requested) {
                        const target = resolveInsideWorkspace(requestedPath, workspaceRoot)
                        if (existsSync(target)) {
                            collectFiles(target, collected)
                            continue
                        }
                        // glob-like pattern support
                        if (/[*?]/.test(requestedPath)) {
                            const normalized = requestedPath.replace(/\\/g, '/')
                            const baseSegment = normalized.split('/').find((segment) => /[*?]/.test(segment)) || ''
                            const baseDir = normalized.slice(0, Math.max(normalized.indexOf(baseSegment), 0)) || '.'
                            const matcher = globToRegex(baseSegment)
                            const candidates: string[] = []
                            collectFiles(resolveInsideWorkspace(baseDir, workspaceRoot), candidates)
                            for (const candidate of candidates) {
                                if (matcher.test(path.basename(candidate))) collected.push(candidate)
                            }
                            continue
                        }
                        collected.push(`__MISSING__${requestedPath}`)
                    }

                    if (!collected.length) return `No file matched: ${requested.join(', ')}`

                    const chunks: string[] = []
                    for (const entry of collected) {
                        if (entry.startsWith('__MISSING__')) {
                            chunks.push(`--- ${entry.replace('__MISSING__', '')} ---\n[not found]`)
                            continue
                        }
                        chunks.push(readOne(entry))
                    }
                    return truncateOutput(chunks.join('\n\n'), maxOutputLength)
                } catch (error) {
                    return `[read error] ${toErrorMessage(error)}`
                }
            }
        })
    }
}

module.exports = { nodeClass: VibeRead_Tools }
