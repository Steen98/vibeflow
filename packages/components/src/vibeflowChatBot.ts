import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'

/**
 * VibeFlow ChatBot store.
 *
 * The ChatBot is an execution layer on top of the existing Flowise workflows: it never
 * replaces them. This module owns the conversational state only:
 *
 *   Workspace  -> a working directory on the host machine (browse / select / reuse)
 *     └── ChatSession  -> an optional workspace, an optional default workflow, a context strategy
 *           ├── UserMessage / AssistantMessage / SystemMessage (paginated)
 *           └── WorkflowExecution (QUEUED, RUNNING, STREAMING, COMPLETED, FAILED, CANCELLING, CANCELLED)
 *
 * Storage is file based (one file per session + one index) so it works identically in the
 * open source, cloud and enterprise editions, without any database migration. The API is
 * intentionally storage agnostic: swapping it for TypeORM entities later does not change
 * the service signatures.
 */

export const VIBEFLOW_CHATBOT_PATH_ENV = 'VIBEFLOW_CHATBOT_PATH'
export const VIBEFLOW_MAX_CONTEXT_MESSAGES = 20

export interface IVibeFlowWorkspace {
    id: string
    name: string
    description?: string
    workingDirectory: string
    createdAt: string
    updatedAt: string
}

export interface IVibeFlowContextStrategy {
    maxPreviousMessages: number
    windowTurns: number
    summarization: boolean
    dynamicSelection: boolean
}

export interface IVibeFlowChatSession {
    id: string
    title: string
    titleOrigin: 'auto' | 'user'
    workspaceId?: string
    defaultWorkflowId?: string
    contextStrategy: IVibeFlowContextStrategy
    createdAt: string
    lastActivityAt: string
    messageCount: number
}

export interface IVibeFlowAttachment {
    name: string
    type?: string
    size?: number
    status?: 'pending' | 'uploaded' | 'rejected'
    reference?: string
    error?: string
}

export interface IVibeFlowTranscription {
    text: string
    engine: string
    language?: string
    durationMs?: number
}

export interface IVibeFlowChatMessage {
    id: string
    sessionId: string
    role: 'user' | 'assistant' | 'system'
    content: string
    contentType: 'text' | 'markdown' | 'json'
    workflowId?: string
    executionId?: string
    attachments: IVibeFlowAttachment[]
    transcription?: IVibeFlowTranscription
    createdAt: string
    metadata?: Record<string, unknown>
}

export type IVibeFlowExecutionStatus = 'QUEUED' | 'RUNNING' | 'STREAMING' | 'COMPLETED' | 'FAILED' | 'CANCELLING' | 'CANCELLED'

export interface IVibeFlowExecution {
    id: string
    sessionId: string
    messageId?: string
    workflowId: string
    status: IVibeFlowExecutionStatus
    requestedAt: string
    startTime?: string
    endTime?: string
    durationMs?: number
    error?: string
    cancellationSupported?: boolean
    usedContextMessages?: number
}

interface ISessionFile {
    session: IVibeFlowChatSession
    messages: IVibeFlowChatMessage[]
    executions: IVibeFlowExecution[]
}

interface ISessionIndex {
    sessions: Record<string, IVibeFlowChatSession>
}

interface IWorkspaceFile {
    workspaces: Record<string, IVibeFlowWorkspace>
}

export const getChatBotRoot = (): string => {
    const configured = process.env[VIBEFLOW_CHATBOT_PATH_ENV]
    if (configured && configured.trim().length) return path.resolve(configured.trim())
    const storageRoot = process.env.BLOB_STORAGE_PATH || path.join(os.homedir(), '.flowise')
    return path.join(path.resolve(storageRoot), 'vibeflow-chatbot')
}

const ensureRoot = (): string => {
    const root = getChatBotRoot()
    mkdirSync(path.join(root, 'sessions'), { recursive: true })
    return root
}

const workspaceFilePath = (): string => path.join(ensureRoot(), 'workspaces.json')
const sessionIndexPath = (): string => path.join(ensureRoot(), 'sessions', 'index.json')
const sessionFilePath = (id: string): string => path.join(ensureRoot(), 'sessions', `${id}.json`)

const readJson = <T>(filePath: string, fallback: T): T => {
    if (!existsSync(filePath)) return fallback
    try {
        return JSON.parse(readFileSync(filePath, 'utf8')) as T
    } catch {
        return fallback
    }
}

const writeJson = (filePath: string, value: unknown): void => {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

export const createId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

// ---------------------------------------------------------------------------
// Workspaces (working directories on the host machine)
// ---------------------------------------------------------------------------

export const listWorkspaces = (): IVibeFlowWorkspace[] => {
    const file = readJson<IWorkspaceFile>(workspaceFilePath(), { workspaces: {} })
    return Object.values(file.workspaces)
        .map((workspace) => ({ ...workspace }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

export const getWorkspace = (id: string): IVibeFlowWorkspace | undefined => {
    return readJson<IWorkspaceFile>(workspaceFilePath(), { workspaces: {} }).workspaces[id]
}

export const createWorkspace = (payload: { name?: string; description?: string; workingDirectory: string }): IVibeFlowWorkspace => {
    if (!payload?.workingDirectory || !payload.workingDirectory.trim().length) {
        throw new Error('workingDirectory is required')
    }
    const directory = path.resolve(payload.workingDirectory.trim())
    if (!existsSync(directory)) throw new Error(`Directory not found: ${directory}`)
    if (!statSync(directory).isDirectory()) throw new Error(`Not a directory: ${directory}`)

    const file = readJson<IWorkspaceFile>(workspaceFilePath(), { workspaces: {} })
    const now = new Date().toISOString()
    const workspace: IVibeFlowWorkspace = {
        id: createId('ws'),
        name: payload.name && payload.name.trim().length ? payload.name.trim() : path.basename(directory) || directory,
        description: payload.description,
        workingDirectory: directory,
        createdAt: now,
        updatedAt: now
    }
    file.workspaces[workspace.id] = workspace
    writeJson(workspaceFilePath(), file)
    return workspace
}

export const updateWorkspace = (
    id: string,
    patch: { name?: string; description?: string; workingDirectory?: string }
): IVibeFlowWorkspace => {
    const file = readJson<IWorkspaceFile>(workspaceFilePath(), { workspaces: {} })
    const workspace = file.workspaces[id]
    if (!workspace) throw new Error(`Workspace ${id} not found`)
    if (patch?.name !== undefined) workspace.name = patch.name
    if (patch?.description !== undefined) workspace.description = patch.description
    if (patch?.workingDirectory !== undefined) {
        const directory = path.resolve(patch.workingDirectory)
        if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`Directory not found: ${directory}`)
        workspace.workingDirectory = directory
    }
    workspace.updatedAt = new Date().toISOString()
    writeJson(workspaceFilePath(), file)
    return workspace
}

export const deleteWorkspace = (id: string): { id: string; deleted: boolean; unassignedSessions: number } => {
    const file = readJson<IWorkspaceFile>(workspaceFilePath(), { workspaces: {} })
    if (!file.workspaces[id]) return { id, deleted: false, unassignedSessions: 0 }
    delete file.workspaces[id]
    writeJson(workspaceFilePath(), file)

    const index = readJson<ISessionIndex>(sessionIndexPath(), { sessions: {} })
    let unassigned = 0
    for (const session of Object.values(index.sessions)) {
        if (session.workspaceId === id) {
            session.workspaceId = undefined
            unassigned += 1
            writeJson(sessionFilePath(session.id), { ...readSessionFile(session.id), session })
        }
    }
    if (unassigned) writeJson(sessionIndexPath(), index)
    return { id, deleted: true, unassignedSessions: unassigned }
}

export interface IDirectoryEntry {
    name: string
    path: string
    isDirectory: boolean
    size?: number
    modifiedAt?: string
}

/** Browse the host file system to pick the working directory of a workspace. */
export const browseHostDirectories = (target?: string): { path: string; parent: string | null; entries: IDirectoryEntry[] } => {
    if (!target || !target.trim().length) {
        if (process.platform === 'win32') {
            const drives: IDirectoryEntry[] = []
            for (let code = 65; code <= 90; code++) {
                const drive = `${String.fromCharCode(code)}:\\`
                if (existsSync(drive)) drives.push({ name: drive, path: drive, isDirectory: true })
            }
            return { path: '', parent: null, entries: drives }
        }
        return { path: '', parent: null, entries: [{ name: '/', path: '/', isDirectory: true }] }
    }

    const directory = path.resolve(target)
    if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`Directory not found: ${directory}`)

    const entries: IDirectoryEntry[] = []
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.') && entry.name !== '.vibeflow') continue
        const entryPath = path.join(directory, entry.name)
        let modifiedAt: string | undefined
        try {
            modifiedAt = statSync(entryPath).mtime.toISOString()
        } catch {
            /* ignored */
        }
        entries.push({ name: entry.name, path: entryPath, isDirectory: true, modifiedAt })
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))

    const parsed = path.parse(directory)
    const parent = directory === parsed.root ? null : path.dirname(directory)
    return { path: directory, parent, entries }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const readSessionIndex = (): ISessionIndex => readJson<ISessionIndex>(sessionIndexPath(), { sessions: {} })

const readSessionFile = (id: string): ISessionFile =>
    readJson<ISessionFile>(sessionFilePath(id), { session: undefined as any, messages: [], executions: [] })

const writeSessionFile = (file: ISessionFile): void => writeJson(sessionFilePath(file.session.id), file)

export const defaultContextStrategy = (): IVibeFlowContextStrategy => ({
    maxPreviousMessages: VIBEFLOW_MAX_CONTEXT_MESSAGES,
    windowTurns: VIBEFLOW_MAX_CONTEXT_MESSAGES,
    summarization: false,
    dynamicSelection: false
})

export const listSessions = (filter: { workspaceId?: string; search?: string } = {}): IVibeFlowChatSession[] => {
    const index = readSessionIndex()
    let sessions = Object.values(index.sessions)
    if (filter.workspaceId !== undefined) {
        sessions = sessions.filter((session) => (filter.workspaceId ? session.workspaceId === filter.workspaceId : !session.workspaceId))
    }
    if (filter.search && filter.search.trim().length) {
        const needle = filter.search.trim().toLowerCase()
        sessions = sessions.filter((session) => session.title.toLowerCase().includes(needle))
    }
    return sessions.map((session) => ({ ...session })).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
}

export const getSession = (id: string): IVibeFlowChatSession | undefined => readSessionIndex().sessions[id]

export const createSession = (
    payload: { title?: string; workspaceId?: string; defaultWorkflowId?: string; contextStrategy?: Partial<IVibeFlowContextStrategy> } = {}
): IVibeFlowChatSession => {
    ensureRoot()
    if (payload.workspaceId && !getWorkspace(payload.workspaceId)) {
        throw new Error(`Workspace ${payload.workspaceId} not found`)
    }
    const index = readSessionIndex()
    const now = new Date().toISOString()
    const session: IVibeFlowChatSession = {
        id: createId('sess'),
        title: payload.title && payload.title.trim().length ? payload.title.trim() : 'New session',
        titleOrigin: payload.title && payload.title.trim().length ? 'user' : 'auto',
        workspaceId: payload.workspaceId,
        defaultWorkflowId: payload.defaultWorkflowId,
        contextStrategy: { ...defaultContextStrategy(), ...(payload.contextStrategy || {}) },
        createdAt: now,
        lastActivityAt: now,
        messageCount: 0
    }
    index.sessions[session.id] = session
    writeJson(sessionIndexPath(), index)
    writeSessionFile({ session, messages: [], executions: [] })
    return session
}

export const updateSession = (
    id: string,
    patch: {
        title?: string
        workspaceId?: string | null
        defaultWorkflowId?: string | null
        contextStrategy?: Partial<IVibeFlowContextStrategy>
    }
): IVibeFlowChatSession => {
    const index = readSessionIndex()
    const session = index.sessions[id]
    if (!session) throw new Error(`Session ${id} not found`)
    if (patch.title !== undefined) {
        session.title = patch.title
        session.titleOrigin = 'user'
    }
    if (patch.workspaceId !== undefined) {
        if (patch.workspaceId && !getWorkspace(patch.workspaceId)) throw new Error(`Workspace ${patch.workspaceId} not found`)
        session.workspaceId = patch.workspaceId || undefined
    }
    if (patch.defaultWorkflowId !== undefined) session.defaultWorkflowId = patch.defaultWorkflowId || undefined
    if (patch.contextStrategy) session.contextStrategy = { ...session.contextStrategy, ...patch.contextStrategy }
    session.lastActivityAt = new Date().toISOString()
    index.sessions[id] = session
    writeJson(sessionIndexPath(), index)
    const file = readSessionFile(id)
    writeSessionFile({ ...file, session })
    return session
}

export const deleteSession = (id: string): { id: string; deleted: boolean } => {
    const index = readSessionIndex()
    if (!index.sessions[id]) return { id, deleted: false }
    delete index.sessions[id]
    writeJson(sessionIndexPath(), index)
    const filePath = sessionFilePath(id)
    if (existsSync(filePath)) rmSync(filePath, { force: true })
    return { id, deleted: true }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const appendMessage = (
    sessionId: string,
    payload: {
        role: IVibeFlowChatMessage['role']
        content: string
        contentType?: IVibeFlowChatMessage['contentType']
        workflowId?: string
        executionId?: string
        attachments?: IVibeFlowAttachment[]
        transcription?: IVibeFlowTranscription
        metadata?: Record<string, unknown>
    }
): IVibeFlowChatMessage => {
    const index = readSessionIndex()
    const session = index.sessions[sessionId]
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const file = readSessionFile(sessionId)
    const message: IVibeFlowChatMessage = {
        id: createId('msg'),
        sessionId,
        role: payload.role,
        content: payload.content ?? '',
        contentType: payload.contentType || 'text',
        workflowId: payload.workflowId,
        executionId: payload.executionId,
        attachments: payload.attachments || [],
        transcription: payload.transcription,
        createdAt: new Date().toISOString(),
        metadata: payload.metadata
    }
    file.messages.push(message)
    writeSessionFile(file)

    session.messageCount = file.messages.length
    session.lastActivityAt = message.createdAt
    if (session.titleOrigin === 'auto' && payload.role === 'user' && payload.content.trim().length) {
        session.title = payload.content.trim().slice(0, 60)
    }
    index.sessions[sessionId] = session
    writeJson(sessionIndexPath(), index)
    return message
}

/**
 * Paginated read: `limit` last messages, optionally older than `beforeId`
 * (used by the "load older messages" scroll behaviour).
 */
export const listMessages = (
    sessionId: string,
    options: { limit?: number; beforeId?: string } = {}
): { data: IVibeFlowChatMessage[]; hasMore: boolean; total: number } => {
    const file = readSessionFile(sessionId)
    const limit = options.limit && options.limit > 0 ? options.limit : 50
    let messages = file.messages
    if (options.beforeId) {
        const position = messages.findIndex((message) => message.id === options.beforeId)
        if (position > -1) messages = messages.slice(0, position)
    }
    const start = Math.max(0, messages.length - limit)
    return {
        data: messages.slice(start).map((message) => ({ ...message })),
        hasMore: start > 0,
        total: file.messages.length
    }
}

export const updateMessage = (sessionId: string, messageId: string, patch: Partial<IVibeFlowChatMessage>): IVibeFlowChatMessage => {
    const file = readSessionFile(sessionId)
    const message = file.messages.find((item) => item.id === messageId)
    if (!message) throw new Error(`Message ${messageId} not found`)
    Object.assign(message, patch, { id: message.id, sessionId: message.sessionId })
    writeSessionFile(file)
    return message
}

export const deleteMessage = (sessionId: string, messageId: string): { deleted: boolean } => {
    const file = readSessionFile(sessionId)
    const before = file.messages.length
    file.messages = file.messages.filter((message) => message.id !== messageId)
    if (file.messages.length === before) return { deleted: false }
    writeSessionFile(file)
    const index = readSessionIndex()
    if (index.sessions[sessionId]) {
        index.sessions[sessionId].messageCount = file.messages.length
        writeJson(sessionIndexPath(), index)
    }
    return { deleted: true }
}

// ---------------------------------------------------------------------------
// Executions
// ---------------------------------------------------------------------------

export const createExecution = (
    sessionId: string,
    payload: { workflowId: string; messageId?: string; cancellationSupported?: boolean; usedContextMessages?: number }
): IVibeFlowExecution => {
    const file = readSessionFile(sessionId)
    if (!file.session) throw new Error(`Session ${sessionId} not found`)
    const execution: IVibeFlowExecution = {
        id: createId('exec'),
        sessionId,
        messageId: payload.messageId,
        workflowId: payload.workflowId,
        status: 'QUEUED',
        requestedAt: new Date().toISOString(),
        cancellationSupported: payload.cancellationSupported,
        usedContextMessages: payload.usedContextMessages
    }
    file.executions.push(execution)
    writeSessionFile(file)
    return execution
}

export const updateExecution = (sessionId: string, executionId: string, patch: Partial<IVibeFlowExecution>): IVibeFlowExecution => {
    const file = readSessionFile(sessionId)
    const execution = file.executions.find((item) => item.id === executionId)
    if (!execution) throw new Error(`Execution ${executionId} not found`)
    Object.assign(execution, patch, { id: execution.id, sessionId: execution.sessionId })
    if ((patch.status === 'COMPLETED' || patch.status === 'FAILED' || patch.status === 'CANCELLED') && !execution.endTime) {
        execution.endTime = new Date().toISOString()
        if (execution.startTime) {
            execution.durationMs = new Date(execution.endTime).getTime() - new Date(execution.startTime).getTime()
        }
    }
    writeSessionFile(file)
    return execution
}

export const listExecutions = (sessionId: string, limit = 50): IVibeFlowExecution[] => {
    const file = readSessionFile(sessionId)
    return file.executions.slice(-limit).map((execution) => ({ ...execution }))
}

export const getExecution = (sessionId: string, executionId: string): IVibeFlowExecution | undefined =>
    readSessionFile(sessionId).executions.find((execution) => execution.id === executionId)

// ---------------------------------------------------------------------------
// Conversation context (never dumps the whole history by default)
// ---------------------------------------------------------------------------

export const buildSessionContext = (
    sessionId: string,
    overrides: Partial<IVibeFlowContextStrategy> = {}
): { messages: { role: string; content: string }[]; strategy: IVibeFlowContextStrategy; totalMessages: number } => {
    const session = getSession(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const strategy = { ...session.contextStrategy, ...overrides }
    const file = readSessionFile(sessionId)
    const conversational = file.messages.filter((message) => message.role !== 'system')
    const max = strategy.maxPreviousMessages > 0 ? strategy.maxPreviousMessages : VIBEFLOW_MAX_CONTEXT_MESSAGES
    const selected = conversational.slice(-max)
    return {
        messages: selected.map((message) => ({ role: message.role, content: message.content })),
        strategy,
        totalMessages: file.messages.length
    }
}

export const getChatBotStats = (): { workspaces: number; sessions: number; messages: number; root: string } => {
    const root = getChatBotRoot()
    const sessions = listSessions()
    let messages = 0
    for (const session of sessions) {
        messages += session.messageCount
    }
    return { workspaces: listWorkspaces().length, sessions: sessions.length, messages, root }
}

export const ensureChatBotRoot = (): string => ensureRoot()
