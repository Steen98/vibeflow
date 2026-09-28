import {
    Bm25KeywordRetriever,
    GraphRetrieverAdapter,
    HeuristicQueryOptimizer,
    HeuristicQueryDecompositionAdapter,
    HeuristicQueryVariantGeneratorAdapter,
    HeuristicRerankerAdapter,
    RrfFusionAdapter,
    SemanticRetrieverAdapter,
    runHybridRetrieval,
    buildRetrievalPrompt,
    resolveGraphAdapter,
    type GraphEngine,
    type ICorpusDocument,
    type INeo4jConfig,
    type IHybridRetrievalOptions,
    type IRetrievalResult
} from 'flowise-components'
import { DocumentStore } from '../../database/entities/DocumentStore'
import { DocumentStoreFileChunk } from '../../database/entities/DocumentStoreFileChunk'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import documentStoreService from '../documentstore'
import { createChatModel } from '../vibeflow-docstore'

/**
 * VibeFlow — Hybrid retrieval service (M7).
 *
 * Wires the pipeline to the real Document Store artefacts:
 *  - lexical branch: BM25 over the chunks stored by Flowise (DocumentStoreFileChunk),
 *  - semantic branch: the Document Store's own embeddings + vector store (existing Flowise service);
 *    when they are not configured, the branch is reported as unavailable instead of failing silently,
 *  - graph branch: the VibeFlow knowledge graph adapter of the same Document Store.
 */

const toInternalError = (error: unknown, where: string) => {
    if (error instanceof InternalFlowiseError) return error
    return new InternalFlowiseError(500, `Error: vibeflowRetrievalService.${where} - ${getErrorMessage(error)}`)
}

const loadChunks = async (storeId: string, workspaceId: string): Promise<ICorpusDocument[]> => {
    const appServer = getRunningExpressApp()
    const chunks = await appServer.AppDataSource.getRepository(DocumentStoreFileChunk).find({
        where: { storeId },
        take: 5000
    })
    return chunks.map((chunk) => {
        let metadata: Record<string, unknown> = {}
        try {
            metadata = chunk.metadata ? JSON.parse(chunk.metadata) : {}
        } catch {
            metadata = {}
        }
        return {
            id: `${chunk.docId}:${chunk.chunkNo}`,
            content: chunk.pageContent || '',
            metadata: {
                ...metadata,
                documentId: chunk.docId,
                chunkId: `${chunk.docId}:${chunk.chunkNo}`,
                chunkNo: chunk.chunkNo
            }
        }
    })
}

const buildSemanticLookup = (
    store: DocumentStore,
    storeId: string
): { lookup?: (query: string, options: { limit: number }) => Promise<IRetrievalResult[]>; reason?: string } => {
    const hasEmbeddings = Boolean(store.embeddingConfig)
    const hasVectorStore = Boolean(store.vectorStoreConfig)
    if (!hasEmbeddings || !hasVectorStore) {
        return {
            reason: `Semantic retrieval is not available: ${hasEmbeddings ? '' : 'no embedding model configured'}${
                !hasEmbeddings && !hasVectorStore ? ' and ' : ''
            }${hasVectorStore ? '' : 'no vector store configured'}`
        }
    }

    const inputs = (() => {
        try {
            return store.vectorStoreConfig ? JSON.parse(store.vectorStoreConfig) : {}
        } catch {
            return {}
        }
    })()

    return {
        lookup: async (query: string, options: { limit: number }) => {
            // Reuse the existing Flowise service: embeddings + vector store are built by it
            const response: any = await documentStoreService.queryVectorStore({ query, storeId, inputs })
            const docs: any[] = response?.docs || []
            const timestamp = new Date().toISOString()
            return docs.slice(0, options.limit).map((doc, index) => ({
                id: `semantic:${doc.metadata?.chunkId || doc.metadata?.id || index}`,
                content: doc.pageContent || '',
                metadata: doc.metadata || {},
                score: typeof doc.score === 'number' ? doc.score : 1 / (index + 1),
                rank: index + 1,
                method: 'semantic' as const,
                scores: { semantic: typeof doc.score === 'number' ? doc.score : 1 / (index + 1) },
                provenance: {
                    document_id: doc.metadata?.documentId,
                    document_version: doc.metadata?.version,
                    source_id: doc.metadata?.sourceId,
                    segment_id: doc.metadata?.segmentId,
                    chunk_id: doc.metadata?.chunkId,
                    retrieval_method: 'semantic' as const,
                    score: typeof doc.score === 'number' ? doc.score : 1 / (index + 1),
                    timestamp
                }
            }))
        }
    }
}

export const getStoreCapabilities = async (storeId: string, workspaceId: string) => {
    try {
        const appServer = getRunningExpressApp()
        const store = await appServer.AppDataSource.getRepository(DocumentStore).findOneBy({ id: storeId, workspaceId })
        if (!store) throw new InternalFlowiseError(404, `Document store ${storeId} not found`)

        const chunks = await loadChunks(storeId, workspaceId)
        const keyword = new Bm25KeywordRetriever(chunks)
        const graphAdapter = await resolveGraphAdapter({ engine: 'graphology-local', documentStoreId: storeId })
        const graphStatus = await graphAdapter.isAvailable()
        const graphStatistics = graphStatus.available ? await graphAdapter.getStatistics() : null
        const semantic = buildSemanticLookup(store, storeId)

        return {
            data: {
                storeId,
                chunks: chunks.length,
                lexical: keyword.isAvailable(),
                semantic: semantic.lookup ? { available: true } : { available: false, reason: semantic.reason },
                graph: {
                    available: graphStatus.available && (graphStatistics?.nodes || 0) > 0,
                    reason: graphStatus.available
                        ? (graphStatistics?.nodes || 0) > 0
                            ? undefined
                            : 'The knowledge graph of this Document Store is empty'
                        : graphStatus.reason,
                    engine: graphAdapter.engine,
                    statistics: graphStatistics
                },
                adapters: {
                    queryOptimizer: new HeuristicQueryOptimizer().name,
                    decomposition: new HeuristicQueryDecompositionAdapter().name,
                    variants: new HeuristicQueryVariantGeneratorAdapter().name,
                    fusion: new RrfFusionAdapter().name,
                    reranker: new HeuristicRerankerAdapter().name
                }
            }
        }
    } catch (error) {
        throw toInternalError(error, 'getStoreCapabilities')
    }
}

export const queryStore = async (params: {
    storeId: string
    workspaceId: string
    query: string
    options?: IHybridRetrievalOptions
    engine?: GraphEngine
    neo4jConfig?: INeo4jConfig
    generate?: { name?: string; credentialId?: string; config?: Record<string, unknown> }
}) => {
    try {
        const appServer = getRunningExpressApp()
        const store = await appServer.AppDataSource.getRepository(DocumentStore).findOneBy({
            id: params.storeId,
            workspaceId: params.workspaceId
        })
        if (!store) throw new InternalFlowiseError(404, `Document store ${params.storeId} not found`)
        if (!params.query || !params.query.trim().length) {
            throw new InternalFlowiseError(412, 'A query is required')
        }

        const chunks = await loadChunks(params.storeId, params.workspaceId)
        const keywordRetriever = new Bm25KeywordRetriever(chunks)

        const semantic = buildSemanticLookup(store, params.storeId)
        const semanticRetriever = new SemanticRetrieverAdapter(semantic.lookup, semantic.reason)

        const graphAdapter = await resolveGraphAdapter({
            engine: params.engine || 'graphology-local',
            documentStoreId: params.storeId,
            neo4jConfig: params.neo4jConfig
        })
        const graphRetriever = new GraphRetrieverAdapter({
            search: async (query: string, limit: number) => {
                const found = await graphAdapter.searchGraph(query, { limit })
                return {
                    nodes: found.nodes.map((node) => ({
                        id: node.id as string,
                        name: node.name,
                        type: node.type,
                        documentId: node.documentId
                    }))
                }
            },
            traverse: async (nodeId: string, depth: number) => {
                const subgraph = await graphAdapter.traverseGraph(nodeId, { depth })
                return {
                    nodes: subgraph.nodes.map((node) => ({ id: node.id, attributes: node.attributes as Record<string, any> })),
                    relations: subgraph.relations.map((relation) => ({
                        id: relation.id,
                        source: relation.source,
                        target: relation.target,
                        attributes: relation.attributes as Record<string, any>
                    }))
                }
            }
        })

        const report = await runHybridRetrieval({
            query: params.query,
            optimizer: new HeuristicQueryOptimizer(),
            decomposition: new HeuristicQueryDecompositionAdapter(),
            variants: new HeuristicQueryVariantGeneratorAdapter(),
            semantic: semanticRetriever,
            keyword: keywordRetriever,
            graph: graphRetriever,
            fusion: new RrfFusionAdapter(),
            reranker: new HeuristicRerankerAdapter(),
            options: params.options
        })

        const prompt = report.trace.context
            ? buildRetrievalPrompt({ question: params.query, context: report.trace.context.text, sources: report.results })
            : undefined

        // Optional final generation step: the answer is produced by a real chat model chosen by
        // the user, from the built context. Without a model the prompt is returned instead.
        let answer: string | undefined
        let generationError: string | undefined
        let generationDurationMs: number | undefined
        if (params.generate?.name && prompt) {
            const startedAt = Date.now()
            try {
                const model = await createChatModel(params.generate)
                if (!model) throw new Error('The selected chat model could not be initialized')
                const response = await model.invoke([
                    { role: 'system', content: prompt.system },
                    { role: 'user', content: prompt.user }
                ])
                const content = (response as any)?.content
                answer =
                    typeof content === 'string'
                        ? content
                        : Array.isArray(content)
                          ? content.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('\n')
                          : ''
            } catch (error) {
                generationError = getErrorMessage(error)
            } finally {
                generationDurationMs = Date.now() - startedAt
            }
        }

        return {
            data: {
                results: report.results,
                trace: report.trace,
                prompt,
                answer,
                generationError,
                generationDurationMs,
                indexedChunks: chunks.length
            }
        }
    } catch (error) {
        throw toInternalError(error, 'queryStore')
    }
}

export default {
    getStoreCapabilities,
    queryStore
}
