import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import {
    appendMessage,
    browseHostDirectories,
    buildSessionContext,
    createExecution,
    createSession,
    createWorkspace,
    deleteSession as deleteVibeFlowSession,
    deleteWorkspace as deleteVibeFlowWorkspace,
    ensureChatBotRoot,
    getChatBotStats,
    getExecution,
    getSession,
    listExecutions,
    listMessages,
    listSessions,
    listWorkspaces,
    updateExecution,
    updateSession,
    updateWorkspace,
    getSpeechToTextCapabilities,
    transcribeAudio
} from 'flowise-components'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { MODE } from '../../Interface'
import { utilBuildChatflow } from '../../utils/buildChatflow'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { collectMonitoring } from './monitoring'

/**
 * VibeFlow ChatBot service.
 *
 * The ChatBot is a conversational execution layer on top of the existing Flowise workflows:
 * every execution is delegated to the real prediction pipeline (`utilBuildChatflow`, the same
 * function used by /api/v1/internal-predictions), so streaming, memory, analytics, queue mode,
 * tools and MCP servers behave exactly as they do in the native chat interface.
 */

const EXECUTABLE_WORKFLOW_TYPES = ['CHATFLOW', 'AGENTFLOW', 'MULTIAGENT']

const isQueueMode = (): boolean => process.env.MODE === MODE.QUEUE

/** Global upload size limit, used to validate attachments before handing them to the engine. */
const getUploadSizeLimitBytes = (): number => {
    const raw = process.env.FLOWISE_FILE_SIZE_LIMIT || process.env.FILE_SIZE_LIMIT || '50mb'
    const match = /^(\d+)\s*(b|kb|mb|gb)?$/i.exec(String(raw).trim())
    if (!match) return 50 * 1024 * 1024
    const value = Number(match[1])
    const unit = (match[2] || 'mb').toLowerCase()
    const factor = unit === 'b' ? 1 : unit === 'kb' ? 1024 : unit === 'gb' ? 1024 ** 3 : 1024 ** 2
    return value * factor
}

const validateUploads = (uploads?: any[]): void => {
    if (!Array.isArray(uploads) || !uploads.length) return
    const limit = getUploadSizeLimitBytes()
    for (const upload of uploads) {
        if (!upload?.name) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Every attachment must provide a name')
        }
        if (typeof upload.data === 'string') {
            const bytes = Math.floor((upload.data.length * 3) / 4)
            if (bytes > limit) {
                throw new InternalFlowiseError(
                    StatusCodes.BAD_REQUEST,
                    `Attachment "${upload.name}" exceeds the configured limit of ${Math.round(limit / (1024 * 1024))} MB`
                )
            }
        }
    }
}

const toInternalError = (error: unknown, where: string, status: StatusCodes = StatusCodes.INTERNAL_SERVER_ERROR) => {
    if (error instanceof InternalFlowiseError) return error
    return new InternalFlowiseError(status, `Error: vibeflowChatBotService.${where} - ${getErrorMessage(error)}`)
}

const getStats = async () => {
    try {
        ensureChatBotRoot()
        return { data: getChatBotStats(), queueMode: isQueueMode() }
    } catch (error) {
        throw toInternalError(error, 'getStats')
    }
}

// ---------------------------------------------------------------------------
// Workspaces (working directories on the host machine)
// ---------------------------------------------------------------------------

const getWorkspaces = async () => {
    try {
        ensureChatBotRoot()
        return { data: listWorkspaces() }
    } catch (error) {
        throw toInternalError(error, 'getWorkspaces')
    }
}

const postWorkspace = async (body: { name?: string; description?: string; workingDirectory?: string }) => {
    try {
        return {
            data: createWorkspace({ name: body?.name, description: body?.description, workingDirectory: body?.workingDirectory || '' })
        }
    } catch (error) {
        throw toInternalError(error, 'postWorkspace', StatusCodes.BAD_REQUEST)
    }
}

const putWorkspace = async (id: string, body: { name?: string; description?: string; workingDirectory?: string }) => {
    try {
        return { data: updateWorkspace(id, body || {}) }
    } catch (error) {
        throw toInternalError(error, 'putWorkspace', StatusCodes.BAD_REQUEST)
    }
}

const deleteWorkspaceById = async (id: string) => {
    try {
        return deleteVibeFlowWorkspace(id)
    } catch (error) {
        throw toInternalError(error, 'deleteWorkspaceById')
    }
}

const browse = async (targetPath?: string) => {
    try {
        return browseHostDirectories(targetPath)
    } catch (error) {
        throw toInternalError(error, 'browse', StatusCodes.BAD_REQUEST)
    }
}

// ---------------------------------------------------------------------------
// Workflows available to the ChatBot (never a static list)
// ---------------------------------------------------------------------------

const getWorkflows = async (workspaceId?: string, search?: string) => {
    try {
        const appServer = getRunningExpressApp()
        const queryBuilder = appServer.AppDataSource.getRepository(ChatFlow)
            .createQueryBuilder('chat_flow')
            .orderBy('chat_flow.updatedDate', 'DESC')
            .andWhere('chat_flow.type IN (:...types)', { types: EXECUTABLE_WORKFLOW_TYPES })

        if (workspaceId) queryBuilder.andWhere('chat_flow.workspaceId = :workspaceId', { workspaceId })
        if (search && search.trim().length) {
            queryBuilder.andWhere('LOWER(chat_flow.name) LIKE :search', { search: `%${search.trim().toLowerCase()}%` })
        }

        const flows = await queryBuilder.getMany()
        return {
            data: flows.map((flow) => ({
                id: flow.id,
                name: flow.name,
                type: flow.type,
                category: flow.category,
                deployed: flow.deployed,
                updatedDate: flow.updatedDate
            }))
        }
    } catch (error) {
        throw toInternalError(error, 'getWorkflows')
    }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const getSessions = async (filter: { workspaceId?: string; search?: string }) => {
    try {
        ensureChatBotRoot()
        return { data: listSessions(filter || {}) }
    } catch (error) {
        throw toInternalError(error, 'getSessions')
    }
}

const postSession = async (body: { title?: string; workspaceId?: string; defaultWorkflowId?: string; contextStrategy?: any }) => {
    try {
        return { data: createSession(body || {}) }
    } catch (error) {
        throw toInternalError(error, 'postSession', StatusCodes.BAD_REQUEST)
    }
}

const getSessionById = async (id: string) => {
    try {
        const session = getSession(id)
        if (!session) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Session ${id} not found`)
        return { data: session, context: buildSessionContext(id) }
    } catch (error) {
        throw toInternalError(error, 'getSessionById', StatusCodes.NOT_FOUND)
    }
}

const putSession = async (id: string, body: any) => {
    try {
        return { data: updateSession(id, body || {}) }
    } catch (error) {
        throw toInternalError(error, 'putSession', StatusCodes.BAD_REQUEST)
    }
}

const deleteSessionById = async (id: string) => {
    try {
        return deleteVibeFlowSession(id)
    } catch (error) {
        throw toInternalError(error, 'deleteSessionById')
    }
}

const getMessages = async (id: string, options: { limit?: number; beforeId?: string }) => {
    try {
        return listMessages(id, options || {})
    } catch (error) {
        throw toInternalError(error, 'getMessages', StatusCodes.NOT_FOUND)
    }
}

const postMessage = async (id: string, body: any) => {
    try {
        return { data: appendMessage(id, body || { role: 'user', content: '' }) }
    } catch (error) {
        throw toInternalError(error, 'postMessage', StatusCodes.BAD_REQUEST)
    }
}

const getContext = async (id: string, overrides: any) => {
    try {
        return buildSessionContext(id, overrides || {})
    } catch (error) {
        throw toInternalError(error, 'getContext', StatusCodes.NOT_FOUND)
    }
}

const getExecutions = async (id: string) => {
    try {
        return { data: listExecutions(id) }
    } catch (error) {
        throw toInternalError(error, 'getExecutions', StatusCodes.NOT_FOUND)
    }
}

/**
 * Pre-create an execution so the UI knows its id before the run completes: this is what makes
 * the "Stop" action usable while a prediction is still in flight.
 */
const postExecution = async (sessionId: string, body: { workflowId?: string; messageId?: string; usedContextMessages?: number }) => {
    try {
        const session = getSession(sessionId)
        if (!session) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Session ${sessionId} not found`)
        const workflowId = body?.workflowId || session.defaultWorkflowId
        if (!workflowId) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'No workflow selected for this session')
        return {
            data: createExecution(sessionId, {
                workflowId,
                messageId: body?.messageId,
                usedContextMessages: body?.usedContextMessages,
                cancellationSupported: isQueueMode()
            })
        }
    } catch (error) {
        throw toInternalError(error, 'postExecution', StatusCodes.BAD_REQUEST)
    }
}

/**
 * AI monitoring: CPU / RAM / GPU usage, provider balance (capability detected) and
 * the conversation context usage of a session. Unavailable metrics are reported as
 * unavailable together with the reason.
 */
const getMonitoring = async (sessionId?: string) => {
    try {
        return { data: await collectMonitoring(sessionId) }
    } catch (error) {
        throw toInternalError(error, 'getMonitoring')
    }
}

// ---------------------------------------------------------------------------
// Execution (delegated to the real Flowise prediction pipeline)
// ---------------------------------------------------------------------------

const executeWorkflow = async (
    req: Request,
    sessionId: string,
    body: {
        question?: string
        workflowId?: string
        executionId?: string
        attachments?: any[]
        transcription?: any
        overrideConfig?: any
        uploads?: any[]
        includeContext?: boolean
    }
) => {
    const session = getSession(sessionId)
    if (!session) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Session ${sessionId} not found`)

    const workflowId = body?.workflowId || session.defaultWorkflowId
    if (!workflowId) {
        throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'No workflow selected for this session')
    }

    const question = (body?.question || '').trim()
    if (!question.length) {
        throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'A question is required')
    }

    validateUploads(body?.uploads)

    // Bounded conversational context (never the whole history unless explicitly asked for)
    let contextMessages: { role: string; content: string }[] = []
    if (body?.includeContext) {
        contextMessages = buildSessionContext(sessionId).messages
    }

    const userMessage = appendMessage(sessionId, {
        role: 'user',
        content: question,
        attachments: body?.attachments || [],
        transcription: body?.transcription,
        workflowId,
        metadata: { workflowId, contextMessages: contextMessages.length }
    })

    // The UI may pre-create the execution (POST /sessions/:id/executions) so that "Stop" works
    // while the prediction is still running. Otherwise the execution is created here.
    const providedExecutionId = (body as any)?.executionId as string | undefined
    const preCreatedExecution = providedExecutionId ? getExecution(sessionId, providedExecutionId) : undefined
    if (providedExecutionId && !preCreatedExecution) {
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Execution ${providedExecutionId} not found`)
    }

    const execution =
        preCreatedExecution ||
        createExecution(sessionId, {
            workflowId,
            messageId: userMessage.id,
            cancellationSupported: isQueueMode(),
            usedContextMessages: contextMessages.length
        })
    updateExecution(sessionId, execution.id, {
        status: 'RUNNING',
        startTime: new Date().toISOString(),
        messageId: userMessage.id,
        workflowId,
        usedContextMessages: contextMessages.length
    })
    const contextualQuestion = contextMessages.length
        ? `${contextMessages
              .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
              .join('\n')}\nUser: ${question}`
        : question

    try {
        const predictionRequest = {
            ...req,
            params: { ...(req.params || {}), id: workflowId },
            body: {
                question: contextualQuestion,
                chatId: sessionId,
                streaming: false,
                ...(body?.overrideConfig ? { overrideConfig: body.overrideConfig } : {}),
                ...(body?.uploads ? { uploads: body.uploads } : {})
            }
        } as unknown as Request

        const prediction = await utilBuildChatflow(predictionRequest, true)
        const text = typeof prediction === 'string' ? prediction : (prediction as any)?.text ?? ''

        const assistantMessage = appendMessage(sessionId, {
            role: 'assistant',
            content: text,
            contentType: 'markdown',
            workflowId,
            executionId: execution.id,
            metadata: {
                usedTools: (prediction as any)?.usedTools,
                sourceDocuments: (prediction as any)?.sourceDocuments,
                agentFlowExecutedData: (prediction as any)?.agentFlowExecutedData,
                chatId: sessionId,
                workflowId
            }
        })

        const completed = updateExecution(sessionId, execution.id, { status: 'COMPLETED' })
        return {
            execution: completed,
            userMessage,
            assistantMessage,
            prediction: {
                text,
                usedTools: (prediction as any)?.usedTools,
                sourceDocuments: (prediction as any)?.sourceDocuments
            }
        }
    } catch (error) {
        const message = getErrorMessage(error)
        updateExecution(sessionId, execution.id, { status: 'FAILED', error: message })
        appendMessage(sessionId, {
            role: 'system',
            content: `Workflow execution failed: ${message}`,
            workflowId,
            executionId: execution.id,
            metadata: { workflowId, executionId: execution.id, error: true }
        })
        throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, message)
    }
}

// ---------------------------------------------------------------------------
// Capabilities (speech-to-text, uploads) — never advertise what is not configured
// ---------------------------------------------------------------------------

const getWorkflowCapabilities = async (workflowId: string) => {
    try {
        const appServer = getRunningExpressApp()
        const flow = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({ id: workflowId })
        if (!flow) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Workflow ${workflowId} not found`)
        return {
            data: {
                workflowId,
                type: flow.type,
                speechToText: getSpeechToTextCapabilities((flow as any).speechToText),
                uploads: { supported: true, maxFileSizeBytes: getUploadSizeLimitBytes() }
            }
        }
    } catch (error) {
        throw toInternalError(error, 'getWorkflowCapabilities', StatusCodes.NOT_FOUND)
    }
}

// ---------------------------------------------------------------------------
// Speech-to-text (recorder)
// ---------------------------------------------------------------------------

const transcribeAudioForSession = async (
    sessionId: string,
    body: { audioBase64?: string; mime?: string; fileName?: string; language?: string; workflowId?: string },
    orgId?: string
) => {
    const session = getSession(sessionId)
    if (!session) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Session ${sessionId} not found`)

    const workflowId = body?.workflowId || session.defaultWorkflowId
    if (!workflowId) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'No workflow selected for this session')
    if (!body?.audioBase64) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'audioBase64 is required')

    const buffer = Buffer.from(body.audioBase64, 'base64')
    if (!buffer.length) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'The provided audio is empty')

    const appServer = getRunningExpressApp()
    const flow = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({ id: workflowId })
    if (!flow) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Workflow ${workflowId} not found`)

    try {
        const result = await transcribeAudio({
            buffer,
            mime: body.mime || 'audio/webm',
            fileName: body.fileName || `vibeflow-recording-${Date.now()}.webm`,
            chatflowId: workflowId,
            chatId: sessionId,
            orgId,
            language: body.language,
            workflowSpeechToText: (flow as any).speechToText
        })
        return { data: result }
    } catch (error) {
        throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, getErrorMessage(error))
    }
}

// ---------------------------------------------------------------------------
// Streaming execution (SSE) — progressive rendering when the workflow supports it
// ---------------------------------------------------------------------------

const executeWorkflowStream = async (
    req: Request,
    res: Response,
    sessionId: string,
    body: {
        question?: string
        workflowId?: string
        executionId?: string
        uploads?: any[]
        overrideConfig?: any
        includeContext?: boolean
    }
) => {
    const session = getSession(sessionId)
    if (!session) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Session ${sessionId} not found`)

    const workflowId = body?.workflowId || session.defaultWorkflowId
    if (!workflowId) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'No workflow selected for this session')

    const question = (body?.question || '').trim()
    if (!question.length) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'A question is required')

    validateUploads(body?.uploads)

    const contextMessages = body?.includeContext ? buildSessionContext(sessionId).messages : []
    const userMessage = appendMessage(sessionId, {
        role: 'user',
        content: question,
        workflowId,
        metadata: { workflowId, contextMessages: contextMessages.length }
    })

    const providedExecutionId = body?.executionId
    const preCreated = providedExecutionId ? getExecution(sessionId, providedExecutionId) : undefined
    const execution =
        preCreated ||
        createExecution(sessionId, {
            workflowId,
            messageId: userMessage.id,
            cancellationSupported: isQueueMode(),
            usedContextMessages: contextMessages.length
        })
    updateExecution(sessionId, execution.id, {
        status: 'STREAMING',
        startTime: new Date().toISOString(),
        messageId: userMessage.id,
        workflowId
    })

    const appServer = getRunningExpressApp()
    const sseStreamer = (appServer as any).sseStreamer
    sseStreamer.addClient(sessionId, res)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const contextualQuestion = contextMessages.length
        ? `${contextMessages
              .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
              .join('\n')}\nUser: ${question}`
        : question

    try {
        const predictionRequest = {
            ...req,
            params: { ...(req.params || {}), id: workflowId },
            body: {
                question: contextualQuestion,
                chatId: sessionId,
                streaming: true,
                ...(body?.overrideConfig ? { overrideConfig: body.overrideConfig } : {}),
                ...(body?.uploads ? { uploads: body.uploads } : {})
            }
        } as unknown as Request

        const prediction = await utilBuildChatflow(predictionRequest, true)
        const text = typeof prediction === 'string' ? prediction : (prediction as any)?.text ?? ''

        const assistantMessage = appendMessage(sessionId, {
            role: 'assistant',
            content: text,
            contentType: 'markdown',
            workflowId,
            executionId: execution.id,
            metadata: {
                usedTools: (prediction as any)?.usedTools,
                sourceDocuments: (prediction as any)?.sourceDocuments,
                streaming: true,
                workflowId
            }
        })
        const completed = updateExecution(sessionId, execution.id, { status: 'COMPLETED' })
        sseStreamer.streamCustomEvent(sessionId, 'vibeflowChatBotDone', {
            userMessage,
            assistantMessage,
            execution: completed
        })
    } catch (error) {
        const message = getErrorMessage(error)
        updateExecution(sessionId, execution.id, { status: 'FAILED', error: message })
        const systemMessage = appendMessage(sessionId, {
            role: 'system',
            content: `Workflow execution failed: ${message}`,
            workflowId,
            executionId: execution.id,
            metadata: { error: true, workflowId }
        })
        sseStreamer.streamCustomEvent(sessionId, 'vibeflowChatBotError', { message, systemMessage })
    } finally {
        sseStreamer.removeClient(sessionId)
    }
}

const stopExecution = async (sessionId: string, executionId: string) => {
    const execution = getExecution(sessionId, executionId)
    if (!execution) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Execution ${executionId} not found`)

    updateExecution(sessionId, executionId, { status: 'CANCELLING' })

    const appServer = getRunningExpressApp()
    const pool = (appServer as any).abortControllerPool
    // Flowise keys running predictions as `${chatflowId}_${chatId}` (see PredictionQueue)
    const abortKey = `${execution.workflowId}_${sessionId}`
    const controller = pool?.get ? pool.get(abortKey) : undefined

    if (controller) {
        pool.abort(abortKey)
        updateExecution(sessionId, executionId, { status: 'CANCELLED', cancellationSupported: true })
        return {
            requested: true,
            cancelled: true,
            supported: true,
            message: 'Cancellation requested and propagated to the running task'
        }
    }

    updateExecution(sessionId, executionId, { status: 'RUNNING', cancellationSupported: false })
    return {
        requested: true,
        cancelled: false,
        supported: false,
        message:
            'Cancellation was requested but this deployment does not expose an abort handle for that run (queue mode disabled). The execution is still running.'
    }
}

export default {
    browse,
    deleteSessionById,
    deleteWorkspaceById,
    executeWorkflow,
    executeWorkflowStream,
    getContext,
    getExecutions,
    getMessages,
    getMonitoring,
    getSessionById,
    getSessions,
    getStats,
    getWorkflowCapabilities,
    getWorkflows,
    getWorkspaces,
    postExecution,
    postMessage,
    postSession,
    postWorkspace,
    putSession,
    putWorkspace,
    stopExecution,
    transcribeAudioForSession
}
