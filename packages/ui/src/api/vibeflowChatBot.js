import client from './client'

// VibeFlow ChatBot: conversation session execution layer on top of the existing workflows
const getStats = () => client.get('/vibeflow-chatbot/stats')
const getMonitoring = (params) => client.get('/vibeflow-chatbot/monitoring', { params })

// Workspaces (working directories on the host machine)
const getWorkspaces = () => client.get('/vibeflow-chatbot/workspaces')
const createWorkspace = (body) => client.post('/vibeflow-chatbot/workspaces', body)
const updateWorkspace = (id, body) => client.put(`/vibeflow-chatbot/workspaces/${id}`, body)
const deleteWorkspace = (id) => client.delete(`/vibeflow-chatbot/workspaces/${id}`)
const browse = (path) => client.get('/vibeflow-chatbot/browse', { params: { path } })

// Workflows available for execution (dynamic, never a static list)
const getWorkflows = (search) => client.get('/vibeflow-chatbot/workflows', { params: { search } })
const getWorkflowCapabilities = (id) => client.get(`/vibeflow-chatbot/workflows/${id}/capabilities`)
const transcribe = (sessionId, body) => client.post(`/vibeflow-chatbot/sessions/${sessionId}/transcribe`, body)

// Sessions
const getSessions = (params) => client.get('/vibeflow-chatbot/sessions', { params })
const createSession = (body) => client.post('/vibeflow-chatbot/sessions', body)
const getSession = (id) => client.get(`/vibeflow-chatbot/sessions/${id}`)
const updateSession = (id, body) => client.put(`/vibeflow-chatbot/sessions/${id}`, body)
const deleteSession = (id) => client.delete(`/vibeflow-chatbot/sessions/${id}`)

// Messages, bounded context and executions
const getMessages = (id, params) => client.get(`/vibeflow-chatbot/sessions/${id}/messages`, { params })
const getContext = (id) => client.get(`/vibeflow-chatbot/sessions/${id}/context`)
const getExecutions = (id) => client.get(`/vibeflow-chatbot/sessions/${id}/executions`)
const executeWorkflow = (id, body) => client.post(`/vibeflow-chatbot/sessions/${id}/execute`, body)
const createExecution = (id, body) => client.post(`/vibeflow-chatbot/sessions/${id}/executions`, body || {})
const stopExecution = (sessionId, executionId) => client.post(`/vibeflow-chatbot/sessions/${sessionId}/executions/${executionId}/stop`)

export default {
    browse,
    createExecution,
    createSession,
    createWorkspace,
    deleteSession,
    deleteWorkspace,
    executeWorkflow,
    getContext,
    getExecutions,
    getMessages,
    getMonitoring,
    getSession,
    getSessions,
    getStats,
    getWorkflowCapabilities,
    getWorkflows,
    getWorkspaces,
    stopExecution,
    transcribe,
    updateSession,
    updateWorkspace
}
