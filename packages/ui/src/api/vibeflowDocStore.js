import client from './client'

// VibeFlow Document Stores: advanced pipeline jobs, knowledge graph access
const getGraphEngines = (body) => client.post('/vibeflow-docstore/graph/engines', body || {})
const getStoreGraph = (storeId, params) => client.get(`/vibeflow-docstore/${storeId}/graph`, { params })
const searchStoreGraph = (storeId, query) => client.get(`/vibeflow-docstore/${storeId}/graph/search`, { params: { query } })
const traverseStoreGraph = (storeId, nodeId, params) => client.get(`/vibeflow-docstore/${storeId}/graph/traverse/${nodeId}`, { params })
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
