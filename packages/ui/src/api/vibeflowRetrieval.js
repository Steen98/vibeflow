import client from './client'

// VibeFlow hybrid retrieval (Test RAG)
const getStoreCapabilities = (storeId) => client.get(`/vibeflow-retrieval/${storeId}/capabilities`)
const queryStore = (storeId, body) => client.post(`/vibeflow-retrieval/${storeId}/query`, body || {})

export default {
    getStoreCapabilities,
    queryStore
}
