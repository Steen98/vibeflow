import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { MultiDirectedGraph } from 'graphology'

/**
 * VibeFlow — Knowledge Graph layer (M6).
 *
 * Business code never talks to Neo4j, Graphology or Kuzu directly: everything goes through
 * `IGraphKnowledgeAdapter`. Available engines:
 *
 *  - 'graphology-local' : in-memory Graphology graph persisted as JSON on disk (default, always available)
 *  - 'neo4j'            : Neo4jGraphAdapter, only when the driver is installed and the connection is configured
 *  - 'kuzu'             : KuzuGraphAdapter, capability detected (the npm package is archived/deprecated)
 *
 * Each adapter instance is bound to one Document Store, so graphs stay isolated.
 */

export type GraphEngine = 'graphology-local' | 'neo4j' | 'kuzu'

export interface IGraphEntity {
    id?: string
    name: string
    type?: string
    description?: string
    documentId?: string
    segmentId?: string
    chunkId?: string
    sourceId?: string
    version?: string | number
    confidence?: number
    metadata?: Record<string, unknown>
}

export interface IGraphRelation {
    id?: string
    source: string
    target: string
    type: string
    documentId?: string
    segmentId?: string
    chunkId?: string
    confidence?: number
    metadata?: Record<string, unknown>
}

export interface IGraphStatistics {
    engine: GraphEngine
    nodes: number
    relations: number
    entityTypes: Record<string, number>
    relationTypes: Record<string, number>
}

export interface ISubgraph {
    nodes: { id: string; attributes: Record<string, any> }[]
    relations: { id: string; source: string; target: string; attributes: Record<string, any> }[]
    truncated: boolean
}

export interface IGraphKnowledgeAdapter {
    readonly engine: GraphEngine
    readonly documentStoreId: string
    isAvailable(): Promise<{ available: boolean; reason?: string }>
    createGraph(): Promise<void>
    deleteGraph(): Promise<void>
    indexEntities(entities: IGraphEntity[], relations?: IGraphRelation[]): Promise<{ nodes: number; relations: number }>
    indexRelations(relations: IGraphRelation[]): Promise<{ relations: number }>
    updateDocument(documentId: string, entities: IGraphEntity[], relations: IGraphRelation[]): Promise<{ nodes: number; relations: number }>
    deleteDocument(documentId: string): Promise<{ nodes: number; relations: number }>
    searchGraph(
        query: string,
        options?: { limit?: number; types?: string[] }
    ): Promise<{ nodes: IGraphEntity[]; relations: IGraphRelation[] }>
    traverseGraph(startNodeId: string, options?: { depth?: number; relationTypes?: string[] }): Promise<ISubgraph>
    getSubgraph(options?: { nodeIds?: string[]; depth?: number; limit?: number }): Promise<ISubgraph>
    getNode(nodeId: string): Promise<IGraphEntity | null>
    getRelations(nodeId: string): Promise<IGraphRelation[]>
    getStatistics(): Promise<IGraphStatistics>
}

export const VIBEFLOW_GRAPH_PATH_ENV = 'VIBEFLOW_GRAPH_PATH'

export const getGraphRoot = (): string => {
    const configured = process.env[VIBEFLOW_GRAPH_PATH_ENV]
    if (configured && configured.trim().length) return path.resolve(configured.trim())
    const storageRoot = process.env.BLOB_STORAGE_PATH || path.join(os.homedir(), '.flowise')
    return path.join(path.resolve(storageRoot), 'vibeflow-graphs')
}

export const normalizeEntityId = (name: string): string =>
    (name || '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '') || 'unknown'

// ---------------------------------------------------------------------------
// Graphology + JSON persistence (default engine)
// ---------------------------------------------------------------------------

export class GraphologyLocalAdapter implements IGraphKnowledgeAdapter {
    readonly engine: GraphEngine = 'graphology-local'
    readonly documentStoreId: string
    private graph: MultiDirectedGraph
    private storageDir: string

    constructor(documentStoreId: string, options: { storageDir?: string } = {}) {
        if (!documentStoreId || !documentStoreId.trim().length) throw new Error('documentStoreId is required')
        this.documentStoreId = documentStoreId
        this.storageDir = options.storageDir || path.join(getGraphRoot(), String(documentStoreId).replace(/[^a-zA-Z0-9._-]/g, '_'))
        this.graph = new MultiDirectedGraph()
        this.load()
    }

    private get filePath(): string {
        return path.join(this.storageDir, 'graph.json')
    }

    private load(): void {
        if (!existsSync(this.filePath)) return
        try {
            const payload = JSON.parse(readFileSync(this.filePath, 'utf8'))
            for (const node of payload.nodes || []) {
                const { id, ...attributes } = node
                if (!this.graph.hasNode(id)) this.graph.addNode(id, attributes)
            }
            for (const edge of payload.relations || []) {
                const { id, source, target, ...attributes } = edge
                if (this.graph.hasNode(source) && this.graph.hasNode(target)) {
                    this.graph.addEdgeWithKey(id, source, target, attributes)
                }
            }
        } catch {
            this.graph = new MultiDirectedGraph()
        }
    }

    private persist(): void {
        mkdirSync(this.storageDir, { recursive: true })
        const payload = {
            version: 1,
            engine: this.engine,
            documentStoreId: this.documentStoreId,
            updatedAt: new Date().toISOString(),
            nodes: this.graph.mapNodes((id, attributes) => ({ id, ...attributes })),
            relations: this.graph.mapEdges((id, attributes, source, target) => ({ id, source, target, ...attributes }))
        }
        writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8')
    }

    async isAvailable(): Promise<{ available: boolean; reason?: string }> {
        return { available: true }
    }

    async createGraph(): Promise<void> {
        this.graph = new MultiDirectedGraph()
        this.persist()
    }

    async deleteGraph(): Promise<void> {
        this.graph = new MultiDirectedGraph()
        if (existsSync(this.storageDir)) rmSync(this.storageDir, { recursive: true, force: true })
    }

    private upsertEntity(entity: IGraphEntity): string {
        const id = entity.id ? normalizeEntityId(entity.id) : normalizeEntityId(entity.name)
        const attributes = {
            name: entity.name,
            type: entity.type || 'Concept',
            description: entity.description || '',
            documentId: entity.documentId,
            segmentId: entity.segmentId,
            chunkId: entity.chunkId,
            sourceId: entity.sourceId,
            version: entity.version !== undefined ? String(entity.version) : undefined,
            confidence: entity.confidence,
            ...(entity.metadata || {})
        }
        if (this.graph.hasNode(id)) this.graph.mergeNodeAttributes(id, attributes)
        else this.graph.addNode(id, attributes)
        return id
    }

    private upsertRelation(relation: IGraphRelation): string {
        const source = normalizeEntityId(relation.source)
        const target = normalizeEntityId(relation.target)
        const type = relation.type || 'RELATED_TO'
        if (!this.graph.hasNode(source)) this.graph.addNode(source, { name: relation.source, type: 'Concept' })
        if (!this.graph.hasNode(target)) this.graph.addNode(target, { name: relation.target, type: 'Concept' })
        const edgeId = relation.id ? normalizeEntityId(relation.id) : `${source}--${normalizeEntityId(type)}--${target}`
        const attributes = {
            type,
            documentId: relation.documentId,
            segmentId: relation.segmentId,
            chunkId: relation.chunkId,
            confidence: relation.confidence,
            ...(relation.metadata || {})
        }
        if (this.graph.hasEdge(edgeId)) this.graph.mergeEdgeAttributes(edgeId, attributes)
        else this.graph.addEdgeWithKey(edgeId, source, target, attributes)
        return edgeId
    }

    async indexEntities(entities: IGraphEntity[], relations: IGraphRelation[] = []): Promise<{ nodes: number; relations: number }> {
        let nodes = 0
        for (const entity of entities || []) {
            this.upsertEntity(entity)
            nodes += 1
        }
        let relationCount = 0
        for (const relation of relations || []) {
            this.upsertRelation(relation)
            relationCount += 1
        }
        this.persist()
        return { nodes, relations: relationCount }
    }

    async indexRelations(relations: IGraphRelation[]): Promise<{ relations: number }> {
        let count = 0
        for (const relation of relations || []) {
            this.upsertRelation(relation)
            count += 1
        }
        this.persist()
        return { relations: count }
    }

    async updateDocument(
        documentId: string,
        entities: IGraphEntity[],
        relations: IGraphRelation[]
    ): Promise<{ nodes: number; relations: number }> {
        await this.deleteDocument(documentId)
        return await this.indexEntities(
            (entities || []).map((entity) => ({ ...entity, documentId })),
            (relations || []).map((relation) => ({ ...relation, documentId }))
        )
    }

    async deleteDocument(documentId: string): Promise<{ nodes: number; relations: number }> {
        let removedNodes = 0
        let removedRelations = 0

        const edgesToDrop: string[] = []
        this.graph.forEachEdge((edgeId, attributes, source, target) => {
            const edgeDocument = (attributes as any).documentId
            const sourceDocument = this.graph.getNodeAttribute(source, 'documentId')
            const targetDocument = this.graph.getNodeAttribute(target, 'documentId')
            if (edgeDocument === documentId || (sourceDocument === documentId && targetDocument === documentId)) {
                edgesToDrop.push(edgeId)
            }
        })
        for (const edgeId of edgesToDrop) {
            this.graph.dropEdge(edgeId)
            removedRelations += 1
        }

        const nodesToDrop: string[] = []
        this.graph.forEachNode((nodeId, attributes) => {
            if ((attributes as any).documentId === documentId) nodesToDrop.push(nodeId)
        })
        for (const nodeId of nodesToDrop) {
            if (this.graph.degree(nodeId) === 0) {
                this.graph.dropNode(nodeId)
                removedNodes += 1
            } else {
                this.graph.setNodeAttribute(nodeId, 'documentId', undefined)
            }
        }

        this.persist()
        return { nodes: removedNodes, relations: removedRelations }
    }

    async searchGraph(
        query: string,
        options: { limit?: number; types?: string[] } = {}
    ): Promise<{ nodes: IGraphEntity[]; relations: IGraphRelation[] }> {
        const needle = (query || '').trim().toLowerCase()
        const limit = options.limit && options.limit > 0 ? options.limit : 25
        const nodes: IGraphEntity[] = []
        const relations: IGraphRelation[] = []

        if (!needle.length) return { nodes, relations }

        this.graph.forEachNode((id, attributes) => {
            if (nodes.length >= limit) return
            const haystack = `${attributes.name || ''} ${attributes.description || ''} ${attributes.type || ''}`.toLowerCase()
            if (haystack.includes(needle)) {
                nodes.push({
                    id,
                    name: attributes.name,
                    type: attributes.type,
                    description: attributes.description,
                    documentId: attributes.documentId
                })
            }
        })

        const nodeIds = new Set(nodes.map((node) => node.id))
        this.graph.forEachEdge((id, attributes, source, target) => {
            if (relations.length >= limit) return
            if (attributes.type && String(attributes.type).toLowerCase().includes(needle)) {
                relations.push({ id, source, target, type: attributes.type })
                return
            }
            if (nodeIds.has(source) || nodeIds.has(target)) {
                relations.push({ id, source, target, type: attributes.type })
            }
        })

        return { nodes, relations }
    }

    async traverseGraph(startNodeId: string, options: { depth?: number; relationTypes?: string[] } = {}): Promise<ISubgraph> {
        const start = normalizeEntityId(startNodeId)
        const depth = options.depth && options.depth > 0 ? Math.min(options.depth, 4) : 2
        if (!this.graph.hasNode(start)) return { nodes: [], relations: [], truncated: false }

        const visited = new Set<string>([start])
        let frontier = [start]
        const relations: ISubgraph['relations'] = []

        for (let level = 0; level < depth; level++) {
            const next: string[] = []
            for (const nodeId of frontier) {
                this.graph.forEachEdge(nodeId, (edgeId, attributes, source, target) => {
                    if (options.relationTypes?.length && !options.relationTypes.includes(String(attributes.type))) return
                    relations.push({ id: edgeId, source, target, attributes })
                    const neighbour = source === nodeId ? target : source
                    if (!visited.has(neighbour)) {
                        visited.add(neighbour)
                        next.push(neighbour)
                    }
                })
            }
            frontier = next
            if (!frontier.length) break
        }

        const nodes = [...visited].map((id) => ({ id, attributes: this.graph.getNodeAttributes(id) as Record<string, any> }))
        const uniqueRelations = [...new Map(relations.map((relation) => [relation.id, relation])).values()]
        return { nodes, relations: uniqueRelations, truncated: nodes.length > 500 }
    }

    async getSubgraph(options: { nodeIds?: string[]; depth?: number; limit?: number } = {}): Promise<ISubgraph> {
        const limit = options.limit && options.limit > 0 ? options.limit : 200
        if (options.nodeIds?.length) {
            const merged: ISubgraph = { nodes: [], relations: [], truncated: false }
            const seen = new Set<string>()
            for (const nodeId of options.nodeIds) {
                const subgraph = await this.traverseGraph(nodeId, { depth: options.depth || 1 })
                for (const node of subgraph.nodes) {
                    if (seen.has(node.id)) continue
                    seen.add(node.id)
                    merged.nodes.push(node)
                }
                for (const relation of subgraph.relations) {
                    if (merged.relations.some((existing) => existing.id === relation.id)) continue
                    merged.relations.push(relation)
                }
                if (merged.nodes.length >= limit) break
            }
            merged.truncated = merged.nodes.length >= limit
            merged.nodes = merged.nodes.slice(0, limit)
            return merged
        }

        const nodes: ISubgraph['nodes'] = []
        this.graph.forEachNode((id, attributes) => {
            if (nodes.length >= limit) return
            nodes.push({ id, attributes })
        })
        const nodeIds = new Set(nodes.map((node) => node.id))
        const relations: ISubgraph['relations'] = []
        this.graph.forEachEdge((id, attributes, source, target) => {
            if (relations.length >= limit * 2) return
            if (nodeIds.has(source) && nodeIds.has(target)) relations.push({ id, source, target, attributes })
        })
        return { nodes, relations, truncated: this.graph.order > nodes.length }
    }

    async getNode(nodeId: string): Promise<IGraphEntity | null> {
        const id = normalizeEntityId(nodeId)
        if (!this.graph.hasNode(id)) return null
        const attributes = this.graph.getNodeAttributes(id)
        return { id, name: attributes.name, type: attributes.type, description: attributes.description, documentId: attributes.documentId }
    }

    async getRelations(nodeId: string): Promise<IGraphRelation[]> {
        const id = normalizeEntityId(nodeId)
        if (!this.graph.hasNode(id)) return []
        const relations: IGraphRelation[] = []
        this.graph.forEachEdge(id, (edgeId, attributes, source, target) => {
            relations.push({ id: edgeId, source, target, type: attributes.type, confidence: attributes.confidence })
        })
        return relations
    }

    async getStatistics(): Promise<IGraphStatistics> {
        const entityTypes: Record<string, number> = {}
        const relationTypes: Record<string, number> = {}
        this.graph.forEachNode((_id, attributes) => {
            const type = (attributes.type as string) || 'Concept'
            entityTypes[type] = (entityTypes[type] || 0) + 1
        })
        this.graph.forEachEdge((_id, attributes) => {
            const type = (attributes.type as string) || 'RELATED_TO'
            relationTypes[type] = (relationTypes[type] || 0) + 1
        })
        return { engine: this.engine, nodes: this.graph.order, relations: this.graph.size, entityTypes, relationTypes }
    }
}

// ---------------------------------------------------------------------------
// Neo4j adapter (only when the driver and the connection are really available)
// ---------------------------------------------------------------------------

export interface INeo4jConfig {
    url: string
    username: string
    password: string
    database?: string
}

export class Neo4jGraphAdapter implements IGraphKnowledgeAdapter {
    readonly engine: GraphEngine = 'neo4j'
    readonly documentStoreId: string
    private config: INeo4jConfig
    private driver: any

    constructor(documentStoreId: string, config: INeo4jConfig) {
        this.documentStoreId = documentStoreId
        this.config = config
    }

    private async getDriver(): Promise<any> {
        if (this.driver) return this.driver
        const neo4j = require('neo4j-driver')
        this.driver = neo4j.driver(this.config.url, neo4j.auth.basic(this.config.username, this.config.password))
        return this.driver
    }

    private async run(cypher: string, params: Record<string, unknown> = {}): Promise<any> {
        const driver = await this.getDriver()
        const session = driver.session(this.config.database ? { database: this.config.database } : {})
        try {
            return await session.run(cypher, params)
        } finally {
            await session.close()
        }
    }

    async isAvailable(): Promise<{ available: boolean; reason?: string }> {
        try {
            require('neo4j-driver')
        } catch {
            return { available: false, reason: 'neo4j-driver is not installed' }
        }
        if (!this.config?.url || !this.config?.username) {
            return { available: false, reason: 'No Neo4j connection configured (url / username / password)' }
        }
        try {
            await this.run('RETURN 1 AS ok')
            return { available: true }
        } catch (error) {
            return { available: false, reason: error instanceof Error ? error.message : 'Neo4j connection failed' }
        }
    }

    async createGraph(): Promise<void> {
        await this.run('MERGE (g:VibeFlowGraph {documentStoreId: $documentStoreId}) SET g.updatedAt = datetime()', {
            documentStoreId: this.documentStoreId
        })
    }

    async deleteGraph(): Promise<void> {
        await this.run('MATCH (n:VibeFlowEntity {documentStoreId: $documentStoreId}) DETACH DELETE n', {
            documentStoreId: this.documentStoreId
        })
        await this.run('MATCH (g:VibeFlowGraph {documentStoreId: $documentStoreId}) DELETE g', { documentStoreId: this.documentStoreId })
    }

    async indexEntities(entities: IGraphEntity[], relations: IGraphRelation[] = []): Promise<{ nodes: number; relations: number }> {
        for (const entity of entities || []) {
            await this.run(
                `MERGE (e:VibeFlowEntity {id: $id, documentStoreId: $documentStoreId})
                 SET e.name = $name, e.type = $type, e.description = $description, e.documentId = $documentId,
                     e.segmentId = $segmentId, e.chunkId = $chunkId, e.updatedAt = datetime()`,
                {
                    id: normalizeEntityId(entity.id || entity.name),
                    documentStoreId: this.documentStoreId,
                    name: entity.name,
                    type: entity.type || 'Concept',
                    description: entity.description || '',
                    documentId: entity.documentId || null,
                    segmentId: entity.segmentId || null,
                    chunkId: entity.chunkId || null
                }
            )
        }
        const relationResult = await this.indexRelations(relations)
        return { nodes: (entities || []).length, relations: relationResult.relations }
    }

    async indexRelations(relations: IGraphRelation[]): Promise<{ relations: number }> {
        let count = 0
        for (const relation of relations || []) {
            const source = normalizeEntityId(relation.source)
            const target = normalizeEntityId(relation.target)
            await this.run(
                `MERGE (a:VibeFlowEntity {id: $source, documentStoreId: $documentStoreId})
                 ON CREATE SET a.name = $sourceName, a.type = 'Concept'
                 MERGE (b:VibeFlowEntity {id: $target, documentStoreId: $documentStoreId})
                 ON CREATE SET b.name = $targetName, b.type = 'Concept'
                 MERGE (a)-[r:VIBEFLOW_RELATION {type: $type, documentStoreId: $documentStoreId}]->(b)
                 SET r.documentId = $documentId, r.confidence = $confidence, r.updatedAt = datetime()`,
                {
                    source,
                    target,
                    sourceName: relation.source,
                    targetName: relation.target,
                    type: relation.type || 'RELATED_TO',
                    documentStoreId: this.documentStoreId,
                    documentId: relation.documentId || null,
                    confidence: relation.confidence ?? null
                }
            )
            count += 1
        }
        return { relations: count }
    }

    async updateDocument(
        documentId: string,
        entities: IGraphEntity[],
        relations: IGraphRelation[]
    ): Promise<{ nodes: number; relations: number }> {
        await this.deleteDocument(documentId)
        return await this.indexEntities(
            (entities || []).map((entity) => ({ ...entity, documentId })),
            (relations || []).map((relation) => ({ ...relation, documentId }))
        )
    }

    async deleteDocument(documentId: string): Promise<{ nodes: number; relations: number }> {
        const result = await this.run(
            `MATCH (e:VibeFlowEntity {documentStoreId: $documentStoreId, documentId: $documentId})
             DETACH DELETE e RETURN count(e) AS deleted`,
            { documentStoreId: this.documentStoreId, documentId }
        )
        const deleted = result?.records?.[0]?.get('deleted')
        const count = typeof deleted === 'object' && deleted !== null ? Number(deleted.low ?? deleted) : Number(deleted || 0)
        return { nodes: count, relations: 0 }
    }

    async searchGraph(
        query: string,
        options: { limit?: number; types?: string[] } = {}
    ): Promise<{ nodes: IGraphEntity[]; relations: IGraphRelation[] }> {
        const limit = options.limit && options.limit > 0 ? options.limit : 25
        const result = await this.run(
            `MATCH (e:VibeFlowEntity {documentStoreId: $documentStoreId})
             WHERE toLower(e.name) CONTAINS toLower($query) OR toLower(coalesce(e.description, '')) CONTAINS toLower($query)
             RETURN e.id AS id, e.name AS name, e.type AS type, e.description AS description, e.documentId AS documentId
             LIMIT $limit`,
            { documentStoreId: this.documentStoreId, query, limit }
        )
        const nodes: IGraphEntity[] = (result?.records || []).map((record: any) => ({
            id: record.get('id'),
            name: record.get('name'),
            type: record.get('type'),
            description: record.get('description'),
            documentId: record.get('documentId')
        }))
        return { nodes, relations: [] }
    }

    async traverseGraph(startNodeId: string, options: { depth?: number; relationTypes?: string[] } = {}): Promise<ISubgraph> {
        const depth = options.depth && options.depth > 0 ? Math.min(options.depth, 4) : 2
        const result = await this.run(
            `MATCH path = (start:VibeFlowEntity {id: $startNodeId, documentStoreId: $documentStoreId})-[*1..${depth}]-(other:VibeFlowEntity)
             RETURN path LIMIT 300`,
            { startNodeId: normalizeEntityId(startNodeId), documentStoreId: this.documentStoreId }
        )
        const nodes = new Map<string, { id: string; attributes: Record<string, any> }>()
        const relations = new Map<string, ISubgraph['relations'][number]>()
        for (const record of result?.records || []) {
            const path = record.get('path')
            for (const segment of path?.segments || []) {
                const start = segment.start
                const end = segment.end
                nodes.set(start.properties.id, { id: start.properties.id, attributes: start.properties })
                nodes.set(end.properties.id, { id: end.properties.id, attributes: end.properties })
                const relationId = `${start.properties.id}--${segment.relationship.properties.type}--${end.properties.id}`
                relations.set(relationId, {
                    id: relationId,
                    source: start.properties.id,
                    target: end.properties.id,
                    attributes: segment.relationship.properties
                })
            }
        }
        return { nodes: [...nodes.values()], relations: [...relations.values()], truncated: nodes.size >= 300 }
    }

    async getSubgraph(options: { nodeIds?: string[]; depth?: number; limit?: number } = {}): Promise<ISubgraph> {
        if (options.nodeIds?.length) {
            const merged: ISubgraph = { nodes: [], relations: [], truncated: false }
            const seen = new Set<string>()
            for (const nodeId of options.nodeIds) {
                const subgraph = await this.traverseGraph(nodeId, { depth: options.depth || 1 })
                for (const node of subgraph.nodes) {
                    if (seen.has(node.id)) continue
                    seen.add(node.id)
                    merged.nodes.push(node)
                }
                for (const relation of subgraph.relations) {
                    if (!merged.relations.some((existing) => existing.id === relation.id)) merged.relations.push(relation)
                }
            }
            return merged
        }
        const limit = options.limit && options.limit > 0 ? options.limit : 200
        const result = await this.run(`MATCH (e:VibeFlowEntity {documentStoreId: $documentStoreId}) RETURN e LIMIT $limit`, {
            documentStoreId: this.documentStoreId,
            limit
        })
        const nodes = (result?.records || []).map((record: any) => {
            const properties = record.get('e').properties
            return { id: properties.id, attributes: properties }
        })
        return { nodes, relations: [], truncated: nodes.length >= limit }
    }

    async getNode(nodeId: string): Promise<IGraphEntity | null> {
        const result = await this.run(
            `MATCH (e:VibeFlowEntity {id: $id, documentStoreId: $documentStoreId})
             RETURN e.id AS id, e.name AS name, e.type AS type, e.description AS description LIMIT 1`,
            { id: normalizeEntityId(nodeId), documentStoreId: this.documentStoreId }
        )
        const record = result?.records?.[0]
        if (!record) return null
        return { id: record.get('id'), name: record.get('name'), type: record.get('type'), description: record.get('description') }
    }

    async getRelations(nodeId: string): Promise<IGraphRelation[]> {
        const result = await this.run(
            `MATCH (a:VibeFlowEntity {id: $id, documentStoreId: $documentStoreId})-[r]-(b:VibeFlowEntity)
             RETURN a.id AS source, b.id AS target, r.type AS type LIMIT 200`,
            { id: normalizeEntityId(nodeId), documentStoreId: this.documentStoreId }
        )
        return (result?.records || []).map((record: any) => ({
            source: record.get('source'),
            target: record.get('target'),
            type: record.get('type')
        }))
    }

    async getStatistics(): Promise<IGraphStatistics> {
        const result = await this.run(
            `MATCH (e:VibeFlowEntity {documentStoreId: $documentStoreId})
             WITH count(e) AS nodes
             MATCH (a:VibeFlowEntity {documentStoreId: $documentStoreId})-[r]->()
             RETURN nodes, count(r) AS relations`,
            { documentStoreId: this.documentStoreId }
        )
        const record = result?.records?.[0]
        return {
            engine: this.engine,
            nodes: Number(record?.get('nodes') ?? 0),
            relations: Number(record?.get('relations') ?? 0),
            entityTypes: {},
            relationTypes: {}
        }
    }
}

// ---------------------------------------------------------------------------
// Kuzu adapter — capability detected (the npm package is archived / deprecated)
// ---------------------------------------------------------------------------

export class KuzuGraphAdapter implements IGraphKnowledgeAdapter {
    readonly engine: GraphEngine = 'kuzu'
    readonly documentStoreId: string
    private databaseDir: string

    constructor(documentStoreId: string, options: { databaseDir?: string } = {}) {
        this.documentStoreId = documentStoreId
        this.databaseDir = options.databaseDir || path.join(getGraphRoot(), `${documentStoreId}-kuzu`)
    }

    async isAvailable(): Promise<{ available: boolean; reason?: string }> {
        try {
            require('kuzu')
        } catch {
            return {
                available: false,
                reason:
                    'The kuzu npm package is not installed (the upstream project was archived in October 2025). ' +
                    'Graphology + JSON/SQLite persistence stays the supported local engine.'
            }
        }
        return { available: true }
    }

    private unavailable(): never {
        throw new Error('Kuzu engine is not available on this host: install the kuzu package to enable it')
    }

    async createGraph(): Promise<void> {
        this.unavailable()
    }
    async deleteGraph(): Promise<void> {
        this.unavailable()
    }
    async indexEntities(): Promise<{ nodes: number; relations: number }> {
        this.unavailable()
    }
    async indexRelations(): Promise<{ relations: number }> {
        this.unavailable()
    }
    async updateDocument(): Promise<{ nodes: number; relations: number }> {
        this.unavailable()
    }
    async deleteDocument(): Promise<{ nodes: number; relations: number }> {
        this.unavailable()
    }
    async searchGraph(): Promise<{ nodes: IGraphEntity[]; relations: IGraphRelation[] }> {
        this.unavailable()
    }
    async traverseGraph(): Promise<ISubgraph> {
        this.unavailable()
    }
    async getSubgraph(): Promise<ISubgraph> {
        this.unavailable()
    }
    async getNode(): Promise<IGraphEntity | null> {
        this.unavailable()
    }
    async getRelations(): Promise<IGraphRelation[]> {
        this.unavailable()
    }
    async getStatistics(): Promise<IGraphStatistics> {
        this.unavailable()
    }
}

// ---------------------------------------------------------------------------
// Engine resolution (capability detection, never a silent fallback)
// ---------------------------------------------------------------------------

export interface IGraphEngineDescriptor {
    engine: GraphEngine
    label: string
    available: boolean
    reason?: string
}

export const describeGraphEngines = async (neo4jConfig?: INeo4jConfig): Promise<IGraphEngineDescriptor[]> => {
    const descriptors: IGraphEngineDescriptor[] = [
        { engine: 'graphology-local', label: 'Graphology + JSON persistence (local)', available: true }
    ]

    const neo4jAdapter = new Neo4jGraphAdapter('probe', neo4jConfig || { url: '', username: '', password: '' })
    const neo4jStatus = await neo4jAdapter.isAvailable()
    descriptors.push({ engine: 'neo4j', label: 'Neo4j (server)', available: neo4jStatus.available, reason: neo4jStatus.reason })

    const kuzuStatus = await new KuzuGraphAdapter('probe').isAvailable()
    descriptors.push({ engine: 'kuzu', label: 'Kuzu (embedded)', available: kuzuStatus.available, reason: kuzuStatus.reason })

    return descriptors
}

export const resolveGraphAdapter = async (params: {
    engine: GraphEngine
    documentStoreId: string
    neo4jConfig?: INeo4jConfig
    storageDir?: string
}): Promise<IGraphKnowledgeAdapter> => {
    let adapter: IGraphKnowledgeAdapter
    switch (params.engine) {
        case 'neo4j':
            adapter = new Neo4jGraphAdapter(params.documentStoreId, params.neo4jConfig as INeo4jConfig)
            break
        case 'kuzu':
            adapter = new KuzuGraphAdapter(params.documentStoreId)
            break
        case 'graphology-local':
        default:
            adapter = new GraphologyLocalAdapter(params.documentStoreId, { storageDir: params.storageDir })
            break
    }
    const status = await adapter.isAvailable()
    if (!status.available) {
        throw new Error(`Graph engine "${params.engine}" is not available: ${status.reason}`)
    }
    return adapter
}

// ---------------------------------------------------------------------------
// Building the graph from the pipeline output (structure + summary parsing)
// ---------------------------------------------------------------------------

export interface IStructuralGraphInput {
    documentId: string
    sourceId: string
    version: string | number
    documentName?: string
    segments: { segmentId: string; index: number; startPage?: number; endPage?: number; title?: string; chunkIds?: string[] }[]
}

/** Structure that always exists, whatever the content: Document -> Segment -> Chunk. */
export const buildStructuralKnowledgeGraph = (input: IStructuralGraphInput): { entities: IGraphEntity[]; relations: IGraphRelation[] } => {
    const entities: IGraphEntity[] = [
        {
            id: `doc-${input.documentId}`,
            name: input.documentName || input.sourceId || input.documentId,
            type: 'Document',
            documentId: input.documentId,
            sourceId: input.sourceId,
            version: input.version
        }
    ]
    const relations: IGraphRelation[] = []

    for (const segment of input.segments || []) {
        const segmentNodeId = `seg-${segment.segmentId}`
        entities.push({
            id: segmentNodeId,
            name: segment.title || `Segment ${segment.index}`,
            type: 'Segment',
            documentId: input.documentId,
            segmentId: segment.segmentId,
            sourceId: input.sourceId,
            version: input.version,
            metadata: { index: segment.index, startPage: segment.startPage, endPage: segment.endPage }
        })
        relations.push({
            source: `doc-${input.documentId}`,
            target: segmentNodeId,
            type: 'HAS_SEGMENT',
            documentId: input.documentId,
            segmentId: segment.segmentId
        })

        for (const chunkId of segment.chunkIds || []) {
            const chunkNodeId = `chunk-${chunkId}`
            entities.push({
                id: chunkNodeId,
                name: `Chunk ${chunkId}`,
                type: 'Chunk',
                documentId: input.documentId,
                segmentId: segment.segmentId,
                chunkId,
                sourceId: input.sourceId,
                version: input.version
            })
            relations.push({
                source: segmentNodeId,
                target: chunkNodeId,
                type: 'HAS_CHUNK',
                documentId: input.documentId,
                segmentId: segment.segmentId,
                chunkId
            })
        }
    }

    return { entities, relations }
}

/**
 * Parse the structured summary produced by `buildSummaryPrompt` to feed the Knowledge Graph.
 * The LLM does the semantic work (entities / relations), the parsing here is deterministic.
 */
export const parseSummaryForGraph = (
    summary: string
): { entities: IGraphEntity[]; relations: IGraphRelation[]; concepts: IGraphEntity[] } => {
    const entities: IGraphEntity[] = []
    const relations: IGraphRelation[] = []
    const concepts: IGraphEntity[] = []
    if (!summary || !summary.length) return { entities, relations, concepts }

    const lines = summary.split(/\r?\n/)
    let section = ''
    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.length) continue
        if (/^#{1,6}\s*3\.|^\**3\.\s*entit/i.test(line)) {
            section = 'entities'
            continue
        }
        if (/^#{1,6}\s*4\.|^\**4\.\s*relation/i.test(line)) {
            section = 'relations'
            continue
        }
        if (/^#{1,6}\s*2\.|^\**2\.\s*key\s*concept/i.test(line)) {
            section = 'concepts'
            continue
        }
        if (/^#{1,6}\s*[56]\.|^\**[56]\.\s*/i.test(line)) {
            section = ''
            continue
        }

        if (section === 'relations') {
            const match = line.replace(/^[-*]\s*/, '').match(/^(.+?)\s*(?:->|→|--)\s*(.+?)\s*(?:->|→|--)\s*(.+)$/)
            if (match) {
                relations.push({
                    source: match[1].trim(),
                    target: match[3].trim(),
                    type: match[2].trim().toUpperCase().replace(/\s+/g, '_')
                })
            }
            continue
        }

        if (section === 'entities' || section === 'concepts') {
            const bullet = line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '')
            if (!bullet.length || (bullet === line && !section)) continue
            const typed = bullet.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
            const name = (typed ? typed[1] : bullet).split('—')[0].split(':')[0].trim()
            if (!name || name.length > 120) continue
            const entry: IGraphEntity = {
                name,
                type: section === 'entities' ? (typed ? typed[2].trim() : 'Entity') : 'Concept',
                description: bullet
            }
            if (section === 'entities') entities.push(entry)
            else concepts.push(entry)
        }
    }

    return { entities, relations, concepts }
}

/** Remove every artifact of a Document Store: graph file or Neo4j labels. */
export const deleteGraphArtifacts = async (engine: GraphEngine, documentStoreId: string): Promise<void> => {
    if (engine === 'graphology-local') {
        const adapter = new GraphologyLocalAdapter(documentStoreId)
        await adapter.deleteGraph()
        return
    }
    const adapter = await resolveGraphAdapter({ engine, documentStoreId })
    await adapter.deleteGraph()
}

export const listLocalGraphs = (): { documentStoreId: string; path: string; bytes: number }[] => {
    const root = getGraphRoot()
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const filePath = path.join(root, entry.name, 'graph.json')
            return { documentStoreId: entry.name, path: filePath, bytes: existsSync(filePath) ? readFileSync(filePath).length : 0 }
        })
}
