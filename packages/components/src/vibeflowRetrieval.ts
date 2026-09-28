/**
 * VibeFlow — Hybrid Retrieval Pipeline (M7).
 *
 *   Query -> Prompt Optimizer -> Axis decomposition (<= 3) -> Variants (<= 4 per axis, <= 12 total)
 *         -> per axis: Semantic + Keyword (BM25) + Graph  -> RRF merger
 *         -> Global merger (dedup + provenance) -> Reranker -> Top K / Top 50 max
 *         -> Context builder
 *
 * Everything is behind an adapter so a technology is never assumed to be available:
 * each adapter exposes `isAvailable()` and the pipeline reports (instead of hiding) the
 * branches it had to disable. The number of axes, variants, queries and results is reduced
 * dynamically when the query does not justify it.
 */

export type RetrievalMethod = 'semantic' | 'keyword' | 'graph'

export interface IRetrievalProvenance {
    document_id?: string
    document_version?: string
    source_id?: string
    segment_id?: string
    chunk_id?: string
    graph_node_id?: string
    graph_relation_id?: string
    retrieval_method: RetrievalMethod
    score: number
    timestamp: string
}

export interface IRetrievalResult {
    id: string
    content: string
    metadata: Record<string, unknown>
    score: number
    rank?: number
    method: RetrievalMethod
    provenance: IRetrievalProvenance
    /** per method raw scores, preserved through every fusion step */
    scores: Partial<Record<RetrievalMethod | 'rrf' | 'rerank', number>>
}

export interface IRetrievalQuery {
    original: string
    optimized: string
    keywords: string[]
    intent: 'factual' | 'relational' | 'explanatory' | 'mixed'
}

export interface IRetrievalAxis {
    name: string
    query: string
    variants: string[]
}

export interface IAdapterAvailability {
    available: boolean
    reason?: string
}

export interface IQueryOptimizerAdapter {
    name: string
    isAvailable(): IAdapterAvailability
    optimize(query: string): Promise<IRetrievalQuery>
}

export interface IQueryDecompositionAdapter {
    name: string
    isAvailable(): IAdapterAvailability
    decompose(query: IRetrievalQuery, maxAxes?: number): Promise<IRetrievalAxis[]>
}

export interface IQueryVariantGeneratorAdapter {
    name: string
    isAvailable(): IAdapterAvailability
    generate(axis: IRetrievalAxis, maxVariants?: number): Promise<string[]>
}

export interface IRetrieverAdapter {
    name: string
    method: RetrievalMethod
    isAvailable(): IAdapterAvailability
    retrieve(query: string, options: { limit: number; filters?: Record<string, unknown> }): Promise<IRetrievalResult[]>
}

export interface IResultFusionAdapter {
    name: string
    isAvailable(): IAdapterAvailability
    fuse(resultSets: IRetrievalResult[][], options?: { k?: number }): IRetrievalResult[]
}

export interface IRerankerAdapter {
    name: string
    isAvailable(): IAdapterAvailability
    rerank(query: string, results: IRetrievalResult[], options?: { topK?: number }): Promise<IRetrievalResult[]>
}

export interface IRetrievalStageTiming {
    name: string
    durationMs: number
    detail: string
}

export interface IRetrievalTrace {
    originalQuery: string
    optimizedQuery: string
    intent: string
    axes: { name: string; query: string; variants: string[] }[]
    queries: string[]
    perAxis: {
        axis: string
        counts: { semantic: number; keyword: number; graph: number; fused: number }
        fused: IRetrievalResult[]
    }[]
    globalMerged: IRetrievalResult[]
    reranked: IRetrievalResult[]
    selected: IRetrievalResult[]
    stages: IRetrievalStageTiming[]
    thresholds: { topK: number; maxResults: number; minScore: number; contextBudgetTokens: number }
    warnings: string[]
    context?: { text: string; usedResults: number; estimatedTokens: number }
}

// ---------------------------------------------------------------------------
// Text utilities (FR + EN friendly, no dependency)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
    'le',
    'la',
    'les',
    'un',
    'une',
    'des',
    'du',
    'de',
    'dans',
    'sur',
    'pour',
    'par',
    'avec',
    'sans',
    'est',
    'sont',
    'et',
    'ou',
    'que',
    'qui',
    'quoi',
    'dont',
    'ce',
    'cet',
    'cette',
    'ces',
    'il',
    'elle',
    'ils',
    'elles',
    'on',
    'nous',
    'vous',
    'je',
    'tu',
    'au',
    'aux',
    'en',
    'y',
    'a',
    'ai',
    'as',
    'ont',
    'être',
    'avoir',
    'plus',
    'moins',
    'très',
    'tout',
    'tous',
    'toute',
    'toutes',
    'the',
    'a',
    'an',
    'of',
    'to',
    'in',
    'on',
    'for',
    'with',
    'without',
    'is',
    'are',
    'and',
    'or',
    'that',
    'which',
    'what',
    'this',
    'these',
    'those',
    'it',
    'they',
    'we',
    'you',
    'i',
    'at',
    'by',
    'from',
    'as',
    'be',
    'been',
    'was',
    'were',
    'more',
    'less',
    'very'
])

export const normalizeText = (value: string): string =>
    (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()

export const tokenize = (value: string, options: { removeStopwords?: boolean } = {}): string[] => {
    const tokens = normalizeText(value)
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .split(/\s+/)
        .map((token) => token.replace(/^['-]+|['-]+$/g, ''))
        .filter((token) => token.length > 1)
    if (options.removeStopwords === false) return tokens
    return tokens.filter((token) => !STOPWORDS.has(token))
}

/** Small deterministic synonym map so variants can improve recall without an LLM. */
const SYNONYMS: Record<string, string[]> = {
    cout: ['prix', 'budget', 'depense'],
    couts: ['prix', 'budget', 'depenses'],
    chiffre: ['montant', 'valeur', 'donnee'],
    risque: ['danger', 'menace', 'exposition'],
    client: ['utilisateur', 'acheteur', 'partenaire'],
    fournisseur: ['prestataire', 'vendeur'],
    employe: ['salarie', 'collaborateur', 'personnel'],
    revenu: ['chiffre affaires', 'recette'],
    regle: ['reglement', 'politique', 'norme'],
    processus: ['procedure', 'workflow', 'etape'],
    securite: ['protection', 'conformite'],
    probleme: ['incident', 'anomalie', 'dysfonctionnement'],
    time: ['deadline', 'schedule'],
    cost: ['price', 'budget', 'expense'],
    risk: ['threat', 'exposure'],
    customer: ['client', 'buyer', 'partner']
}

export const expandSynonyms = (keyword: string): string[] => SYNONYMS[normalizeText(keyword)] || []

// ---------------------------------------------------------------------------
// Query optimizer (deterministic, always available)
// ---------------------------------------------------------------------------

export class HeuristicQueryOptimizer implements IQueryOptimizerAdapter {
    name = 'heuristic-query-optimizer'

    isAvailable(): IAdapterAvailability {
        return { available: true }
    }

    async optimize(query: string): Promise<IRetrievalQuery> {
        const original = (query || '').trim()
        const cleaned = original
            .replace(/\s+/g, ' ')
            .replace(/^(please|peux-tu|peux tu|can you|could you|s'il te plait|s'il vous plait)\s+/i, '')
            .trim()
        const normalized = normalizeText(cleaned)

        let intent: IRetrievalQuery['intent'] = 'factual'
        const relational = /(relation|lien|entre|compare|versus|\bvs\b|difference|impact|influence|depend)/.test(normalized)
        const explanatory = /(pourquoi|comment|explique|explain|why|how|cause|raison)/.test(normalized)
        const factual = /(combien|quel|quelle|quels|quelles|quand|ou se trouve|what|which|when|how much|how many)/.test(normalized)
        if (relational && explanatory) intent = 'mixed'
        else if (relational) intent = 'relational'
        else if (explanatory) intent = 'explanatory'
        else if (factual) intent = 'factual'

        const keywords = [...new Set(tokenize(cleaned))].slice(0, 12)

        return { original, optimized: cleaned.length ? cleaned : original, keywords, intent }
    }
}

// ---------------------------------------------------------------------------
// Axis decomposition (dynamic, <= maxAxes)
// ---------------------------------------------------------------------------

export class HeuristicQueryDecompositionAdapter implements IQueryDecompositionAdapter {
    name = 'heuristic-axis-decomposition'
    maxAxes = 3

    isAvailable(): IAdapterAvailability {
        return { available: true }
    }

    async decompose(query: IRetrievalQuery, maxAxes = 3): Promise<IRetrievalAxis[]> {
        const limit = Math.max(1, Math.min(maxAxes, this.maxAxes))
        const clauses = query.optimized
            .split(/\s*(?:;|\bet\b|\band\b|\bpuis\b|\bthen\b|\baussi\b|\bcompare\b|\bentre\b)\s*/i)
            .map((clause) => clause.trim())
            .filter((clause) => tokenize(clause).length >= 2)

        const axes: IRetrievalAxis[] = []

        if (clauses.length >= 2) {
            for (const clause of clauses.slice(0, limit)) {
                axes.push({ name: clause.slice(0, 40), query: clause, variants: [] })
            }
        } else if (query.intent === 'mixed' || query.intent === 'relational') {
            // factual anchor + relation oriented axis + context axis
            axes.push({ name: 'facts', query: `faits et données: ${query.optimized}`, variants: [] })
            axes.push({ name: 'relations', query: `relations entre les entités: ${query.optimized}`, variants: [] })
            axes.push({ name: 'context', query: `contexte et explications: ${query.optimized}`, variants: [] })
        } else if (query.intent === 'explanatory') {
            axes.push({ name: 'explanation', query: query.optimized, variants: [] })
            axes.push({ name: 'context', query: `contexte: ${query.optimized}`, variants: [] })
        } else {
            axes.push({ name: 'facts', query: query.optimized, variants: [] })
        }

        return axes.slice(0, limit)
    }
}

// ---------------------------------------------------------------------------
// Variant generation (<= maxVariants per axis, <= 12 queries total)
// ---------------------------------------------------------------------------

export class HeuristicQueryVariantGeneratorAdapter implements IQueryVariantGeneratorAdapter {
    name = 'heuristic-variant-generator'
    maxVariantsPerAxis = 4

    isAvailable(): IAdapterAvailability {
        return { available: true }
    }

    async generate(axis: IRetrievalAxis, maxVariants = 4): Promise<string[]> {
        const limit = Math.max(1, Math.min(maxVariants, this.maxVariantsPerAxis))
        const base = (axis.query || '').trim()
        const keywords = tokenize(base)
        const variants: string[] = [base]

        const keywordOnly = keywords.join(' ')
        if (keywordOnly.length > 2 && keywordOnly !== base) variants.push(keywordOnly)

        const expanded = [...new Set(keywords.flatMap((keyword) => [keyword, ...expandSynonyms(keyword)]))]
        if (expanded.length > keywords.length) {
            variants.push(expanded.slice(0, 10).join(' '))
        }

        // question -> noun phrase form (drops interrogative words, keeps the subject)
        const nounPhrase = keywords
            .filter((keyword) => !/^(combien|quel|quelle|quels|quelles|quand|what|which|when|how)$/.test(keyword))
            .join(' ')
        if (nounPhrase.length > 2 && !variants.includes(nounPhrase)) variants.push(nounPhrase)

        return [...new Set(variants)].slice(0, limit)
    }
}

// ---------------------------------------------------------------------------
// Retrievers
// ---------------------------------------------------------------------------

export interface ICorpusDocument {
    id: string
    content: string
    metadata: Record<string, unknown>
}

/**
 * BM25 keyword retriever over an in-memory corpus (the Document Store chunks are loaded by the
 * caller). Real BM25 scoring: idf, term frequency saturation (k1) and length normalisation (b).
 */
export class Bm25KeywordRetriever implements IRetrieverAdapter {
    name = 'bm25-keyword-retriever'
    method: RetrievalMethod = 'keyword'
    private documents: ICorpusDocument[]
    private k1 = 1.5
    private b = 0.75
    private docTokens: string[][] = []
    private docFrequency: Map<string, number> = new Map()
    private averageLength = 1

    constructor(documents: ICorpusDocument[] = []) {
        this.documents = documents
        this.buildIndex()
    }

    setDocuments(documents: ICorpusDocument[]): void {
        this.documents = documents || []
        this.buildIndex()
    }

    isAvailable(): IAdapterAvailability {
        if (!this.documents.length) return { available: false, reason: 'No indexable chunk available for lexical retrieval' }
        return { available: true }
    }

    private buildIndex(): void {
        this.docTokens = this.documents.map((document) => tokenize(document.content))
        this.docFrequency = new Map()
        for (const tokens of this.docTokens) {
            for (const token of new Set(tokens)) {
                this.docFrequency.set(token, (this.docFrequency.get(token) || 0) + 1)
            }
        }
        const total = this.docTokens.reduce((sum, tokens) => sum + tokens.length, 0)
        this.averageLength = this.docTokens.length ? total / this.docTokens.length : 1
    }

    private idf(term: string): number {
        const n = this.documents.length
        const df = this.docFrequency.get(term) || 0
        return Math.log(1 + (n - df + 0.5) / (df + 0.5))
    }

    async retrieve(query: string, options: { limit: number }): Promise<IRetrievalResult[]> {
        const terms = [...new Set(tokenize(query))]
        if (!terms.length) return []

        const scored = this.documents.map((document, index) => {
            const tokens = this.docTokens[index]
            const length = tokens.length || 1
            const frequencies = new Map<string, number>()
            for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1)

            let score = 0
            for (const term of terms) {
                const frequency = frequencies.get(term) || 0
                if (!frequency) continue
                const numerator = frequency * (this.k1 + 1)
                const denominator = frequency + this.k1 * (1 - this.b + (this.b * length) / this.averageLength)
                score += this.idf(term) * (numerator / denominator)
            }
            return { document, score }
        })

        const timestamp = new Date().toISOString()
        return scored
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, options.limit)
            .map((entry, index) => ({
                id: String(entry.document.id),
                content: entry.document.content,
                metadata: entry.document.metadata,
                score: entry.score,
                rank: index + 1,
                method: 'keyword' as RetrievalMethod,
                scores: { keyword: entry.score },
                provenance: {
                    document_id: entry.document.metadata?.documentId as string,
                    document_version: entry.document.metadata?.version as string,
                    source_id: entry.document.metadata?.sourceId as string,
                    segment_id: entry.document.metadata?.segmentId as string,
                    chunk_id: entry.document.metadata?.chunkId as string,
                    retrieval_method: 'keyword' as RetrievalMethod,
                    score: entry.score,
                    timestamp
                }
            }))
    }
}

/**
 * Semantic retriever. The embeddings/vector store live in Flowise, so the actual lookup is
 * injected: the adapter is only advertised as available when a lookup function is provided.
 */
export class SemanticRetrieverAdapter implements IRetrieverAdapter {
    name = 'flowise-vector-semantic-retriever'
    method: RetrievalMethod = 'semantic'
    private lookup?: (query: string, options: { limit: number }) => Promise<IRetrievalResult[]>
    private unavailableReason?: string

    constructor(lookup?: (query: string, options: { limit: number }) => Promise<IRetrievalResult[]>, unavailableReason?: string) {
        this.lookup = lookup
        this.unavailableReason = unavailableReason
    }

    isAvailable(): IAdapterAvailability {
        if (!this.lookup) {
            return {
                available: false,
                reason: this.unavailableReason || 'No embedding model / vector store configured on this Document Store'
            }
        }
        return { available: true }
    }

    async retrieve(query: string, options: { limit: number }): Promise<IRetrievalResult[]> {
        if (!this.lookup) return []
        return await this.lookup(query, options)
    }
}

export interface IGraphLookup {
    search: (query: string, limit: number) => Promise<{ nodes: { id: string; name: string; type?: string; documentId?: string }[] }>
    traverse: (
        nodeId: string,
        depth: number
    ) => Promise<{
        nodes: { id: string; attributes: Record<string, any> }[]
        relations: { id: string; source: string; target: string; attributes: Record<string, any> }[]
    }>
}

/** Graph retriever: entity search then controlled traversal, mapped to source segments/chunks. */
export class GraphRetrieverAdapter implements IRetrieverAdapter {
    name = 'knowledge-graph-retriever'
    method: RetrievalMethod = 'graph'
    private lookup?: IGraphLookup
    private depth: number

    constructor(lookup?: IGraphLookup, options: { depth?: number } = {}) {
        this.lookup = lookup
        this.depth = options.depth && options.depth > 0 ? Math.min(options.depth, 3) : 2
    }

    isAvailable(): IAdapterAvailability {
        if (!this.lookup) return { available: false, reason: 'No knowledge graph available for this Document Store' }
        return { available: true }
    }

    async retrieve(query: string, options: { limit: number }): Promise<IRetrievalResult[]> {
        if (!this.lookup) return []
        const found = await this.lookup.search(query, options.limit)
        if (!found.nodes.length) return []

        const results: IRetrievalResult[] = []
        const timestamp = new Date().toISOString()
        const seen = new Set<string>()

        for (const node of found.nodes.slice(0, 3)) {
            const subgraph = await this.lookup.traverse(node.id, this.depth)
            for (const related of subgraph.nodes) {
                const segmentId = related.attributes?.segmentId
                const documentId = related.attributes?.documentId
                const key = `${segmentId || related.id}`
                if (seen.has(key)) continue
                seen.add(key)
                const relations = subgraph.relations.filter((relation) => relation.source === related.id || relation.target === related.id)
                results.push({
                    id: `graph:${related.id}`,
                    content: `${related.attributes?.name || related.id}${
                        related.attributes?.description ? ` — ${related.attributes.description}` : ''
                    }`,
                    metadata: {
                        documentId,
                        segmentId,
                        sourceId: related.attributes?.sourceId,
                        version: related.attributes?.version,
                        graphNodeId: related.id,
                        graphNodeType: related.attributes?.type,
                        relations: relations.map((relation) => ({
                            id: relation.id,
                            source: relation.source,
                            target: relation.target,
                            type: relation.attributes?.type
                        }))
                    },
                    score: related.id === node.id ? 1 : 0.6,
                    method: 'graph',
                    scores: { graph: related.id === node.id ? 1 : 0.6 },
                    provenance: {
                        document_id: documentId,
                        document_version: related.attributes?.version,
                        source_id: related.attributes?.sourceId,
                        segment_id: segmentId,
                        graph_node_id: related.id,
                        graph_relation_id: relations[0]?.id,
                        retrieval_method: 'graph',
                        score: related.id === node.id ? 1 : 0.6,
                        timestamp
                    }
                })
            }
        }

        return results.sort((a, b) => b.score - a.score).slice(0, options.limit)
    }
}

// ---------------------------------------------------------------------------
// Fusion (RRF) and reranking
// ---------------------------------------------------------------------------

/** Reciprocal Rank Fusion, keeping every per-method score and the provenance. */
export class RrfFusionAdapter implements IResultFusionAdapter {
    name = 'rrf-fusion'
    k = 60

    isAvailable(): IAdapterAvailability {
        return { available: true }
    }

    fuse(resultSets: IRetrievalResult[][], options: { k?: number } = {}): IRetrievalResult[] {
        const k = options.k && options.k > 0 ? options.k : this.k
        const merged = new Map<string, IRetrievalResult>()

        resultSets.forEach((results) => {
            ;(results || []).forEach((result, index) => {
                const key = result.provenance.chunk_id || result.provenance.segment_id || result.id
                const rrfScore = 1 / (k + index + 1)
                const existing = merged.get(key)
                if (existing) {
                    existing.score += rrfScore
                    existing.scores = { ...existing.scores, ...result.scores, rrf: (existing.scores.rrf || 0) + rrfScore }
                    existing.method = existing.method === result.method ? existing.method : existing.method
                    existing.provenance = {
                        ...existing.provenance,
                        graph_node_id: existing.provenance.graph_node_id || result.provenance.graph_node_id,
                        graph_relation_id: existing.provenance.graph_relation_id || result.provenance.graph_relation_id,
                        chunk_id: existing.provenance.chunk_id || result.provenance.chunk_id,
                        segment_id: existing.provenance.segment_id || result.provenance.segment_id,
                        document_id: existing.provenance.document_id || result.provenance.document_id
                    }
                } else {
                    merged.set(key, {
                        ...result,
                        score: rrfScore,
                        scores: { ...result.scores, rrf: rrfScore },
                        provenance: { ...result.provenance, retrieval_method: result.method }
                    })
                }
            })
        })

        return [...merged.values()].sort((a, b) => b.score - a.score).map((result, index) => ({ ...result, rank: index + 1 }))
    }
}

export class HeuristicRerankerAdapter implements IRerankerAdapter {
    name = 'heuristic-relevance-reranker'

    isAvailable(): IAdapterAvailability {
        return { available: true }
    }

    async rerank(query: string, results: IRetrievalResult[], options: { topK?: number } = {}): Promise<IRetrievalResult[]> {
        const queryTerms = new Set(tokenize(query))
        const normalizedQuery = normalizeText(query)
        const timestamp = new Date().toISOString()

        const reranked = (results || []).map((result) => {
            const content = normalizeText(result.content)
            const contentTerms = new Set(tokenize(result.content))
            const covered = [...queryTerms].filter((term) => contentTerms.has(term)).length
            const coverage = queryTerms.size ? covered / queryTerms.size : 0

            const phraseBonus = normalizedQuery.length > 8 && content.includes(normalizedQuery) ? 0.25 : 0
            const graphBonus = result.scores.graph ? Math.min(0.15, result.scores.graph * 0.15) : 0
            const exactKeywordBonus = [...queryTerms].some((term) => content.includes(term)) ? 0.05 : 0
            const lengthPenalty = result.content.length > 4000 ? 0.05 : 0
            const metadataBonus = result.metadata?.hasSummary ? 0.03 : 0

            const rerankScore = Math.max(0, 0.55 * coverage + phraseBonus + graphBonus + exactKeywordBonus + metadataBonus - lengthPenalty)

            return {
                ...result,
                scores: { ...result.scores, rerank: rerankScore },
                provenance: { ...result.provenance, score: rerankScore, timestamp }
            }
        })

        return reranked
            .sort((a, b) => (b.scores.rerank || 0) - (a.scores.rerank || 0) || b.score - a.score)
            .map((result, index) => ({ ...result, rank: index + 1, score: result.scores.rerank || result.score }))
            .slice(0, options.topK && options.topK > 0 ? options.topK : undefined)
    }
}

export class CrossEncoderRerankerAdapter implements IRerankerAdapter {
    name = 'cross-encoder-reranker'

    isAvailable(): IAdapterAvailability {
        return {
            available: false,
            reason: 'No cross-encoder reranker installed on this host; the pipeline falls back to the heuristic reranker'
        }
    }

    async rerank(): Promise<IRetrievalResult[]> {
        throw new Error('Cross-encoder reranker is not available on this host')
    }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export const VIBEFLOW_MAX_AXES = 3
export const VIBEFLOW_MAX_VARIANTS_PER_AXIS = 4
export const VIBEFLOW_MAX_QUERIES = 12
export const VIBEFLOW_MAX_RESULTS = 50
export const VIBEFLOW_DEFAULT_TOP_K = 50

export interface IHybridRetrievalOptions {
    topK?: number
    maxResults?: number
    maxAxes?: number
    maxVariantsPerAxis?: number
    minScore?: number
    contextBudgetTokens?: number
    perRetrieverLimit?: number
    filters?: Record<string, unknown>
}

export interface IHybridRetrievalReport {
    results: IRetrievalResult[]
    trace: IRetrievalTrace
}

const nowMs = () => Date.now()

/**
 * Runs the whole pipeline. Any adapter that is unavailable is reported in `trace.warnings`
 * and its branch is skipped: an optional capability never breaks the pipeline.
 */
export const runHybridRetrieval = async (params: {
    query: string
    optimizer?: IQueryOptimizerAdapter
    decomposition?: IQueryDecompositionAdapter
    variants?: IQueryVariantGeneratorAdapter
    semantic: IRetrieverAdapter
    keyword: IRetrieverAdapter
    graph: IRetrieverAdapter
    fusion?: IResultFusionAdapter
    reranker?: IRerankerAdapter
    options?: IHybridRetrievalOptions
    buildContext?: boolean
}): Promise<IHybridRetrievalReport> => {
    const options = params.options || {}
    const topK = Math.min(
        options.topK && options.topK > 0 ? options.topK : VIBEFLOW_DEFAULT_TOP_K,
        options.maxResults || VIBEFLOW_MAX_RESULTS
    )
    const perRetrieverLimit = options.perRetrieverLimit && options.perRetrieverLimit > 0 ? options.perRetrieverLimit : 25
    const minScore = typeof options.minScore === 'number' ? options.minScore : 0
    const contextBudgetTokens = options.contextBudgetTokens && options.contextBudgetTokens > 0 ? options.contextBudgetTokens : 4000

    const stages: IRetrievalStageTiming[] = []
    const warnings: string[] = []
    const timed = async <T>(name: string, detail: string, action: () => Promise<T>): Promise<T> => {
        const started = nowMs()
        const result = await action()
        stages.push({ name, durationMs: nowMs() - started, detail })
        return result
    }

    const optimizer = params.optimizer || new HeuristicQueryOptimizer()
    const decomposition = params.decomposition || new HeuristicQueryDecompositionAdapter()
    const variantGenerator = params.variants || new HeuristicQueryVariantGeneratorAdapter()
    const fusion = params.fusion || new RrfFusionAdapter()
    const reranker = params.reranker || new HeuristicRerankerAdapter()

    const optimizerStatus = optimizer.isAvailable()
    if (!optimizerStatus.available) warnings.push(`query optimizer unavailable (${optimizerStatus.reason})`)
    const query = optimizerStatus.available
        ? await timed('prompt-optimization', 'query optimized', () => optimizer.optimize(params.query))
        : { original: params.query, optimized: params.query, keywords: tokenize(params.query), intent: 'factual' as const }

    const decompositionStatus = decomposition.isAvailable()
    if (!decompositionStatus.available) warnings.push(`axis decomposition unavailable (${decompositionStatus.reason})`)
    const axes = decompositionStatus.available
        ? await timed('axis-decomposition', 'axes computed', () =>
              decomposition.decompose(query, Math.min(options.maxAxes || VIBEFLOW_MAX_AXES, VIBEFLOW_MAX_AXES))
          )
        : [{ name: 'default', query: query.optimized, variants: [] }]

    const withVariants: IRetrievalAxis[] = []
    let totalQueries = 0
    for (const axis of axes) {
        const variantsStatus = variantGenerator.isAvailable()
        if (!variantsStatus.available) warnings.push(`variant generation unavailable (${variantsStatus.reason})`)
        const generated = variantsStatus.available
            ? await variantGenerator.generate(
                  axis,
                  Math.min(options.maxVariantsPerAxis || VIBEFLOW_MAX_VARIANTS_PER_AXIS, VIBEFLOW_MAX_VARIANTS_PER_AXIS)
              )
            : [axis.query]
        const remaining = Math.max(0, VIBEFLOW_MAX_QUERIES - totalQueries)
        const kept = generated.slice(0, Math.max(0, remaining))
        totalQueries += kept.length
        withVariants.push({ ...axis, variants: kept })
    }

    const retrieverStatus = {
        semantic: params.semantic.isAvailable(),
        keyword: params.keyword.isAvailable(),
        graph: params.graph.isAvailable()
    }
    if (!retrieverStatus.semantic.available) warnings.push(`semantic retrieval disabled (${retrieverStatus.semantic.reason})`)
    if (!retrieverStatus.keyword.available) warnings.push(`keyword retrieval disabled (${retrieverStatus.keyword.reason})`)
    if (!retrieverStatus.graph.available) warnings.push(`graph retrieval disabled (${retrieverStatus.graph.reason})`)
    if (!retrieverStatus.semantic.available && !retrieverStatus.keyword.available && !retrieverStatus.graph.available) {
        throw new Error('No retrieval branch is available for this Document Store (no vector store, no chunks, no graph)')
    }

    const perAxis: IRetrievalTrace['perAxis'] = []
    const globalPool: IRetrievalResult[][] = []

    for (const axis of withVariants) {
        const started = nowMs()
        const semanticResults: IRetrievalResult[] = []
        const keywordResults: IRetrievalResult[] = []
        const graphResults: IRetrievalResult[] = []

        for (const variant of axis.variants) {
            if (retrieverStatus.semantic.available) {
                semanticResults.push(...(await params.semantic.retrieve(variant, { limit: perRetrieverLimit, filters: options.filters })))
            }
            if (retrieverStatus.keyword.available) {
                keywordResults.push(...(await params.keyword.retrieve(variant, { limit: perRetrieverLimit, filters: options.filters })))
            }
            if (retrieverStatus.graph.available) {
                graphResults.push(...(await params.graph.retrieve(variant, { limit: perRetrieverLimit, filters: options.filters })))
            }
        }

        const fused = fusion.fuse([semanticResults, keywordResults, graphResults])
        globalPool.push(fused)
        perAxis.push({
            axis: axis.name,
            counts: {
                semantic: semanticResults.length,
                keyword: keywordResults.length,
                graph: graphResults.length,
                fused: fused.length
            },
            fused: fused.slice(0, perRetrieverLimit)
        })
        stages.push({
            name: `retrieval+rrf:${axis.name}`,
            durationMs: nowMs() - started,
            detail: `${semanticResults.length} semantic / ${keywordResults.length} keyword / ${graphResults.length} graph -> ${fused.length} after RRF`
        })
    }

    const globalMerged = await timed('global-merger', 'cross-axis merge and dedup', async () => fusion.fuse(globalPool))
    const reranked = await timed('reranking', 'relevance reranking', () =>
        reranker.rerank(query.optimized, globalMerged, { topK: globalMerged.length })
    )
    const selected = reranked.filter((result) => (result.scores.rerank ?? result.score) >= minScore).slice(0, topK)

    let context: IRetrievalTrace['context']
    if (params.buildContext !== false) {
        context = await timed('context-builder', `budget ${contextBudgetTokens} tokens`, async () => {
            const parts: string[] = []
            let usedTokens = 0
            let usedResults = 0
            for (const result of selected) {
                const estimatedTokens = Math.ceil(result.content.length / 4)
                if (usedTokens + estimatedTokens > contextBudgetTokens) continue
                usedTokens += estimatedTokens
                usedResults += 1
                parts.push(
                    `### Source ${usedResults} (${result.provenance.retrieval_method}${
                        result.provenance.document_id ? ` · document ${result.provenance.document_id}` : ''
                    }${result.provenance.segment_id ? ` · segment ${result.provenance.segment_id}` : ''})\n${result.content}`
                )
            }
            return { text: parts.join('\n\n'), usedResults, estimatedTokens: usedTokens }
        })
    }

    if (selected.length < topK) {
        warnings.push(
            `only ${selected.length} result(s) passed the quality threshold (top K requested: ${topK}); results are never padded artificially`
        )
    }

    const rerankerStatus = reranker.isAvailable()
    if (!rerankerStatus.available) warnings.push(`reranker unavailable (${rerankerStatus.reason})`)

    return {
        results: selected,
        trace: {
            originalQuery: query.original,
            optimizedQuery: query.optimized,
            intent: query.intent,
            axes: withVariants.map((axis) => ({ name: axis.name, query: axis.query, variants: axis.variants })),
            queries: withVariants.flatMap((axis) => axis.variants),
            perAxis,
            globalMerged: globalMerged.slice(0, topK),
            reranked,
            selected,
            stages,
            thresholds: { topK, maxResults: options.maxResults || VIBEFLOW_MAX_RESULTS, minScore, contextBudgetTokens },
            warnings,
            context
        }
    }
}

/** Build the final prompt for the generative step, keeping the sources and their provenance. */
export const buildRetrievalPrompt = (params: {
    question: string
    context: string
    sources: IRetrievalResult[]
}): { system: string; user: string } => ({
    system:
        'You are a retrieval-grounded assistant. Answer ONLY with the provided context. ' +
        'Cite the sources you used (document, segment). If the context does not contain the answer, say so explicitly.',
    user:
        `Question:\n${params.question}\n\nContext (${params.sources.length} source(s)):\n${params.context}\n\n` +
        'Answer with the sources referenced inline, and list the source identifiers you used.'
})
