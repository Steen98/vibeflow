import express from 'express'
import vibeflowRetrievalController from '../../controllers/vibeflow-retrieval'

const router = express.Router()

// VibeFlow hybrid retrieval: capabilities and the full pipeline query (with trace)
router.get('/:storeId/capabilities', vibeflowRetrievalController.getStoreCapabilities)
router.post('/:storeId/query', vibeflowRetrievalController.queryStore)

export default router
