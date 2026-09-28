import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import vibeflowRetrievalService from '../../services/vibeflow-retrieval'

const requireParam = (value: string | undefined, message: string) => {
    if (!value) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, message)
    return value
}

const requireWorkspace = (req: Request) => {
    const workspaceId = req.user?.activeWorkspaceId
    if (!workspaceId) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, 'Active workspace not found')
    return workspaceId
}

const getStoreCapabilities = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowRetrievalController.getStoreCapabilities - storeId not provided!')
        return res.json(await vibeflowRetrievalService.getStoreCapabilities(storeId, requireWorkspace(req)))
    } catch (error) {
        next(error)
    }
}

const queryStore = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowRetrievalController.queryStore - storeId not provided!')
        if (!req.body?.query) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: vibeflowRetrievalController.queryStore - query not provided!'
            )
        }
        return res.json(
            await vibeflowRetrievalService.queryStore({
                storeId,
                workspaceId: requireWorkspace(req),
                query: req.body.query,
                options: req.body.options,
                engine: req.body.engine,
                neo4jConfig: req.body.neo4jConfig,
                generate: req.body.generate
            })
        )
    } catch (error) {
        next(error)
    }
}

export default {
    getStoreCapabilities,
    queryStore
}
