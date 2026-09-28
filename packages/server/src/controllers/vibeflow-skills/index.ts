import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import vibeflowSkillsService from '../../services/vibeflow-skills'

const getAllSkills = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const apiResponse = await vibeflowSkillsService.getAllSkills()
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const getSkillById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.params?.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: vibeflowSkillsController.getSkillById - id not provided!'
            )
        }
        const apiResponse = await vibeflowSkillsService.getSkillById(req.params.id)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const importSkill = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.body?.contentBase64) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: vibeflowSkillsController.importSkill - contentBase64 not provided!'
            )
        }
        const apiResponse = await vibeflowSkillsService.importSkill(req.body)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const updateSkill = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.params?.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: vibeflowSkillsController.updateSkill - id not provided!'
            )
        }
        const apiResponse = await vibeflowSkillsService.updateSkill(req.params.id, req.body)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const deleteSkill = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.params?.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: vibeflowSkillsController.deleteSkill - id not provided!'
            )
        }
        const apiResponse = await vibeflowSkillsService.deleteSkill(req.params.id)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

export default {
    getAllSkills,
    getSkillById,
    importSkill,
    updateSkill,
    deleteSkill
}
