import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import vibeflowChatBotService from '../../services/vibeflow-chatbot'

const requireParam = (value: string | undefined, message: string) => {
    if (!value) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, message)
    return value
}

const getStats = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json(await vibeflowChatBotService.getStats())
    } catch (error) {
        next(error)
    }
}

// ------------------------------- workspaces -------------------------------

const getWorkspaces = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json(await vibeflowChatBotService.getWorkspaces())
    } catch (error) {
        next(error)
    }
}

const postWorkspace = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json(await vibeflowChatBotService.postWorkspace(req.body))
    } catch (error) {
        next(error)
    }
}

const putWorkspace = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.putWorkspace - id not provided!')
        return res.json(await vibeflowChatBotService.putWorkspace(id, req.body))
    } catch (error) {
        next(error)
    }
}

const deleteWorkspace = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.deleteWorkspace - id not provided!')
        return res.json(await vibeflowChatBotService.deleteWorkspaceById(id))
    } catch (error) {
        next(error)
    }
}

const browse = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const targetPath = typeof req.query?.path === 'string' ? req.query.path : undefined
        return res.json(await vibeflowChatBotService.browse(targetPath))
    } catch (error) {
        next(error)
    }
}

// -------------------------------- workflows -------------------------------

const getWorkflows = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const workspaceId = req.user?.activeWorkspaceId
        const search = typeof req.query?.search === 'string' ? req.query.search : undefined
        return res.json(await vibeflowChatBotService.getWorkflows(workspaceId, search))
    } catch (error) {
        next(error)
    }
}

// -------------------------------- sessions --------------------------------

const getSessions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const workspaceId = typeof req.query?.workspaceId === 'string' ? req.query.workspaceId : undefined
        const search = typeof req.query?.search === 'string' ? req.query.search : undefined
        return res.json(await vibeflowChatBotService.getSessions({ workspaceId, search }))
    } catch (error) {
        next(error)
    }
}

const postSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        return res.json(await vibeflowChatBotService.postSession(req.body))
    } catch (error) {
        next(error)
    }
}

const getSessionById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.getSessionById - id not provided!')
        return res.json(await vibeflowChatBotService.getSessionById(id))
    } catch (error) {
        next(error)
    }
}

const putSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.putSession - id not provided!')
        return res.json(await vibeflowChatBotService.putSession(id, req.body))
    } catch (error) {
        next(error)
    }
}

const deleteSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.deleteSession - id not provided!')
        return res.json(await vibeflowChatBotService.deleteSessionById(id))
    } catch (error) {
        next(error)
    }
}

const getMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.getMessages - id not provided!')
        const limit = req.query?.limit ? Number(req.query.limit) : undefined
        const beforeId = typeof req.query?.beforeId === 'string' ? req.query.beforeId : undefined
        return res.json(await vibeflowChatBotService.getMessages(id, { limit, beforeId }))
    } catch (error) {
        next(error)
    }
}

const postMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.postMessage - id not provided!')
        return res.json(await vibeflowChatBotService.postMessage(id, req.body))
    } catch (error) {
        next(error)
    }
}

const getContext = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.getContext - id not provided!')
        return res.json(await vibeflowChatBotService.getContext(id, req.body || {}))
    } catch (error) {
        next(error)
    }
}

const getExecutions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.getExecutions - id not provided!')
        return res.json(await vibeflowChatBotService.getExecutions(id))
    } catch (error) {
        next(error)
    }
}

// -------------------------------- execution -------------------------------

const executeWorkflow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.executeWorkflow - id not provided!')
        return res.json(await vibeflowChatBotService.executeWorkflow(req, id, req.body))
    } catch (error) {
        next(error)
    }
}

const stopExecution = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = requireParam(req.params?.id, 'Error: vibeflowChatBotController.stopExecution - session id not provided!')
        const executionId = requireParam(
            req.params?.executionId,
            'Error: vibeflowChatBotController.stopExecution - execution id not provided!'
        )
        return res.json(await vibeflowChatBotService.stopExecution(id, executionId))
    } catch (error) {
        next(error)
    }
}

export default {
    browse,
    deleteSession,
    deleteWorkspace,
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
