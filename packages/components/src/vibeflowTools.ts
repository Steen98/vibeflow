import { execFile } from 'child_process'
import path from 'path'

/**
 * VibeFlow native tools: shared helpers.
 *
 * Every file-system or command tool works inside a single workspace root:
 *  - VIBEFLOW_WORKSPACE_ROOT env variable when set,
 *  - otherwise the current working directory of the Flowise server.
 * Paths pointing outside of that root are rejected.
 */

export const VIBEFLOW_WORKSPACE_ROOT_ENV = 'VIBEFLOW_WORKSPACE_ROOT'

export const getWorkspaceRoot = (override?: string): string => {
    const candidate = override && override.trim().length ? override.trim() : process.env[VIBEFLOW_WORKSPACE_ROOT_ENV] || process.cwd()
    return path.resolve(candidate)
}

/** Resolve `target` against the workspace root and reject any path escaping it. */
export const resolveInsideWorkspace = (target: string, override?: string): string => {
    const root = getWorkspaceRoot(override)
    const resolved = path.resolve(root, target && target.trim().length ? target.trim() : '.')
    const relative = path.relative(root, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Path "${target}" is outside of the workspace root "${root}"`)
    }
    return resolved
}

export const relativeToWorkspace = (absolutePath: string, override?: string): string => {
    const root = getWorkspaceRoot(override)
    const relative = path.relative(root, absolutePath)
    return relative.length ? relative.replace(/\\/g, '/') : '.'
}

export const truncateOutput = (value: string, maxLength: number): string => {
    if (!value) return ''
    if (maxLength <= 0 || value.length <= maxLength) return value
    return `${value.slice(0, maxLength)}\n[... output truncated, ${value.length - maxLength} characters omitted ...]`
}

export const sanitizeToolName = (value: string, fallback: string): string => {
    const cleaned = (value || '')
        .toLowerCase()
        .trim()
        .replace(/ /g, '_')
        .replace(/[^a-z0-9_-]/g, '')
    return cleaned.length ? cleaned : fallback
}

export interface IVibeCommandResult {
    label: string
    cwd: string
    exitCode: number | null
    stdout: string
    stderr: string
    durationMs: number
    timedOut: boolean
}

export const formatCommandResult = (result: IVibeCommandResult): string => {
    const parts: string[] = [`$ ${result.label}`]
    if (result.stdout && result.stdout.trim().length) parts.push(result.stdout.trimEnd())
    if (result.stderr && result.stderr.trim().length) parts.push(`[stderr]\n${result.stderr.trimEnd()}`)
    parts.push(
        `[exit code: ${result.exitCode === null ? 'n/a' : result.exitCode}${result.timedOut ? ', TIMED OUT' : ''} | ${
            result.durationMs
        } ms | cwd: ${result.cwd}]`
    )
    return parts.join('\n')
}

/** Shell used to run BASH tool commands: cmd.exe on Windows, sh elsewhere. */
export const getShell = (): string => {
    if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe'
    return process.env.SHELL || '/bin/sh'
}

const getShellArgs = (commandLine: string): string[] => {
    if (process.platform === 'win32') return ['/d', '/s', '/c', commandLine]
    return ['-c', commandLine]
}

export const DEFAULT_COMMAND_ALLOWLIST = [
    'git',
    'node',
    'npm',
    'pnpm',
    'npx',
    'yarn',
    'tsc',
    'eslint',
    'prettier',
    'python',
    'python3',
    'pip',
    'pip3',
    'uv',
    'uvx',
    'ls',
    'dir',
    'pwd',
    'cd',
    'cat',
    'type',
    'echo',
    'grep',
    'findstr',
    'find',
    'head',
    'tail',
    'wc',
    'sed',
    'awk',
    'sort',
    'uniq',
    'cut',
    'tr',
    'mkdir',
    'cp',
    'copy',
    'mv',
    'move',
    'touch',
    'which',
    'where',
    'tree',
    'jq',
    'curl',
    'docker',
    'unzip',
    'zip',
    'tar',
    'env',
    'set'
]

export const parseAllowlist = (value: string | undefined, fallback: string[] = DEFAULT_COMMAND_ALLOWLIST): string[] => {
    const source = value && value.trim().length ? value : fallback.join(',')
    return source
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
        .map((entry) => basenameWithoutExtension(entry))
}

const basenameWithoutExtension = (value: string): string => {
    const base = path.basename(value.replace(/\\/g, '/').toLowerCase())
    return base.replace(/\.(exe|cmd|bat|ps1|sh)$/, '')
}

const stripQuotes = (value: string): string => value.replace(/^["']|["']$/g, '')

/**
 * Best effort extraction of the commands used by a shell command line:
 * every pipeline / chained segment contributes its first token.
 */
export const extractCommandNames = (commandLine: string): string[] => {
    const names: string[] = []
    for (const segment of (commandLine || '').split(/&&|\|\||;|\|/)) {
        const trimmed = segment.trim()
        if (!trimmed.length) continue
        const firstToken = trimmed.split(/\s+/)[0]
        if (!firstToken) continue
        const cleaned = basenameWithoutExtension(stripQuotes(firstToken))
        // skip shell operators and leading env assignments such as "FOO=bar"
        if (!cleaned.length || cleaned.includes('=') || ['>', '<', '>>'].includes(cleaned)) continue
        names.push(cleaned)
    }
    return names
}

export const assertCommandsAllowed = (commandLine: string, allowlist: string[]): void => {
    const names = extractCommandNames(commandLine)
    if (!names.length) throw new Error('No command detected in the provided command line')
    const denied = names.filter((name) => !allowlist.includes(name))
    if (denied.length) {
        throw new Error(
            `Command(s) not allowed: ${denied.join(', ')}. Allowed commands: ${allowlist.join(', ')}. ` +
                `Update the "Command Allowlist" input to authorise more commands.`
        )
    }
}

export interface IRunCommandOptions {
    cwd?: string
    timeoutMs?: number
    maxOutputLength?: number
    workspaceRoot?: string
}

const runExecutable = async (label: string, file: string, args: string[], options: IRunCommandOptions): Promise<IVibeCommandResult> => {
    const cwd = options.cwd ? resolveInsideWorkspace(options.cwd, options.workspaceRoot) : getWorkspaceRoot(options.workspaceRoot)
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 120000
    const started = Date.now()

    return await new Promise<IVibeCommandResult>((resolve) => {
        execFile(
            file,
            args,
            { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
            (error: any, stdout: string, stderr: string) => {
                const rawCode = error ? error.code : 0
                resolve({
                    label,
                    cwd,
                    exitCode: typeof rawCode === 'number' ? rawCode : error ? 1 : 0,
                    stdout: truncateOutput(stdout ?? '', options.maxOutputLength ?? 20000),
                    stderr: truncateOutput(stderr ?? '', options.maxOutputLength ?? 20000),
                    durationMs: Date.now() - started,
                    timedOut: Boolean(error && error.killed)
                })
            }
        )
    })
}

/** Run a shell command line (pipes and redirections supported). */
export const runShellCommand = async (commandLine: string, options: IRunCommandOptions = {}): Promise<IVibeCommandResult> => {
    return await runExecutable(commandLine, getShell(), getShellArgs(commandLine), options)
}

export const GIT_ALLOWED_SUBCOMMANDS = [
    'init',
    'clone',
    'fetch',
    'branch',
    'checkout',
    'switch',
    'add',
    'commit',
    'log',
    'status',
    'diff',
    'show',
    'grep'
]

export const GIT_BLOCKED_SUBCOMMANDS = ['configure', 'config', 'pull', 'merge', 'push']

/** Run a whitelisted git subcommand. `configure|config|pull|merge|push` are always refused. */
export const runGitCommand = async (
    subcommand: string,
    args: string[] = [],
    options: IRunCommandOptions = {}
): Promise<IVibeCommandResult> => {
    const sub = (subcommand || '').trim().toLowerCase()
    if (!sub.length) throw new Error('A git subcommand is required')
    if (GIT_BLOCKED_SUBCOMMANDS.includes(sub)) {
        throw new Error(`git ${sub} is permanently disabled in VibeFlow. Allowed subcommands: ${GIT_ALLOWED_SUBCOMMANDS.join(', ')}`)
    }
    if (!GIT_ALLOWED_SUBCOMMANDS.includes(sub)) {
        throw new Error(`git ${sub} is not allowed. Allowed subcommands: ${GIT_ALLOWED_SUBCOMMANDS.join(', ')}`)
    }
    const safeArgs = (args || []).filter((arg) => typeof arg === 'string')
    return await runExecutable(`git ${sub}${safeArgs.length ? ' ' + safeArgs.join(' ') : ''}`, 'git', [sub, ...safeArgs], options)
}

export const toErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message
    return typeof error === 'string' ? error : JSON.stringify(error)
}

/**
 * Build stdio parameters for an MCP server.
 * On Windows, `npx` / `uvx` are `.cmd` shims that cannot be spawned directly, so the
 * command is executed through `cmd.exe /c`, which keeps the MCP servers working on Windows,
 * Linux and macOS with the exact same configuration.
 */
export const buildMcpStdioParams = (command: string, args: string[] = [], extra: Record<string, unknown> = {}): Record<string, unknown> => {
    if (process.platform === 'win32') {
        const comSpec = process.env.ComSpec || 'cmd.exe'
        return { command: comSpec, args: ['/d', '/s', '/c', command, ...args], ...extra }
    }
    return { command, args, ...extra }
}

/** Split a free-form "extra arguments" input into an argv array. */
export const parseExtraArgs = (value: unknown): string[] => {
    if (typeof value !== 'string' || !value.trim().length) return []
    return (
        value
            .match(/"[^"]*"|'[^']*'|\S+/g)
            ?.map((token) => token.replace(/^["']|["']$/g, ''))
            .filter((token) => token.length > 0) ?? []
    )
}
