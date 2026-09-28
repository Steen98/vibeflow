import express from 'express'
import vibeflowChatBotController from '../../controllers/vibeflow-chatbot'

const router = express.Router()

// VibeFlow ChatBot: conversational execution layer for the existing workflows
router.get('/stats', vibeflowChatBotController.getStats)
router.get('/monitoring', vibeflowChatBotController.getMonitoring)

// Workspaces (working directories on the host machine)
router.get('/workspaces', vibeflowChatBotController.getWorkspaces)
router.post('/workspaces', vibeflowChatBotController.postWorkspace)
router.put('/workspaces/:id', vibeflowChatBotController.putWorkspace)
router.delete('/workspaces/:id', vibeflowChatBotController.deleteWorkspace)
router.get('/browse', vibeflowChatBotController.browse)

// Workflows that can be executed from the ChatBot (never a static list)
router.get('/workflows', vibeflowChatBotController.getWorkflows)

// Sessions
router.get('/sessions', vibeflowChatBotController.getSessions)
router.post('/sessions', vibeflowChatBotController.postSession)
router.get('/sessions/:id', vibeflowChatBotController.getSessionById)
router.put('/sessions/:id', vibeflowChatBotController.putSession)
router.delete('/sessions/:id', vibeflowChatBotController.deleteSession)

// Messages and bounded context
router.get('/sessions/:id/messages', vibeflowChatBotController.getMessages)
router.post('/sessions/:id/messages', vibeflowChatBotController.postMessage)
router.get('/sessions/:id/context', vibeflowChatBotController.getContext)

// Execution
router.get('/sessions/:id/executions', vibeflowChatBotController.getExecutions)
router.post('/sessions/:id/executions', vibeflowChatBotController.postExecution)
router.post('/sessions/:id/execute', vibeflowChatBotController.executeWorkflow)
router.post('/sessions/:id/executions/:executionId/stop', vibeflowChatBotController.stopExecution)

export default router
