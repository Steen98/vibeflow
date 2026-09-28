import express from 'express'
import vibeflowDocStoreController from '../../controllers/vibeflow-docstore'

const router = express.Router()

// VibeFlow advanced document processing pipeline (Document Stores)
router.post('/:storeId/pipeline/preview', vibeflowDocStoreController.previewPipeline)
router.post('/:storeId/pipeline/jobs', vibeflowDocStoreController.startPipelineJob)
router.get('/:storeId/pipeline/jobs', vibeflowDocStoreController.listPipelineJobs)
router.get('/:storeId/pipeline/jobs/:jobId', vibeflowDocStoreController.getPipelineJob)
router.post('/:storeId/pipeline/jobs/:jobId/cancel', vibeflowDocStoreController.cancelPipelineJob)
router.get('/:storeId/pipeline/paths', vibeflowDocStoreController.getPipelinePaths)
router.post('/:storeId/pipeline/options', vibeflowDocStoreController.savePipelineOptions)
router.post('/:storeId/graph/sync', vibeflowDocStoreController.syncStoreGraph)

// Knowledge graph access (visualisation, search, traversal, engines)
router.get('/table', vibeflowDocStoreController.getEnrichedTable)
router.get('/graph/engines', vibeflowDocStoreController.getGraphEngines)
router.post('/graph/engines', vibeflowDocStoreController.getGraphEngines)
router.get('/:storeId/graph', vibeflowDocStoreController.getStoreGraph)
router.get('/:storeId/graph/search', vibeflowDocStoreController.searchStoreGraph)
router.get('/:storeId/graph/traverse/:nodeId', vibeflowDocStoreController.traverseStoreGraph)

export default router
