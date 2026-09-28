import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'

/**
 * VibeFlow — Advanced Document Processing pipeline (M6).
 *
 * Stages, in order:
 *   documents -> Document Fractionator -> Extractor output (cleaned Markdown)
 *             -> Cleaner -> temporary Markdown backup -> optional Summary -> Splitter
 *
 * Everything in this module is pure (apart from the temporary backup helpers), so the stages can
 * be tested and reused independently of the server, the job queue and the UI.
 */

export const VIBEFLOW_SEGMENT_MAX_PAGES = 3
export const VIBEFLOW_SEGMENT_MIN_PAGES_BEFORE_CUT = 1
export const VIBEFLOW_DOCUMENT_TMP_PATH_ENV = 'VIBEFLOW_DOCSTORE_TMP_PATH'

export interface IPageText {
    page: number
    text: string
}

export interface ISegment {
    index: number
    startPage: number
    endPage: number
    text: string
    characters: number
    words: number
    splitReason: 'page-limit' | 'semantic-boundary' | 'end-of-document'
    title?: string
}

export interface IFractionateOptions {
    maxPagesPerSegment?: number
    minPagesBeforeSemanticCut?: number
    detectSemanticBoundaries?: boolean
}

export interface IProvenance {
    document_id: string
    document_version: string
    source_id: string
    segment_id?: string
    chunk_id?: string
    graph_node_id?: string
    graph_relation_id?: string
    retrieval_method?: string
    score?: number
    timestamp: string
}

const BOUNDARY_PATTERNS: RegExp[] = [
    /^#{1,3}\s+\S/, // markdown heading
    /^(chapter|chapitre|section|partie|part)\s+[\dIVXLC]+/i, // chapter / section numbering
    /^\d+(\.\d+){0,3}\s+[A-ZÀ-Ý]/, // 1.2.3 Title
    /^[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9\s'’,;:()-]{6,}$/ // ALL CAPS title line
]

const PAGE_NUMBER_ONLY = /^\s*(page\s*)?\d{1,4}\s*(\/\s*\d{1,4})?\s*$/i
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g

/** A page "starts a section" when one of its first meaningful lines looks like a title. */
export const startsSemanticSection = (text: string): boolean => {
    if (!text) return false
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 4)
    return lines.some((line) => BOUNDARY_PATTERNS.some((pattern) => pattern.test(line)))
}

const firstTitle = (text: string): string | undefined => {
    const line = text
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry.length > 0 && BOUNDARY_PATTERNS.some((pattern) => pattern.test(entry)))
    return line ? line.replace(/^#{1,3}\s*/, '').slice(0, 120) : undefined
}

export const countWords = (text: string): number => (text ? text.trim().split(/\s+/).filter(Boolean).length : 0)

/**
 * Deterministic Document Fractionator.
 *
 * Rules:
 *  - a segment never exceeds `maxPagesPerSegment` pages (3 by default),
 *  - a segment is preferentially closed when the next page starts a new section
 *    (so a chapter is not cut in the middle when it can be avoided),
 *  - segments are contiguous and cover the whole document.
 */
export const fractionatePages = (pages: IPageText[], options: IFractionateOptions = {}): ISegment[] => {
    const maxPages = options.maxPagesPerSegment && options.maxPagesPerSegment > 0 ? options.maxPagesPerSegment : VIBEFLOW_SEGMENT_MAX_PAGES
    const minPagesBeforeCut =
        options.minPagesBeforeSemanticCut && options.minPagesBeforeSemanticCut > 0
            ? options.minPagesBeforeSemanticCut
            : VIBEFLOW_SEGMENT_MIN_PAGES_BEFORE_CUT
    const detectBoundaries = options.detectSemanticBoundaries !== false

    const ordered = [...pages].filter((page) => page && typeof page.page === 'number').sort((a, b) => a.page - b.page)
    const segments: ISegment[] = []
    let current: IPageText[] = []
    let splitReason: ISegment['splitReason'] = 'end-of-document'

    const closeSegment = (reason: ISegment['splitReason']) => {
        if (!current.length) return
        const text = current.map((page) => page.text ?? '').join('\n\n')
        segments.push({
            index: segments.length + 1,
            startPage: current[0].page,
            endPage: current[current.length - 1].page,
            text,
            characters: text.length,
            words: countWords(text),
            splitReason: reason,
            title: firstTitle(text)
        })
        current = []
    }

    for (const page of ordered) {
        if (current.length >= maxPages) {
            closeSegment('page-limit')
            splitReason = 'page-limit'
        } else if (
            detectBoundaries &&
            current.length >= minPagesBeforeCut &&
            current.length >= 1 &&
            startsSemanticSection(page.text) &&
            current.length >= 1 &&
            // only cut when the current segment is not empty and we already have at least one page
            current.length >= minPagesBeforeCut
        ) {
            closeSegment('semantic-boundary')
            splitReason = 'semantic-boundary'
        }
        current.push(page)
    }
    closeSegment(splitReason === 'end-of-document' ? 'end-of-document' : splitReason)

    return segments
}

export interface ICleaningReport {
    text: string
    removedPageNumbers: number
    removedRepeatedLines: number
    collapsedBlankLines: number
    normalizedCharacters: number
}

/**
 * Cleaner: normalises Unicode, removes isolated page numbers, repeated headers/footers,
 * collapses blank runs, normalises list markers and heading spacing.
 * The meaning of the content is never changed.
 */
export const cleanMarkdown = (input: string): ICleaningReport => {
    const report: ICleaningReport = {
        text: input || '',
        removedPageNumbers: 0,
        removedRepeatedLines: 0,
        collapsedBlankLines: 0,
        normalizedCharacters: 0
    }
    if (!input || !input.length) return report

    let text = input.normalize('NFC').replace(ZERO_WIDTH, '')
    report.normalizedCharacters = input.length - text.length

    // Remove OCR artefacts / control characters except tab and newlines
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

    const lines = text.split(/\r?\n/)
    const frequency = new Map<string, number>()
    for (const line of lines) {
        const key = line.trim()
        if (key.length < 4 || key.length > 120) continue
        frequency.set(key, (frequency.get(key) || 0) + 1)
    }

    const cleanedLines: string[] = []
    let blankRun = 0
    for (const rawLine of lines) {
        const line = rawLine.replace(/[ \t]+$/g, '')
        const trimmed = line.trim()

        if (PAGE_NUMBER_ONLY.test(trimmed)) {
            report.removedPageNumbers += 1
            continue
        }
        // repeated header/footer candidate: many occurrences and no sentence punctuation
        if (trimmed.length >= 4 && trimmed.length <= 120 && (frequency.get(trimmed) || 0) >= 3 && !/[.!?:;]$/.test(trimmed)) {
            report.removedRepeatedLines += 1
            continue
        }
        if (!trimmed.length) {
            blankRun += 1
            if (blankRun > 1) {
                report.collapsedBlankLines += 1
                continue
            }
            cleanedLines.push('')
            continue
        }
        blankRun = 0

        let normalized = line
        normalized = normalized.replace(/^(\s*)[*+•]\s+/, '$1- ') // bullet normalisation
        normalized = normalized.replace(/^(#{1,6})\s{0,}(?=\S)/, (_match, hashes: string) => `${hashes} `) // heading spacing
        cleanedLines.push(normalized)
    }

    report.text = cleanedLines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    return report
}

/** Deterministic, traceable segment file name (per Document Store structure). */
export const buildSegmentPath = (params: {
    documentStoreId: string
    sourceId: string
    version: string | number
    index: number
    startPage?: number
    endPage?: number
    extension?: string
}): string => {
    const safe = (value: string) => String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
    const extension = (params.extension || 'md').replace(/^\./, '')
    const pages = params.startPage !== undefined && params.endPage !== undefined ? `-pages-${params.startPage}-${params.endPage}` : ''
    return `${safe(params.documentStoreId)}/${safe(params.sourceId)}/v${safe(String(params.version))}/segment-${String(
        params.index
    ).padStart(4, '0')}${pages}.${extension}`
}

export const buildDocumentVersion = (contentHash: string): string => {
    const value = (contentHash || '').trim()
    return value.length ? value.slice(0, 12) : `v${Date.now().toString(36)}`
}

export const makeProvenance = (
    params: Partial<IProvenance> & { document_id: string; document_version: string; source_id: string }
): IProvenance => ({
    document_id: params.document_id,
    document_version: params.document_version,
    source_id: params.source_id,
    segment_id: params.segment_id,
    chunk_id: params.chunk_id,
    graph_node_id: params.graph_node_id,
    graph_relation_id: params.graph_relation_id,
    retrieval_method: params.retrieval_method,
    score: params.score,
    timestamp: params.timestamp || new Date().toISOString()
})

// ---------------------------------------------------------------------------
// Temporary Markdown backup (one directory per Document Store, configurable root)
// ---------------------------------------------------------------------------

export const getDocumentTmpRoot = (): string => {
    const configured = process.env[VIBEFLOW_DOCUMENT_TMP_PATH_ENV]
    if (configured && configured.trim().length) return path.resolve(configured.trim())
    return path.join(os.tmpdir(), 'vibeflow-docstore')
}

export const getDocumentStoreTmpDir = (documentStoreId: string): string => {
    const safe = String(documentStoreId).replace(/[^a-zA-Z0-9._-]/g, '_')
    return path.join(getDocumentTmpRoot(), safe)
}

export interface IBackupResult {
    root: string
    files: { path: string; relativePath: string; characters: number; segmentIndex: number }[]
}

/**
 * Persist the cleaned segments as Markdown before indexing, with deterministic (collision free)
 * names, and `overwrite` control so a re-run does not create duplicates.
 */
export const writeSegmentBackups = (params: {
    documentStoreId: string
    sourceId: string
    version: string | number
    segments: { index: number; startPage?: number; endPage?: number; text: string }[]
    overwrite?: boolean
}): IBackupResult => {
    const root = getDocumentStoreTmpDir(params.documentStoreId)
    const files: IBackupResult['files'] = []

    for (const segment of params.segments) {
        const relativePath = buildSegmentPath({
            documentStoreId: params.documentStoreId,
            sourceId: params.sourceId,
            version: params.version,
            index: segment.index,
            startPage: segment.startPage,
            endPage: segment.endPage
        })
        const absolutePath = path.join(root, relativePath)
        mkdirSync(path.dirname(absolutePath), { recursive: true })
        if (existsSync(absolutePath) && params.overwrite === false) {
            files.push({ path: absolutePath, relativePath, characters: 0, segmentIndex: segment.index })
            continue
        }
        writeFileSync(absolutePath, segment.text, 'utf8')
        files.push({ path: absolutePath, relativePath, characters: segment.text.length, segmentIndex: segment.index })
    }

    return { root, files }
}

/** Cleanup policy: remove backups older than `maxAgeMs` (default 24h). Never touches other stores. */
export const cleanupSegmentBackups = (params: { documentStoreId?: string; maxAgeMs?: number } = {}): { removed: number; root: string } => {
    const root = params.documentStoreId ? getDocumentStoreTmpDir(params.documentStoreId) : getDocumentTmpRoot()
    const maxAgeMs = params.maxAgeMs && params.maxAgeMs > 0 ? params.maxAgeMs : 24 * 60 * 60 * 1000
    let removed = 0
    if (!existsSync(root)) return { removed, root }

    const cutoff = Date.now() - maxAgeMs
    const walk = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                walk(entryPath)
                continue
            }
            try {
                if (statSync(entryPath).mtimeMs < cutoff) {
                    rmSync(entryPath, { force: true })
                    removed += 1
                }
            } catch {
                /* ignored */
            }
        }
    }
    walk(root)
    return { removed, root }
}

// ---------------------------------------------------------------------------
// Summary prompt (the actual model call is performed by the server pipeline)
// ---------------------------------------------------------------------------

export const buildSummaryPrompt = (params: {
    segmentText: string
    documentName?: string
    sourceId?: string
    version?: string | number
    startPage?: number
    endPage?: number
}): { system: string; user: string } => {
    const location = [
        params.documentName ? `document: ${params.documentName}` : undefined,
        params.sourceId ? `source: ${params.sourceId}` : undefined,
        params.version !== undefined ? `version: ${params.version}` : undefined,
        params.startPage !== undefined && params.endPage !== undefined ? `pages: ${params.startPage}-${params.endPage}` : undefined
    ]
        .filter(Boolean)
        .join(', ')

    return {
        system:
            'You are a document analyst. Produce a rich, faithful summary in Markdown. ' +
            'Keep every key concept, definition, relation, entity name, figure and example that matters. ' +
            'Never invent content that is not in the fragment.',
        user:
            `Summarise the following document fragment (${location || 'no location metadata'}).\n\n` +
            'Required output structure:\n' +
            '1. **Overview** — what this fragment is about.\n' +
            '2. **Key concepts and definitions** — bullet list.\n' +
            '3. **Entities** — names of people, organisations, products, standards, places (bullet list).\n' +
            '4. **Relations** — "A -> relation -> B" statements found in the fragment.\n' +
            '5. **Figures and data** — numbers, dates, measurements.\n' +
            '6. **Notable examples** — keep them short but explicit.\n\n' +
            `Fragment:\n\n${params.segmentText}`
    }
}

export const estimateSummaryTokens = (segmentText: string): number => Math.ceil((segmentText || '').length / 4)
