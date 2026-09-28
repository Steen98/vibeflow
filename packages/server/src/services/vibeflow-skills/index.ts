import { StatusCodes } from 'http-status-codes'
import {
    deleteSkill as deleteVibeFlowSkill,
    ensureSkillsRoot,
    getSkill,
    getSkillsStats,
    importSkillFromArchive,
    listSkills,
    setSkillEnabled
} from 'flowise-components'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'

const MAX_SKILL_ARCHIVE_BYTES = 32 * 1024 * 1024

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : JSON.stringify(error))

const getAllSkills = async () => {
    try {
        ensureSkillsRoot()
        return { data: listSkills(), stats: getSkillsStats() }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: vibeflowSkillsService.getAllSkills - ${toErrorMessage(error)}`
        )
    }
}

const getSkillById = async (id: string) => {
    try {
        const skill = getSkill(id)
        if (!skill) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Error: vibeflowSkillsService.getSkillById - skill ${id} not found`)
        }
        return skill
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: vibeflowSkillsService.getSkillById - ${toErrorMessage(error)}`
        )
    }
}

const importSkill = async (body: { contentBase64?: string; fileName?: string; id?: string }) => {
    try {
        const contentBase64 = (body?.contentBase64 || '').trim()
        if (!contentBase64.length) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: vibeflowSkillsService.importSkill - contentBase64 not provided!'
            )
        }
        const archive = Buffer.from(contentBase64, 'base64')
        if (!archive.length) {
            throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'Error: vibeflowSkillsService.importSkill - empty archive!')
        }
        if (archive.length > MAX_SKILL_ARCHIVE_BYTES) {
            throw new InternalFlowiseError(
                StatusCodes.BAD_REQUEST,
                `Error: vibeflowSkillsService.importSkill - archive exceeds ${Math.round(MAX_SKILL_ARCHIVE_BYTES / (1024 * 1024))} MB`
            )
        }
        ensureSkillsRoot()
        const skill = importSkillFromArchive(archive, { fileName: body.fileName, id: body.id })
        return { data: skill }
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Error: vibeflowSkillsService.importSkill - ${toErrorMessage(error)}`)
    }
}

const updateSkill = async (id: string, body: { enabled?: boolean }) => {
    try {
        if (typeof body?.enabled !== 'boolean') {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: vibeflowSkillsService.updateSkill - enabled (boolean) is required'
            )
        }
        ensureSkillsRoot()
        const skill = setSkillEnabled(id, body.enabled)
        return { data: skill }
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Error: vibeflowSkillsService.updateSkill - ${toErrorMessage(error)}`)
    }
}

const deleteSkill = async (id: string) => {
    try {
        ensureSkillsRoot()
        const result = deleteVibeFlowSkill(id)
        if (!result.deleted) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Error: vibeflowSkillsService.deleteSkill - skill ${id} not found`)
        }
        return result
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: vibeflowSkillsService.deleteSkill - ${toErrorMessage(error)}`
        )
    }
}

export default {
    getAllSkills,
    getSkillById,
    importSkill,
    updateSkill,
    deleteSkill
}
