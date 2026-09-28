import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import vibeflowDocStoreService from '../../services/vibeflow-docstore'

const requireParam = (value: string | undefined, message: string) => {
    if (!value) throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, message)
    return value
}

const getGraphEngines = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const neo4jConfig = req.body?.neo4jConfig
        return res.json(await vibeflowDocStoreService.getGraphEngines(neo4jConfig))
    } catch (error) {
        next(error)
    }
}

const getStoreGraph = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.getStoreGraph - storeId not provided!')
        return res.json(
            await vibeflowDocStoreService.getStoreGraph({
                storeId,
                engine: req.query?.engine as any,
                depth: req.query?.depth ? Number(req.query.depth) : undefined,
                limit: req.query?.limit ? Number(req.query.limit) : undefined,
                nodeIds: req.body?.nodeIds,
                neo4jConfig: req.body?.neo4jConfig
            })
        )
    } catch (error) {
        next(error)
    }
}

const searchStoreGraph = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.searchStoreGraph - storeId not provided!')
        return res.json(
            await vibeflowDocStoreService.searchStoreGraph({
                storeId,
                query: String(req.query?.query || ''),
                engine: req.query?.engine as any,
                limit: req.query?.limit ? Number(req.query.limit) : undefined,
                neo4jConfig: req.body?.neo4jConfig
            })
        )
    } catch (error) {
        next(error)
    }
}

const traverseStoreGraph = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.traverseStoreGraph - storeId not provided!')
        const nodeId = requireParam(req.params?.nodeId, 'Error: vibeflowDocStoreController.traverseStoreGraph - nodeId not provided!')
        return res.json(
            await vibeflowDocStoreService.traverseStoreGraph({
                storeId,
                nodeId,
                engine: req.query?.engine as any,
                depth: req.query?.depth ? Number(req.query.depth) : undefined,
                neo4jConfig: req.body?.neo4jConfig
            })
        )
    } catch (error) {
        next(error)
    }
}

const previewPipeline = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.previewPipeline - storeId not provided!')
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, 'Active workspace not found')
        }
        const { getRunningExpressApp } = await import('../../utils/getRunningExpressApp')
        const appServer = getRunningExpressApp()
        const report = await vibeflowDocStoreService.runAdvancedPipeline({
            appDataSource: appServer.AppDataSource,
            workspaceId,
            storeId,
            loaderId: req.body?.loaderId,
            options: req.body?.options
        })
        return res.json({ data: report })
    } catch (error) {
        next(error)
    }
}

const startPipelineJob = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.startPipelineJob - storeId not provided!')
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, 'Active workspace not found')
        }
        const { getRunningExpressApp } = await import('../../utils/getRunningExpressApp')
        const appServer = getRunningExpressApp()
        const job = await vibeflowDocStoreService.startAdvancedPipelineJob({
            appDataSource: appServer.AppDataSource,
            workspaceId,
            storeId,
            loaderId: req.body?.loaderId,
            options: req.body?.options
        })
        return res.json({ data: job })
    } catch (error) {
        next(error)
    }
}

const getPipelineJob = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const jobId = requireParam(req.params?.jobId, 'Error: vibeflowDocStoreController.getPipelineJob - jobId not provided!')
        const job = vibeflowDocStoreService.getJob(jobId)
        if (!job) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Job ${jobId} not found`)
        return res.json({ data: job })
    } catch (error) {
        next(error)
    }
}

const listPipelineJobs = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.listPipelineJobs - storeId not provided!')
        return res.json({ data: vibeflowDocStoreService.listJobs(storeId) })
    } catch (error) {
        next(error)
    }
}

const cancelPipelineJob = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const jobId = requireParam(req.params?.jobId, 'Error: vibeflowDocStoreController.cancelPipelineJob - jobId not provided!')
        return res.json({ data: vibeflowDocStoreService.cancelJob(jobId) })
    } catch (error) {
        next(error)
    }
}

const getPipelinePaths = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.getPipelinePaths - storeId not provided!')
        return res.json(await vibeflowDocStoreService.getStoreGraphPaths(storeId))
    } catch (error) {
        next(error)
    }
}

const getEnrichedTable = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, 'Active workspace not found')
        return res.json(await vibeflowDocStoreService.getEnrichedTable(workspaceId))
    } catch (error) {
        next(error)
    }
}

const syncStoreGraph = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.syncStoreGraph - storeId not provided!')
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, 'Active workspace not found')
        return res.json(await vibeflowDocStoreService.syncStoreGraph({ storeId, workspaceId, engine: req.body?.engine }))
    } catch (error) {
        next(error)
    }
}

const savePipelineOptions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const storeId = requireParam(req.params?.storeId, 'Error: vibeflowDocStoreController.savePipelineOptions - storeId not provided!')
        return res.json(await vibeflowDocStoreService.saveStorePipelineOptions(storeId, req.body || {}))
    } catch (error) {
        next(error)
    }
}

export default {
    cancelPipelineJob,
    getEnrichedTable,
    getGraphEngines,
    getPipelineJob,
    getPipelinePaths,
    getStoreGraph,
    listPipelineJobs,
    previewPipeline,
    savePipelineOptions,
    searchStoreGraph,
    startPipelineJob,
    syncStoreGraph,
    traverseStoreGraph
}
