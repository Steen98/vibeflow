import { DynamicStructuredTool } from '@langchain/core/tools'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { z } from 'zod/v3'
import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { getWorkspaceRoot, relativeToWorkspace, resolveInsideWorkspace, sanitizeToolName, toErrorMessage } from '../../../src/vibeflowTools'

const DEFAULT_NAME = 'grep'
const DEFAULT_DESCRIPTION =
    'Search a text or a pattern inside one or many files (the "Ctrl+F" of the project). Returns file, line number and matching line, like grep -n -r.'

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

class VibeGrep_Tools implements INode {
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
        this.label = 'GREP'
        this.name = 'vibeGrep'
        this.version = 1.0
        this.type = 'VibeFlow Grep'
        this.icon = 'vibeflow.svg'
        this.category = 'Tools'
        this.description = 'Search a text or a pattern inside one or many files (supports -i, -r, regular expressions)'
        this.baseClasses = [this.type, ...getBaseClasses(DynamicStructuredTool), 'Tool']
        this.inputs = [
            {
                label: 'Excluded Directories',
                name: 'vibeGrepExcludedDirs',
                type: 'string',
                default: 'node_modules,.git,dist,build,.next,.turbo,coverage',
                description: 'Comma separated list of directories skipped during recursion',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Default Max Results',
                name: 'vibeGrepMaxResults',
                type: 'number',
                default: 200,
                description: 'Maximum number of matching lines returned',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Max File Size (KB)',
                name: 'vibeGrepMaxFileSizeKb',
                type: 'number',
                default: 2048,
                description: 'Files bigger than this limit are skipped',
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
                name: 'vibeGrepToolName',
                type: 'string',
                default: DEFAULT_NAME,
                description: 'Name of the tool',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'vibeGrepToolDescription',
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
        const excludedDirs = ((nodeData.inputs?.vibeGrepExcludedDirs as string) || 'node_modules,.git,dist,build')
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        const defaultMaxResults = Number(nodeData.inputs?.vibeGrepMaxResults) || 200
        const maxFileSizeKb = Number(nodeData.inputs?.vibeGrepMaxFileSizeKb) || 2048
        const workspaceRoot = (nodeData.inputs?.vibeWorkspaceRoot as string) || undefined
        const name = sanitizeToolName((nodeData.inputs?.vibeGrepToolName as string) || DEFAULT_NAME, DEFAULT_NAME)
        const description = (nodeData.inputs?.vibeGrepToolDescription as string) || DEFAULT_DESCRIPTION

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

        return new DynamicStructuredTool({
            name,
            description: `${description} Workspace root: ${getWorkspaceRoot(workspaceRoot)}.`,
            schema: z.object({
                pattern: z.string().describe('Text to search, or a regular expression when regex=true'),
                paths: z
                    .array(z.string())
                    .optional()
                    .describe('Files or directories to search, relative to the workspace root (default: workspace root)'),
                ignoreCase: z.boolean().optional().describe('Case insensitive search (-i)'),
                regex: z.boolean().optional().describe('Treat the pattern as a regular expression'),
                recursive: z.boolean().optional().describe('Search sub-directories (default true)'),
                include: z.string().optional().describe('Only search files whose name matches this pattern, e.g. "*.ts"'),
                maxResults: z.number().optional().describe('Maximum number of matching lines to return')
            }),
            func: async ({ pattern, paths, ignoreCase, regex, recursive, include, maxResults }: any) => {
                try {
                    if (!pattern || !pattern.length) return '[grep error] an empty pattern was provided'

                    const flags = ignoreCase ? 'gi' : 'g'
                    const matcher = regex ? new RegExp(pattern, flags) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
                    const includeMatcher = include
                        ? new RegExp(
                              `^${include
                                  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                                  .replace(/\*/g, '.*')
                                  .replace(/\?/g, '.')}$`,
                              'i'
                          )
                        : null
                    const limit = Number(maxResults) || defaultMaxResults
                    const deepSearch = recursive !== false

                    const targets = Array.isArray(paths) && paths.length ? paths : ['.']
                    const files: string[] = []
                    for (const requestedPath of targets) {
                        const target = resolveInsideWorkspace(requestedPath, workspaceRoot)
                        if (!existsSync(target)) continue
                        const stats = statSync(target)
                        if (stats.isDirectory()) {
                            if (deepSearch) collectFiles(target, files)
                            else {
                                for (const entry of readdirSync(target, { withFileTypes: true })) {
                                    if (entry.isFile()) files.push(path.join(target, entry.name))
                                }
                            }
                        } else {
                            files.push(target)
                        }
                    }

                    const matches: string[] = []
                    let scannedFiles = 0
                    for (const file of files) {
                        if (matches.length >= limit) break
                        if (includeMatcher && !includeMatcher.test(path.basename(file))) continue
                        if (BINARY_EXTENSIONS.includes(path.extname(file).toLowerCase())) continue
                        let stats
                        try {
                            stats = statSync(file)
                        } catch {
                            continue
                        }
                        if (!stats.isFile() || stats.size > maxFileSizeKb * 1024) continue
                        scannedFiles += 1
                        let content: string
                        try {
                            content = readFileSync(file, 'utf8')
                        } catch {
                            continue
                        }
                        const lines = content.split(/\r?\n/)
                        for (let index = 0; index < lines.length; index++) {
                            if (matches.length >= limit) break
                            matcher.lastIndex = 0
                            if (matcher.test(lines[index])) {
                                matches.push(`${relativeToWorkspace(file, workspaceRoot)}:${index + 1}: ${lines[index].trim()}`)
                            }
                        }
                    }

                    if (!matches.length) return `No match for "${pattern}" (${scannedFiles} file(s) scanned)`
                    const header = `${matches.length} match(es) for "${pattern}" in ${scannedFiles} file(s)${
                        matches.length >= limit ? ` (limited to ${limit})` : ''
                    }:`
                    return `${header}\n${matches.join('\n')}`
                } catch (error) {
                    return `[grep error] ${toErrorMessage(error)}`
                }
            }
        })
    }
}

module.exports = { nodeClass: VibeGrep_Tools }
