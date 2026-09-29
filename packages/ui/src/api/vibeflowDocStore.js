import client from './client'

// VibeFlow Document Stores: advanced pipeline jobs, knowledge graph access
const getGraphEngines = (body) => client.post('/vibeflow-docstore/graph/engines', body || {})
const getGraphKnowledgeProviders = () => client.get('/vibeflow-docstore/components/graphknowledge')
// Graph reads use POST so an optional Neo4j connection travels in the JSON body, never in the URL.
const getStoreGraph = (storeId, body) => client.post(`/vibeflow-docstore/${storeId}/graph`, body || {})
const searchStoreGraph = (storeId, query, body) => client.post(`/vibeflow-docstore/${storeId}/graph/search`, { query, ...(body || {}) })
const traverseStoreGraph = (storeId, nodeId, body) => client.post(`/vibeflow-docstore/${storeId}/graph/traverse/${nodeId}`, body || {})
const getPipelinePaths = (storeId) => client.get(`/vibeflow-docstore/${storeId}/pipeline/paths`)
const getEnrichedTable = () => client.get('/vibeflow-docstore/table')
const savePipelineOptions = (storeId, body) => client.post(`/vibeflow-docstore/${storeId}/pipeline/options`, body || {})
const syncStoreGraph = (storeId, body) => client.post(`/vibeflow-docstore/${storeId}/graph/sync`, body || {})
const previewPipeline = (storeId, body) => client.post(`/vibeflow-docstore/${storeId}/pipeline/preview`, body || {})
const startPipelineJob = (storeId, body) => client.post(`/vibeflow-docstore/${storeId}/pipeline/jobs`, body || {})
const listPipelineJobs = (storeId) => client.get(`/vibeflow-docstore/${storeId}/pipeline/jobs`)
const getPipelineJob = (storeId, jobId) => client.get(`/vibeflow-docstore/${storeId}/pipeline/jobs/${jobId}`)
const cancelPipelineJob = (storeId, jobId) => client.post(`/vibeflow-docstore/${storeId}/pipeline/jobs/${jobId}/cancel`)

export default {
    cancelPipelineJob,
    getEnrichedTable,
    getGraphEngines,
    getGraphKnowledgeProviders,
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
