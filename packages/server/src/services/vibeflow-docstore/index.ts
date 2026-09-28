import { DataSource } from 'typeorm'
import { StatusCodes } from 'http-status-codes'
import { Document } from '@langchain/core/documents'
import { v4 as uuidv4 } from 'uuid'
import {
    buildDocumentVersion,
    buildStructuralKnowledgeGraph,
    buildSummaryPrompt,
    cleanMarkdown,
    countWords,
    describeGraphEngines,
    fractionatePages,
    getDocumentStoreTmpDir,
    makeProvenance,
    parseSummaryForGraph,
    resolveGraphAdapter,
    writeSegmentBackups,
    type GraphEngine,
    type IGraphEntity,
    type IGraphRelation,
    type INeo4jConfig,
    type IPageText,
    type ISegment
} from 'flowise-components'
import { DocumentStore } from '../../database/entities/DocumentStore'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { databaseEntities } from '../../utils'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import logger from '../../utils/logger'

/**
 * VibeFlow — Document Stores hybrid pipeline (M6-3).
 *
 * Stage order (see the VibeFlow specification):
 *   sources -> fractionator -> extractor output -> cleaner -> temporary Markdown backup
 *           -> optional summary -> [splitter / embeddings / vector store: handled by the existing
 *              Flowise pipeline, which this service feeds] -> knowledge graph (synchronized here)
 *
 * Nothing is re-implemented twice: the loader nodes, the chat models, the splitter and the vector
 * store come from the existing Flowise services. This service orchestrates them, records progress,
 * supports cancellation and keeps the vector side and the graph side in sync.
 */

export type IVibeFlowJobStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'CANCELLED' | 'FAILED' | 'COMPLETED'

export interface IVibeFlowPipelineStage {
    name: 'load' | 'fractionate' | 'clean' | 'backup' | 'summary' | 'graph'
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'
    startedAt?: string
    endedAt?: string
    detail?: string
}

export interface IVibeFlowJob {
    id: string
    documentStoreId: string
    loaderId?: string
    status: IVibeFlowJobStatus
    stages: IVibeFlowPipelineStage[]
    processed: number
    total: number
    progress: number
    startedAt: string
    updatedAt: string
    endedAt?: string
    elapsedMs: number
    error?: string
    cancelRequested: boolean
    result?: IVibeFlowPipelineReport
}

export interface IAdvancedPipelineOptions {
    maxPagesPerSegment?: number
    detectSemanticBoundaries?: boolean
    clean?: boolean
    backup?: boolean
    summary?: {
        enabled: boolean
        name?: string
        credentialId?: string
        config?: Record<string, unknown>
    }
    graph?: {
        enabled: boolean
        engine?: GraphEngine
        neo4jConfig?: INeo4jConfig
    }
    sourceId?: string
}

export interface IVibeFlowPipelineSegmentReport {
    index: number
    startPage: number
    endPage: number
    characters: number
    words: number
    splitReason: string
    title?: string
    backupPath?: string
    summary?: string
    entities: number
    relations: number
}

export interface IVibeFlowPipelineReport {
    documentStoreId: string
    documentId: string
    sourceId: string
    version: string
    loaderId?: string
    loaderName?: string
    pageGranularity: 'page' | 'form-feed' | 'unavailable'
    pages: number
    segments: IVibeFlowPipelineSegmentReport[]
    cleaning?: { removedPageNumbers: number; removedRepeatedLines: number; collapsedBlankLines: number }
    backupRoot?: string
    graph?: {
        engine: GraphEngine
        nodes: number
        relations: number
        entityTypes: Record<string, number>
        relationTypes: Record<string, number>
    }
    summaryProvider?: { name?: string; model?: string }
    durationsMs: Record<string, number>
    documents: { pageContent: string; metadata: Record<string, unknown> }[]
}

const jobs = new Map<string, IVibeFlowJob>()

const now = () => new Date().toISOString()

const updateJob = (jobId: string, patch: Partial<IVibeFlowJob>) => {
    const job = jobs.get(jobId)
    if (!job) return
    Object.assign(job, patch)
    job.updatedAt = now()
    job.elapsedMs = Date.now() - new Date(job.startedAt).getTime()
    job.progress = job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : job.progress
}

const setStage = (jobId: string, name: IVibeFlowPipelineStage['name'], status: IVibeFlowPipelineStage['status'], detail?: string) => {
    const job = jobs.get(jobId)
    if (!job) return
    const stage = job.stages.find((entry) => entry.name === name)
    if (!stage) return
    stage.status = status
    stage.detail = detail
    if (status === 'running') stage.startedAt = now()
    if (status === 'completed' || status === 'failed' || status === 'skipped' || status === 'cancelled') stage.endedAt = now()
    updateJob(jobId, {})
}

const assertNotCancelled = (jobId: string) => {
    const job = jobs.get(jobId)
    if (job?.cancelRequested) {
        throw new Error('VIBEFLOW_CANCELLED')
    }
}

// ---------------------------------------------------------------------------
// Real document loading (existing Flowise loader nodes)
// ---------------------------------------------------------------------------

interface ILoaderBundle {
    loaderId: string
    loaderName: string
    loaderConfig: Record<string, unknown>
    credential?: string
}

const resolveLoaderBundle = async (
    appDataSource: DataSource,
    storeId: string,
    loaderId: string | undefined,
    workspaceId: string
): Promise<{ store: DocumentStore; bundle: ILoaderBundle }> => {
    const store = await appDataSource.getRepository(DocumentStore).findOneBy({ id: storeId, workspaceId })
    if (!store) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Document store ${storeId} not found`)

    const loaders = JSON.parse(store.loaders || '[]') as any[]
    if (!loaders.length)
        throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, `Document store ${storeId} has no configured loader`)

    const selected = loaderId ? loaders.find((entry) => entry.id === loaderId) : loaders[0]
    if (!selected) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Loader ${loaderId} not found in document store ${storeId}`)

    return {
        store,
        bundle: {
            loaderId: selected.id,
            loaderName: selected.loaderName,
            loaderConfig: selected.loaderConfig || {},
            credential: selected.credential || selected.loaderConfig?.FLOWISE_CREDENTIAL_ID
        }
    }
}

/** Load the documents with the real loader node, without splitting (the fractionator runs first). */
const loadDocuments = async (params: {
    appDataSource: DataSource
    storeId: string
    loaderId?: string
    workspaceId: string
}): Promise<{ bundle: ILoaderBundle; documents: Document[]; store: DocumentStore }> => {
    const appServer = getRunningExpressApp()
    const { store, bundle } = await resolveLoaderBundle(params.appDataSource, params.storeId, params.loaderId, params.workspaceId)

    const componentNode = (appServer as any).nodesPool.componentNodes[bundle.loaderName]
    if (!componentNode) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Loader node "${bundle.loaderName}" is not registered on this server`
        )
    }

    const nodeModule = await import(componentNode.filePath)
    const nodeInstance = new nodeModule.nodeClass()
    const nodeData = {
        credential: bundle.credential,
        inputs: { ...bundle.loaderConfig, textSplitter: undefined },
        outputs: { output: 'document' }
    }
    const options = {
        chatflowid: uuidv4(),
        appDataSource: params.appDataSource,
        databaseEntities,
        logger,
        processRaw: true,
        workspaceId: params.workspaceId
    }

    const documents = (await nodeInstance.init(nodeData, '', options)) as unknown as Document[]
    return { bundle, documents: Array.isArray(documents) ? documents : [documents], store }
}

/** Map the loaded documents to pages (real page numbers when the loader provides them). */
export const documentsToPages = (
    documents: Document[]
): { pages: IPageText[]; granularity: IVibeFlowPipelineReport['pageGranularity'] } => {
    const pages: IPageText[] = []
    let pageNumber = 1

    const explicit = documents.filter((document) => {
        const metadata: any = document.metadata || {}
        return (
            metadata.pageNumber !== undefined ||
            metadata.page !== undefined ||
            metadata.pdf?.page !== undefined ||
            metadata.loc?.pageNumber !== undefined
        )
    })

    if (explicit.length) {
        for (const document of documents) {
            const metadata: any = document.metadata || {}
            const page =
                Number(metadata.pageNumber ?? metadata.page ?? metadata.pdf?.page ?? metadata.loc?.pageNumber) ||
                (metadata.pageNumber === 0 ? 1 : pageNumber)
            pages.push({ page: page || pageNumber, text: document.pageContent })
            pageNumber += 1
        }
        return { pages, granularity: 'page' }
    }

    const joined = documents.map((document) => document.pageContent).join('\n')
    if (joined.includes('\f')) {
        const chunks = joined.split('\f')
        return { pages: chunks.map((text, index) => ({ page: index + 1, text })), granularity: 'form-feed' }
    }

    return { pages: documents.map((document, index) => ({ page: index + 1, text: document.pageContent })), granularity: 'unavailable' }
}

// ---------------------------------------------------------------------------
// Summary (real chat model from the existing component nodes)
// ---------------------------------------------------------------------------

export const createChatModel = async (selectedChatModel: { name?: string; credentialId?: string; config?: Record<string, unknown> }) => {
    if (!selectedChatModel?.name) return null
    const appServer = getRunningExpressApp()
    const componentNode = (appServer as any).nodesPool.componentNodes[selectedChatModel.name]
    if (!componentNode) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Chat model node "${selectedChatModel.name}" is not registered on this server`
        )
    }
    const nodeModule = await import(componentNode.filePath)
    const nodeInstance = new nodeModule.nodeClass()
    const nodeData = {
        credential: selectedChatModel.credentialId,
        inputs: { ...(selectedChatModel.config || {}) }
    }
    return await nodeInstance.init(nodeData, '', {})
}

const summarizeSegment = async (
    model: any,
    segment: ISegment,
    meta: { documentName?: string; sourceId: string; version: string }
): Promise<string> => {
    const prompt = buildSummaryPrompt({
        segmentText: segment.text,
        documentName: meta.documentName,
        sourceId: meta.sourceId,
        version: meta.version,
        startPage: segment.startPage,
        endPage: segment.endPage
    })
    const response = await model.invoke([
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
    ])
    const content = (response as any)?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
            .join('\n')
            .trim()
    }
    return ''
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export const runAdvancedPipeline = async (params: {
    appDataSource: DataSource
    workspaceId: string
    storeId: string
    loaderId?: string
    options?: IAdvancedPipelineOptions
    jobId?: string
}): Promise<IVibeFlowPipelineReport> => {
    const options = params.options || {}
    const jobId = params.jobId
    const durations: Record<string, number> = {}
    const started = Date.now()

    // 1) load
    if (jobId) setStage(jobId, 'load', 'running')
    const loadStart = Date.now()
    const { bundle, documents, store } = await loadDocuments({
        appDataSource: params.appDataSource,
        storeId: params.storeId,
        loaderId: params.loaderId,
        workspaceId: params.workspaceId
    })
    durations.load = Date.now() - loadStart
    if (jobId) setStage(jobId, 'load', 'completed', `${documents.length} document(s) via ${bundle.loaderName}`)

    const { pages, granularity } = documentsToPages(documents)
    const sourceId = options.sourceId || (bundle.loaderConfig as any)?.filePath || bundle.loaderId
    const contentHash = require('crypto')
        .createHash('sha1')
        .update(pages.map((page) => page.text).join(''))
        .digest('hex')
    const version = buildDocumentVersion(contentHash)
    const documentId = bundle.loaderId

    // 2) fractionator
    if (jobId) setStage(jobId, 'fractionate', 'running')
    const fractionateStart = Date.now()
    const segments = fractionatePages(pages, {
        maxPagesPerSegment: options.maxPagesPerSegment,
        detectSemanticBoundaries: options.detectSemanticBoundaries
    })
    durations.fractionate = Date.now() - fractionateStart
    if (jobId) {
        updateJob(jobId, { total: segments.length, processed: 0 })
        setStage(
            jobId,
            'fractionate',
            'completed',
            `${segments.length} segment(s), max ${Math.max(...segments.map((segment) => segment.endPage - segment.startPage + 1))} page(s)`
        )
    }

    // 3) cleaner
    let cleaning: IVibeFlowPipelineReport['cleaning']
    let cleanedSegments = segments
    if (jobId) setStage(jobId, 'clean', options.clean === false ? 'skipped' : 'running')
    const cleanStart = Date.now()
    if (options.clean !== false) {
        cleanedSegments = segments.map((segment) => {
            const report = cleanMarkdown(segment.text)
            return { ...segment, text: report.text, characters: report.text.length, words: countWords(report.text) }
        })
        const first = cleanMarkdown(segments.map((segment) => segment.text).join('\n'))
        cleaning = {
            removedPageNumbers: first.removedPageNumbers,
            removedRepeatedLines: first.removedRepeatedLines,
            collapsedBlankLines: first.collapsedBlankLines
        }
    }
    durations.clean = Date.now() - cleanStart
    if (jobId) setStage(jobId, 'clean', options.clean === false ? 'skipped' : 'completed')

    // 4) temporary backup
    let backupRoot: string | undefined
    const backupPaths = new Map<number, string>()
    if (jobId) setStage(jobId, 'backup', options.backup === false ? 'skipped' : 'running')
    const backupStart = Date.now()
    if (options.backup !== false) {
        const backup = writeSegmentBackups({
            documentStoreId: params.storeId,
            sourceId,
            version,
            segments: cleanedSegments.map((segment) => ({
                index: segment.index,
                startPage: segment.startPage,
                endPage: segment.endPage,
                text: segment.text
            }))
        })
        backupRoot = backup.root
        for (const file of backup.files) backupPaths.set(file.segmentIndex, file.relativePath)
    }
    durations.backup = Date.now() - backupStart
    if (jobId) setStage(jobId, 'backup', options.backup === false ? 'skipped' : 'completed', backupRoot)

    // 5) optional summary
    const summaries = new Map<number, string>()
    if (jobId) setStage(jobId, 'summary', options.summary?.enabled ? 'running' : 'skipped')
    const summaryStart = Date.now()
    if (options.summary?.enabled) {
        const model = await createChatModel(options.summary)
        if (!model) {
            throw new InternalFlowiseError(StatusCodes.PRECONDITION_FAILED, 'Summary is enabled but no chat model was provided')
        }
        for (const segment of cleanedSegments) {
            if (jobId) assertNotCancelled(jobId)
            const summary = await summarizeSegment(model, segment, {
                documentName: sourceId,
                sourceId,
                version
            })
            summaries.set(segment.index, summary)
            if (jobId) updateJob(jobId, { processed: summaries.size })
        }
    }
    durations.summary = Date.now() - summaryStart
    if (jobId) setStage(jobId, 'summary', options.summary?.enabled ? 'completed' : 'skipped', `${summaries.size} résumé(s)`)

    // 6) knowledge graph
    let graphReport: IVibeFlowPipelineReport['graph']
    const segmentGraph: { entities: IGraphEntity[]; relations: IGraphRelation[] }[] = []
    if (jobId) setStage(jobId, 'graph', options.graph?.enabled === false ? 'skipped' : 'running')
    const graphStart = Date.now()
    if (options.graph?.enabled !== false) {
        if (jobId) assertNotCancelled(jobId)
        const engine: GraphEngine = options.graph?.engine || 'graphology-local'
        const adapter = await resolveGraphAdapter({
            engine,
            documentStoreId: params.storeId,
            neo4jConfig: options.graph?.neo4jConfig
        })
        await adapter.createGraph()

        const structural = buildStructuralKnowledgeGraph({
            documentId,
            sourceId,
            version,
            documentName: sourceId,
            segments: cleanedSegments.map((segment) => ({
                segmentId: `${documentId}-s${segment.index}`,
                index: segment.index,
                startPage: segment.startPage,
                endPage: segment.endPage,
                title: segment.title
            }))
        })
        await adapter.updateDocument(documentId, structural.entities, structural.relations)

        for (const segment of cleanedSegments) {
            const summary = summaries.get(segment.index) || ''
            const parsed = parseSummaryForGraph(summary)
            const segmentId = `${documentId}-s${segment.index}`
            const entities = parsed.entities.map((entity) => ({ ...entity, documentId, segmentId, sourceId, version }))
            const concepts = parsed.concepts.map((concept) => ({ ...concept, documentId, segmentId, sourceId, version }))
            const relations = parsed.relations.map((relation) => ({ ...relation, documentId, segmentId }))
            if (entities.length || concepts.length || relations.length) {
                await adapter.indexEntities([...entities, ...concepts], relations)
            }
            segmentGraph.push({ entities: [...entities, ...concepts], relations })

            // explicit links: segment -> entity (provenance)
            const links = [...entities, ...concepts].map((entity) => ({
                source: `seg-${segmentId}`,
                target: entity.name,
                type: 'MENTIONS',
                documentId,
                segmentId
            }))
            if (links.length) await adapter.indexRelations(links)
        }

        const statistics = await adapter.getStatistics()
        graphReport = {
            engine: statistics.engine,
            nodes: statistics.nodes,
            relations: statistics.relations,
            entityTypes: statistics.entityTypes,
            relationTypes: statistics.relationTypes
        }
    }
    durations.graph = Date.now() - graphStart
    if (jobId)
        setStage(
            jobId,
            'graph',
            options.graph?.enabled === false ? 'skipped' : 'completed',
            graphReport ? `${graphReport.nodes} nœuds / ${graphReport.relations} relations` : undefined
        )

    const segmentReports: IVibeFlowPipelineSegmentReport[] = cleanedSegments.map((segment, index) => ({
        index: segment.index,
        startPage: segment.startPage,
        endPage: segment.endPage,
        characters: segment.characters,
        words: segment.words,
        splitReason: segment.splitReason,
        title: segment.title,
        backupPath: backupPaths.get(segment.index),
        summary: summaries.get(segment.index),
        entities: segmentGraph[index]?.entities.length || 0,
        relations: segmentGraph[index]?.relations.length || 0
    }))

    void store
    void started

    return {
        documentStoreId: params.storeId,
        documentId,
        sourceId,
        version,
        loaderId: bundle.loaderId,
        loaderName: bundle.loaderName,
        pageGranularity: granularity,
        pages: pages.length,
        segments: segmentReports,
        cleaning,
        backupRoot,
        graph: graphReport,
        summaryProvider: options.summary?.enabled
            ? { name: options.summary.name, model: (options.summary.config as any)?.modelName }
            : undefined,
        durationsMs: durations,
        documents: cleanedSegments.map((segment) => ({
            pageContent: segment.text,
            metadata: {
                documentStoreId: params.storeId,
                documentId,
                sourceId,
                version,
                segmentId: `${documentId}-s${segment.index}`,
                segmentIndex: segment.index,
                startPage: segment.startPage,
                endPage: segment.endPage,
                splitReason: segment.splitReason,
                backupPath: backupPaths.get(segment.index),
                hasSummary: summaries.has(segment.index),
                provenance: makeProvenance({
                    document_id: documentId,
                    document_version: version,
                    source_id: sourceId,
                    segment_id: `${documentId}-s${segment.index}`
                })
            }
        }))
    }
}

// ---------------------------------------------------------------------------
// Job orchestration (states, progress, cancellation)
// ---------------------------------------------------------------------------

export const startAdvancedPipelineJob = async (params: {
    appDataSource: DataSource
    workspaceId: string
    storeId: string
    loaderId?: string
    options?: IAdvancedPipelineOptions
}): Promise<IVibeFlowJob> => {
    const job: IVibeFlowJob = {
        id: uuidv4(),
        documentStoreId: params.storeId,
        loaderId: params.loaderId,
        status: 'QUEUED',
        stages: (['load', 'fractionate', 'clean', 'backup', 'summary', 'graph'] as IVibeFlowPipelineStage['name'][]).map((name) => ({
            name,
            status: 'pending'
        })),
        processed: 0,
        total: 0,
        progress: 0,
        startedAt: now(),
        updatedAt: now(),
        elapsedMs: 0,
        cancelRequested: false
    }
    jobs.set(job.id, job)

    void (async () => {
        try {
            updateJob(job.id, { status: 'RUNNING' })
            const result = await runAdvancedPipeline({ ...params, jobId: job.id })
            updateJob(job.id, {
                status: 'COMPLETED',
                result,
                processed: result.segments.length,
                total: result.segments.length,
                endedAt: now()
            })
            logger.info(`[VibeFlow] advanced pipeline completed for document store ${params.storeId} (job ${job.id})`)
        } catch (error) {
            const message = getErrorMessage(error)
            if (message.includes('VIBEFLOW_CANCELLED')) {
                updateJob(job.id, { status: 'CANCELLED', endedAt: now(), error: 'Cancelled by user' })
            } else {
                updateJob(job.id, { status: 'FAILED', error: message, endedAt: now() })
                logger.error(`[VibeFlow] advanced pipeline failed for document store ${params.storeId}: ${message}`)
            }
        }
    })()

    return job
}

export const getJob = (jobId: string): IVibeFlowJob | undefined => jobs.get(jobId)

export const listJobs = (storeId?: string): IVibeFlowJob[] =>
    [...jobs.values()].filter((job) => !storeId || job.documentStoreId === storeId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))

export const cancelJob = (jobId: string): IVibeFlowJob => {
    const job = jobs.get(jobId)
    if (!job) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Job ${jobId} not found`)
    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
        return job
    }
    job.cancelRequested = true
    updateJob(jobId, { status: 'CANCELLING' })
    return jobs.get(jobId) as IVibeFlowJob
}

// ---------------------------------------------------------------------------
// Graph access for the UI (statistics, search, subgraph, engines)
// ---------------------------------------------------------------------------

export const getGraphEngines = async (neo4jConfig?: INeo4jConfig) => {
    return { data: await describeGraphEngines(neo4jConfig) }
}

export const getStoreGraph = async (params: {
    storeId: string
    engine?: GraphEngine
    neo4jConfig?: INeo4jConfig
    nodeIds?: string[]
    depth?: number
    limit?: number
}) => {
    const adapter = await resolveGraphAdapter({
        engine: params.engine || 'graphology-local',
        documentStoreId: params.storeId,
        neo4jConfig: params.neo4jConfig
    })
    const [statistics, subgraph] = await Promise.all([
        adapter.getStatistics(),
        adapter.getSubgraph({ nodeIds: params.nodeIds, depth: params.depth, limit: params.limit })
    ])
    return { data: { statistics, subgraph } }
}

export const searchStoreGraph = async (params: {
    storeId: string
    query: string
    engine?: GraphEngine
    limit?: number
    neo4jConfig?: INeo4jConfig
}) => {
    const adapter = await resolveGraphAdapter({
        engine: params.engine || 'graphology-local',
        documentStoreId: params.storeId,
        neo4jConfig: params.neo4jConfig
    })
    return { data: await adapter.searchGraph(params.query, { limit: params.limit }) }
}

export const traverseStoreGraph = async (params: {
    storeId: string
    nodeId: string
    engine?: GraphEngine
    depth?: number
    relationTypes?: string[]
    neo4jConfig?: INeo4jConfig
}) => {
    const adapter = await resolveGraphAdapter({
        engine: params.engine || 'graphology-local',
        documentStoreId: params.storeId,
        neo4jConfig: params.neo4jConfig
    })
    return { data: await adapter.traverseGraph(params.nodeId, { depth: params.depth, relationTypes: params.relationTypes }) }
}

export const getStoreGraphPaths = async (storeId: string) => {
    return { data: { temporaryBackupDirectory: getDocumentStoreTmpDir(storeId) } }
}

// ---------------------------------------------------------------------------
// Enriched Document Store table (M6 - paragraph 15) and graph synchronization
// ---------------------------------------------------------------------------

const getPipelineOptionsPath = (storeId: string): string => {
    const root = getDocumentStoreTmpDir(storeId)
    const dir = require('path').join(root, '..', 'vibeflow-pipeline-options')
    return require('path').join(dir, `${String(storeId).replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
}

export interface IStorePipelineOptions {
    documentStoreId: string
    loaderId?: string
    fractionator?: { maxPagesPerSegment?: number; detectSemanticBoundaries?: boolean }
    summary?: { enabled: boolean; name?: string; label?: string; credentialId?: string; config?: Record<string, unknown> }
    graph?: { enabled: boolean; engine?: GraphEngine }
    updatedAt: string
}

export const saveStorePipelineOptions = async (storeId: string, options: Partial<IStorePipelineOptions>) => {
    try {
        const fs = require('fs')
        const filePath = getPipelineOptionsPath(storeId)
        fs.mkdirSync(require('path').dirname(filePath), { recursive: true })
        const payload: IStorePipelineOptions = {
            documentStoreId: storeId,
            loaderId: options.loaderId,
            fractionator: options.fractionator,
            summary: options.summary,
            graph: options.graph,
            updatedAt: new Date().toISOString()
        }
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
        return { data: payload }
    } catch (error) {
        throw new InternalFlowiseError(500, `Error: vibeflowDocStoreService.saveStorePipelineOptions - ${getErrorMessage(error)}`)
    }
}

export const getStorePipelineOptions = (storeId: string): IStorePipelineOptions | null => {
    try {
        const fs = require('fs')
        const filePath = getPipelineOptionsPath(storeId)
        if (!fs.existsSync(filePath)) return null
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as IStorePipelineOptions
    } catch {
        return null
    }
}

/**
 * Rebuild the knowledge graph of a Document Store from the chunks that are already stored:
 * the vector side is not touched, the graph side is regenerated from the real data.
 */
export const syncStoreGraph = async (params: { storeId: string; workspaceId: string; engine?: GraphEngine }) => {
    try {
        const appServer = getRunningExpressApp()
        const { DocumentStoreFileChunk } = require('../../database/entities/DocumentStoreFileChunk')
        const chunks = await appServer.AppDataSource.getRepository(DocumentStoreFileChunk).find({
            where: { storeId: params.storeId },
            take: 10000
        })

        const adapter = await resolveGraphAdapter({
            engine: params.engine || 'graphology-local',
            documentStoreId: params.storeId
        })
        await adapter.createGraph()

        const byDocument = new Map<string, { sourceId: string; version: string; segments: Map<string, any> }>()
        for (const chunk of chunks) {
            let metadata: Record<string, any> = {}
            try {
                metadata = chunk.metadata ? JSON.parse(chunk.metadata) : {}
            } catch {
                metadata = {}
            }
            const documentId = metadata.documentId || chunk.docId || 'document'
            const segmentId = metadata.segmentId || `chunk-${chunk.chunkNo}`
            if (!byDocument.has(documentId)) {
                byDocument.set(documentId, {
                    sourceId: metadata.sourceId || documentId,
                    version: metadata.version || '1',
                    segments: new Map()
                })
            }
            const document = byDocument.get(documentId) as any
            if (!document.segments.has(segmentId)) {
                document.segments.set(segmentId, {
                    segmentId,
                    index: document.segments.size + 1,
                    startPage: metadata.startPage,
                    endPage: metadata.endPage,
                    title: metadata.title,
                    chunkIds: []
                })
            }
            document.segments.get(segmentId).chunkIds.push(String(metadata.chunkId || `${chunk.docId}:${chunk.chunkNo}`))
        }

        let documents = 0
        for (const [documentId, document] of byDocument.entries()) {
            const structural = buildStructuralKnowledgeGraph({
                documentId,
                sourceId: document.sourceId,
                version: document.version,
                segments: [...document.segments.values()]
            })
            await adapter.updateDocument(documentId, structural.entities, structural.relations)
            documents += 1
        }

        const statistics = await adapter.getStatistics()
        return { data: { documents, chunks: chunks.length, statistics } }
    } catch (error) {
        throw new InternalFlowiseError(500, `Error: vibeflowDocStoreService.syncStoreGraph - ${getErrorMessage(error)}`)
    }
}

/** One row per Document Store, with everything the enriched table needs. */
export const getEnrichedTable = async (workspaceId: string) => {
    try {
        const appServer = getRunningExpressApp()
        const stores = await appServer.AppDataSource.getRepository(DocumentStore).findBy({ workspaceId })
        const { DocumentStoreFileChunk } = require('../../database/entities/DocumentStoreFileChunk')

        const rows = []
        for (const store of stores) {
            let loaders: any[] = []
            try {
                loaders = JSON.parse(store.loaders || '[]')
            } catch {
                loaders = []
            }

            const chunkRows = await appServer.AppDataSource.getRepository(DocumentStoreFileChunk).find({
                where: { storeId: store.id },
                select: ['chunkNo', 'pageContent']
            })
            const chunks = chunkRows.length
            const characters =
                chunkRows.reduce((total, chunk) => total + (chunk.pageContent ? chunk.pageContent.length : 0), 0) ||
                loaders.reduce((total, loader) => total + (loader.totalChars || 0), 0)

            const options = getStorePipelineOptions(store.id)
            let graph: { engine: string; available: boolean; nodes: number; relations: number; reason?: string } = {
                engine: options?.graph?.engine || 'graphology-local',
                available: false,
                nodes: 0,
                relations: 0
            }
            try {
                const adapter = await resolveGraphAdapter({
                    engine: (options?.graph?.engine as GraphEngine) || 'graphology-local',
                    documentStoreId: store.id
                })
                const status = await adapter.isAvailable()
                if (status.available) {
                    const statistics = await adapter.getStatistics()
                    graph = {
                        engine: statistics.engine,
                        available: statistics.nodes > 0,
                        nodes: statistics.nodes,
                        relations: statistics.relations
                    }
                } else {
                    graph = { ...graph, available: false, reason: status.reason }
                }
            } catch (error) {
                graph = { ...graph, available: false, reason: getErrorMessage(error) }
            }

            rows.push({
                id: store.id,
                name: store.name,
                loaders: [...new Set(loaders.map((loader) => loader.loaderName || loader.loaderId).filter(Boolean))],
                splitter: (loaders.find((loader) => loader.splitterName) || {}).splitterName || null,
                summary: options?.summary?.enabled
                    ? {
                          enabled: true,
                          provider: options.summary.name,
                          model: (options.summary.config as any)?.modelName || null,
                          label: options.summary.label
                      }
                    : { enabled: false },
                sources: loaders.length,
                chunks,
                characters,
                graph
            })
        }

        return { data: rows }
    } catch (error) {
        throw new InternalFlowiseError(500, `Error: vibeflowDocStoreService.getEnrichedTable - ${getErrorMessage(error)}`)
    }
}

export default {
    cancelJob,
    documentsToPages,
    getEnrichedTable,
    getGraphEngines,
    getJob,
    getStoreGraph,
    getStoreGraphPaths,
    getStorePipelineOptions,
    listJobs,
    runAdvancedPipeline,
    saveStorePipelineOptions,
    searchStoreGraph,
    startAdvancedPipelineJob,
    syncStoreGraph,
    traverseStoreGraph
}
