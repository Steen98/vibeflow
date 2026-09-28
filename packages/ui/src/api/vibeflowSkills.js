import client from './client'

const getAllSkills = () => client.get('/vibeflow-skills')
const getSkillById = (id) => client.get(`/vibeflow-skills/${id}`)
const importSkill = (body) => client.post('/vibeflow-skills/import', body)
const updateSkill = (id, body) => client.put(`/vibeflow-skills/${id}`, body)
const deleteSkill = (id) => client.delete(`/vibeflow-skills/${id}`)

export default {
    getAllSkills,
    getSkillById,
    importSkill,
    updateSkill,
    deleteSkill
}
