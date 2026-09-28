import { Request } from 'express'
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
    updateWorkspace
} from 'flowise-components'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { MODE } from '../../Interface'
import { utilBuildChatflow } from '../../utils/buildChatflow'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

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

// ---------------------------------------------------------------------------
// Execution (delegated to the real Flowise prediction pipeline)
// ---------------------------------------------------------------------------

const executeWorkflow = async (
    req: Request,
    sessionId: string,
    body: {
        question?: string
        workflowId?: string
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

    const execution = createExecution(sessionId, {
        workflowId,
        messageId: userMessage.id,
        cancellationSupported: isQueueMode(),
        usedContextMessages: contextMessages.length
    })
    updateExecution(sessionId, execution.id, { status: 'RUNNING', startTime: new Date().toISOString() })

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
    getContext,
    getExecutions,
    getMessages,
    getSessionById,
    getSessions,
    getStats,
    getWorkflows,
    getWorkspaces,
    postMessage,
    postSession,
    postWorkspace,
    putSession,
    putWorkspace,
    stopExecution
}
