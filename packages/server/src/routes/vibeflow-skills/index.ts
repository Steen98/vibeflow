import express from 'express'
import vibeflowSkillsController from '../../controllers/vibeflow-skills'

const router = express.Router()

// VibeFlow skills registry: list, import (.zip / .skill), enable or disable, delete
router.get('/', vibeflowSkillsController.getAllSkills)
router.post('/import', vibeflowSkillsController.importSkill)
router.get('/:id', vibeflowSkillsController.getSkillById)
router.put('/:id', vibeflowSkillsController.updateSkill)
router.delete('/:id', vibeflowSkillsController.deleteSkill)

export default router
