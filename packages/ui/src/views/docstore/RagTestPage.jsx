import { useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { useNavigate, useParams } from 'react-router-dom'

// material-ui
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Alert,
    Box,
    Chip,
    CircularProgress,
    Divider,
    IconButton,
    Link,
    MenuItem,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography
} from '@mui/material'

// project imports
import MainCard from '@/ui-component/cards/MainCard'
import ViewHeader from '@/layout/MainLayout/ViewHeader'
import { StyledButton } from '@/ui-component/button/StyledButton'
import ComponentsListDialog from '@/views/docstore/ComponentsListDialog'
import documentsApi from '@/api/documentstore'
import nodesApi from '@/api/nodes'
import vibeflowRetrievalApi from '@/api/vibeflowRetrieval'
import useApi from '@/hooks/useApi'

// icons
import { IconChevronDown, IconCopy, IconPlayerPlay, IconSparkles } from '@tabler/icons-react'

const scoreOf = (result, key) => {
    const value = result?.scores?.[key]
    return typeof value === 'number' ? value.toFixed(4) : '-'
}

const truncate = (value, length = 160) => {
    const text = (value || '').toString().replace(/\s+/g, ' ').trim()
    return text.length > length ? `${text.slice(0, length)}…` : text
}

const StepAccordion = ({ title, summary, children, defaultExpanded }) => (
    <Accordion
        defaultExpanded={defaultExpanded}
        disableGutters
        variant='outlined'
        sx={{ borderRadius: 2, '&:before': { display: 'none' } }}
    >
        <AccordionSummary expandIcon={<IconChevronDown size={16} />}>
            <Stack flexDirection='row' sx={{ alignItems: 'center', gap: 1, width: '100%', justifyContent: 'space-between' }}>
                <Typography variant='subtitle2'>{title}</Typography>
                {summary && (
                    <Typography variant='caption' color='text.secondary'>
                        {summary}
                    </Typography>
                )}
            </Stack>
        </AccordionSummary>
        <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
)

StepAccordion.propTypes = {
    title: PropTypes.string,
    summary: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    children: PropTypes.node,
    defaultExpanded: PropTypes.bool
}

/**
 * VibeFlow — "Test RAG" interface.
 *
 * Runs the real hybrid retrieval pipeline of a Document Store and exposes every step of it:
 * query optimisation, axis decomposition, variants, per-retriever results, RRF fusion, global
 * merge, reranking, final selection with the applied thresholds, sources, final answer and the
 * duration of every stage. Every source keeps its full provenance chain.
 */
const RagTestPage = () => {
    const navigate = useNavigate()
    const { storeId: storeIdParam } = useParams()
    const getAllDocStoresApi = useApi(documentsApi.getAllDocumentStores)
    const capabilitiesApi = useApi(vibeflowRetrievalApi.getStoreCapabilities)
    const queryApi = useApi(vibeflowRetrievalApi.queryStore)
    const getNodesByCategoryApi = useApi(nodesApi.getNodesByCategory)

    const [storeId, setStoreId] = useState(storeIdParam || '')
    const [question, setQuestion] = useState('')
    const [topK, setTopK] = useState(50)
    const [minScore, setMinScore] = useState(0)
    const [perRetrieverLimit, setPerRetrieverLimit] = useState(25)
    const [contextBudgetTokens, setContextBudgetTokens] = useState(4000)
    const [selectedChatModel, setSelectedChatModel] = useState({})
    const [showChatModelDialog, setShowChatModelDialog] = useState(false)
    const [selectedSource, setSelectedSource] = useState(null)
    const [copied, setCopied] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        getAllDocStoresApi.request({ page: 1, limit: 100 })
        getNodesByCategoryApi.request('Chat Models')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!storeId) return
        capabilitiesApi.request(storeId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storeId])

    const stores = useMemo(() => {
        const payload = getAllDocStoresApi.data
        if (Array.isArray(payload)) return payload
        return payload?.data || []
    }, [getAllDocStoresApi.data])

    const capabilities = capabilitiesApi.data?.data
    const response = queryApi.data?.data
    const trace = response?.trace

    const runQuery = async () => {
        if (!storeId || !question.trim().length) return
        setError('')
        setSelectedSource(null)
        try {
            await queryApi.request(storeId, {
                query: question.trim(),
                options: { topK, minScore, perRetrieverLimit, contextBudgetTokens },
                ...(selectedChatModel?.name
                    ? {
                          generate: {
                              name: selectedChatModel.name,
                              credentialId: selectedChatModel.credential,
                              config: selectedChatModel.inputs || {}
                          }
                      }
                    : {})
            })
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'The pipeline failed')
        }
    }

    const copy = async (value) => {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(value)
            setTimeout(() => setCopied(''), 1500)
        } catch {
            /* ignored */
        }
    }

    const provenanceChain = (result) => {
        const provenance = result?.provenance || {}
        return [
            {
                label: 'Document',
                value: provenance.document_id,
                extra: provenance.document_version ? `version ${provenance.document_version}` : undefined
            },
            { label: 'Source', value: provenance.source_id },
            { label: 'Segment', value: provenance.segment_id },
            { label: 'Chunk', value: provenance.chunk_id },
            { label: 'Graph node', value: provenance.graph_node_id },
            { label: 'Graph relation', value: provenance.graph_relation_id },
            {
                label: 'Method',
                value: provenance.retrieval_method,
                extra: `score ${typeof provenance.score === 'number' ? provenance.score.toFixed(4) : '-'}`
            },
            { label: 'Timestamp', value: provenance.timestamp }
        ].filter((entry) => entry.value)
    }

    // StepAccordion is defined at module level (single definition, props validated)

    return (
        <>
            <MainCard>
                <Stack flexDirection='column' sx={{ gap: 2 }}>
                    <ViewHeader
                        isBackButton={true}
                        search={false}
                        title='Test RAG'
                        description='Run the hybrid retrieval pipeline of a Document Store and inspect every step'
                        onBack={() => navigate('/document-stores')}
                    />
                    <Stack flexDirection='row' sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        <TextField
                            select
                            size='small'
                            label='Document Store'
                            value={storeId}
                            onChange={(event) => setStoreId(event.target.value)}
                            sx={{ minWidth: 260 }}
                        >
                            <MenuItem value=''>
                                <em>Select a Document Store</em>
                            </MenuItem>
                            {stores.map((store) => (
                                <MenuItem key={store.id} value={store.id}>
                                    {store.name}
                                </MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            size='small'
                            label='Query'
                            value={question}
                            onChange={(event) => setQuestion(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault()
                                    runQuery()
                                }
                            }}
                            sx={{ minWidth: 420, flex: 1 }}
                        />
                        <TextField
                            size='small'
                            type='number'
                            label='Top K (max 50)'
                            value={topK}
                            onChange={(event) => setTopK(Math.min(Number(event.target.value) || 50, 50))}
                            sx={{ width: 140 }}
                        />
                        <TextField
                            size='small'
                            type='number'
                            label='Min score'
                            value={minScore}
                            onChange={(event) => setMinScore(Number(event.target.value) || 0)}
                            inputProps={{ step: 0.05, min: 0, max: 1 }}
                            sx={{ width: 120 }}
                        />
                        <TextField
                            size='small'
                            type='number'
                            label='Per retriever'
                            value={perRetrieverLimit}
                            onChange={(event) => setPerRetrieverLimit(Number(event.target.value) || 25)}
                            sx={{ width: 130 }}
                        />
                        <TextField
                            size='small'
                            type='number'
                            label='Context tokens'
                            value={contextBudgetTokens}
                            onChange={(event) => setContextBudgetTokens(Number(event.target.value) || 4000)}
                            sx={{ width: 140 }}
                        />
                        <StyledButton
                            variant='outlined'
                            sx={{ borderRadius: 2 }}
                            onClick={() => setShowChatModelDialog(true)}
                            startIcon={<IconSparkles size={16} />}
                        >
                            {selectedChatModel?.label ? `Model: ${selectedChatModel.label}` : 'Generate answer (optional)'}
                        </StyledButton>
                        <StyledButton
                            variant='contained'
                            sx={{ borderRadius: 2 }}
                            onClick={runQuery}
                            disabled={!storeId || !question.trim().length || queryApi.loading}
                            startIcon={queryApi.loading ? <CircularProgress size={16} /> : <IconPlayerPlay size={16} />}
                        >
                            Run pipeline
                        </StyledButton>
                    </Stack>

                    {capabilities && (
                        <Stack flexDirection='row' sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                            <Chip size='small' variant='outlined' label={`${capabilities.chunks} chunk(s) indexed`} />
                            <Chip
                                size='small'
                                variant='outlined'
                                color={capabilities.lexical?.available ? 'success' : 'warning'}
                                label={`lexical BM25: ${capabilities.lexical?.available ? 'available' : capabilities.lexical?.reason}`}
                            />
                            <Chip
                                size='small'
                                variant='outlined'
                                color={capabilities.semantic?.available ? 'success' : 'warning'}
                                label={`semantic: ${capabilities.semantic?.available ? 'available' : capabilities.semantic?.reason}`}
                            />
                            <Chip
                                size='small'
                                variant='outlined'
                                color={capabilities.graph?.available ? 'success' : 'warning'}
                                label={`graph ${capabilities.graph?.engine || ''}: ${
                                    capabilities.graph?.available
                                        ? `${capabilities.graph?.statistics?.nodes || 0} nœuds / ${
                                              capabilities.graph?.statistics?.relations || 0
                                          } relations`
                                        : capabilities.graph?.reason
                                }`}
                            />
                        </Stack>
                    )}

                    {error && <Alert severity='error'>{error}</Alert>}
                    {queryApi.error && !error && <Alert severity='error'>{queryApi.error.response?.data?.message || 'Query failed'}</Alert>}

                    {trace && (
                        <Stack flexDirection='column' sx={{ gap: 1 }}>
                            {trace.warnings?.length > 0 && (
                                <Alert severity='warning'>
                                    <Stack flexDirection='column'>
                                        {trace.warnings.map((warning, index) => (
                                            <Typography key={index} variant='caption'>
                                                • {warning}
                                            </Typography>
                                        ))}
                                    </Stack>
                                </Alert>
                            )}

                            <StepAccordion id='input' title='1. Entrée' summary='requête originale conservée' defaultExpanded>
                                <Stack flexDirection='column' sx={{ gap: 0.5 }}>
                                    <Typography variant='body2'>{trace.originalQuery}</Typography>
                                    <Typography variant='caption' color='text.secondary'>
                                        {response.indexedChunks} chunk(s) indexé(s) · top K demandé {trace.thresholds.topK} · seuil{' '}
                                        {trace.thresholds.minScore}
                                    </Typography>
                                </Stack>
                            </StepAccordion>

                            <StepAccordion id='optimization' title='2. Optimisation' summary={`intention: ${trace.intent}`}>
                                <Stack flexDirection='column' sx={{ gap: 0.5 }}>
                                    <Typography variant='body2'>{trace.optimizedQuery}</Typography>
                                    <Stack flexDirection='row' sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                                        {(trace.axes || []).length > 0 && (
                                            <Chip size='small' variant='outlined' label={`${trace.axes.length} axe(s)`} />
                                        )}
                                        <Chip
                                            size='small'
                                            variant='outlined'
                                            label={`${trace.queries.length} requête(s) générée(s) (max 12)`}
                                        />
                                    </Stack>
                                </Stack>
                            </StepAccordion>

                            <StepAccordion id='axes' title='3. Décomposition & variantes' summary={`${trace.axes.length} axe(s)`}>
                                <Stack flexDirection='column' sx={{ gap: 1 }}>
                                    {trace.axes.map((axis) => (
                                        <Box key={axis.name}>
                                            <Typography variant='subtitle2'>{axis.name}</Typography>
                                            <Typography variant='caption' color='text.secondary'>
                                                {axis.query}
                                            </Typography>
                                            <Stack flexDirection='row' sx={{ gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                                                {axis.variants.map((variant) => (
                                                    <Chip key={variant} size='small' variant='outlined' label={truncate(variant, 46)} />
                                                ))}
                                            </Stack>
                                        </Box>
                                    ))}
                                </Stack>
                            </StepAccordion>

                            <StepAccordion id='retrieval' title='4. Retrieval par axe' summary={`${trace.perAxis.length} axe(s)`}>
                                <Stack flexDirection='column' sx={{ gap: 1.5 }}>
                                    {trace.perAxis.map((axis) => (
                                        <Box key={axis.axis}>
                                            <Typography variant='subtitle2'>{axis.axis}</Typography>
                                            <Stack flexDirection='row' sx={{ gap: 0.5, flexWrap: 'wrap', my: 0.5 }}>
                                                <Chip
                                                    size='small'
                                                    variant='outlined'
                                                    color='primary'
                                                    label={`sémantique: ${axis.counts.semantic}`}
                                                />
                                                <Chip
                                                    size='small'
                                                    variant='outlined'
                                                    color='secondary'
                                                    label={`lexical: ${axis.counts.keyword}`}
                                                />
                                                <Chip
                                                    size='small'
                                                    variant='outlined'
                                                    color='warning'
                                                    label={`graphe: ${axis.counts.graph}`}
                                                />
                                                <Chip size='small' variant='outlined' label={`fusionnés (RRF): ${axis.counts.fused}`} />
                                            </Stack>
                                            <Table size='small'>
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell>Rang</TableCell>
                                                        <TableCell>Méthode</TableCell>
                                                        <TableCell>Extrait</TableCell>
                                                        <TableCell>RRF</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {axis.fused.slice(0, 5).map((result) => (
                                                        <TableRow key={`${axis.axis}-${result.id}`}>
                                                            <TableCell>{result.rank}</TableCell>
                                                            <TableCell>
                                                                <Chip
                                                                    size='small'
                                                                    variant='outlined'
                                                                    label={result.provenance.retrieval_method}
                                                                />
                                                            </TableCell>
                                                            <TableCell>{truncate(result.content, 90)}</TableCell>
                                                            <TableCell>{scoreOf(result, 'rrf')}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </Box>
                                    ))}
                                </Stack>
                            </StepAccordion>

                            <StepAccordion
                                id='fusion'
                                title='5. Fusion globale (RRF)'
                                summary={`${trace.globalMerged.length} résultat(s) fusionné(s)`}
                            >
                                <Table size='small'>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Rang</TableCell>
                                            <TableCell>Chunk / segment</TableCell>
                                            <TableCell>keyword</TableCell>
                                            <TableCell>semantic</TableCell>
                                            <TableCell>graph</TableCell>
                                            <TableCell>RRF</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {trace.globalMerged.slice(0, 15).map((result) => (
                                            <TableRow
                                                key={result.id}
                                                hover
                                                onClick={() => setSelectedSource(result)}
                                                sx={{ cursor: 'pointer' }}
                                            >
                                                <TableCell>{result.rank}</TableCell>
                                                <TableCell>
                                                    {truncate(result.provenance.chunk_id || result.provenance.segment_id || result.id, 40)}
                                                </TableCell>
                                                <TableCell>{scoreOf(result, 'keyword')}</TableCell>
                                                <TableCell>{scoreOf(result, 'semantic')}</TableCell>
                                                <TableCell>{scoreOf(result, 'graph')}</TableCell>
                                                <TableCell>{scoreOf(result, 'rrf')}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </StepAccordion>

                            <StepAccordion
                                id='ranking'
                                title='6. Ranking (avant / après rerank)'
                                summary={`${trace.reranked.length} résultat(s) réordonné(s)`}
                            >
                                <Table size='small'>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Rang final</TableCell>
                                            <TableCell>Extrait</TableCell>
                                            <TableCell>RRF (avant)</TableCell>
                                            <TableCell>Rerank (après)</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {trace.reranked.slice(0, 15).map((result) => (
                                            <TableRow
                                                key={`rerank-${result.id}`}
                                                hover
                                                onClick={() => setSelectedSource(result)}
                                                sx={{ cursor: 'pointer' }}
                                            >
                                                <TableCell>{result.rank}</TableCell>
                                                <TableCell>{truncate(result.content, 80)}</TableCell>
                                                <TableCell>{scoreOf(result, 'rrf')}</TableCell>
                                                <TableCell>{scoreOf(result, 'rerank')}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </StepAccordion>

                            <StepAccordion
                                id='selection'
                                title='7. Sélection finale & seuils'
                                summary={`${trace.selected.length} / ${trace.thresholds.topK} (max ${trace.thresholds.maxResults})`}
                            >
                                <Stack flexDirection='row' sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                                    <Chip size='small' variant='outlined' label={`top K: ${trace.thresholds.topK}`} />
                                    <Chip size='small' variant='outlined' label={`plafond: ${trace.thresholds.maxResults}`} />
                                    <Chip size='small' variant='outlined' label={`seuil de qualité: ${trace.thresholds.minScore}`} />
                                    <Chip
                                        size='small'
                                        variant='outlined'
                                        label={`budget contexte: ${trace.thresholds.contextBudgetTokens} tokens`}
                                    />
                                    <Chip
                                        size='small'
                                        variant='outlined'
                                        color='primary'
                                        label={`contexte: ${trace.context?.usedResults || 0} source(s) / ~${
                                            trace.context?.estimatedTokens || 0
                                        } tokens`}
                                    />
                                </Stack>
                            </StepAccordion>

                            <StepAccordion id='sources' title='8. Sources' summary={`${trace.selected.length} source(s) retenue(s)`} defaultExpanded>
                                <Stack flexDirection='column' sx={{ gap: 0.5 }}>
                                    {trace.selected.map((result, index) => (
                                        <Stack
                                            key={`source-${result.id}`}
                                            flexDirection='row'
                                            sx={{ gap: 1, alignItems: 'center', cursor: 'pointer' }}
                                            onClick={() => setSelectedSource(result)}
                                        >
                                            <Chip size='small' label={`#${index + 1}`} />
                                            <Chip size='small' variant='outlined' label={result.provenance.retrieval_method} />
                                            <Typography variant='caption' sx={{ flex: 1 }}>
                                                {truncate(result.content, 110)}
                                            </Typography>
                                            <Typography variant='caption' color='text.secondary'>
                                                {result.provenance.document_id}
                                                {result.provenance.segment_id ? ` · ${result.provenance.segment_id}` : ''}
                                            </Typography>
                                        </Stack>
                                    ))}
                                </Stack>
                            </StepAccordion>

                            <StepAccordion
                                id='performance'
                                title='9. Performance'
                                summary={`${trace.stages.reduce((total, stage) => total + stage.durationMs, 0)} ms au total`}
                            >
                                <Table size='small'>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Étape</TableCell>
                                            <TableCell>Durée</TableCell>
                                            <TableCell>Détail</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {trace.stages.map((stage) => (
                                            <TableRow key={stage.name}>
                                                <TableCell>{stage.name}</TableCell>
                                                <TableCell>{stage.durationMs} ms</TableCell>
                                                <TableCell>{stage.detail}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </StepAccordion>

                            <StepAccordion
                                id='answer'
                                title='10. Réponse finale'
                                summary={
                                    response.answer
                                        ? `générée en ${response.generationDurationMs} ms`
                                        : 'prompt prêt (aucun modèle sélectionné)'
                                }
                                defaultExpanded
                            >
                                <Stack flexDirection='column' sx={{ gap: 1 }}>
                                    {response.answer && (
                                        <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                                            <Typography variant='body2' sx={{ whiteSpace: 'pre-wrap' }}>
                                                {response.answer}
                                            </Typography>
                                        </Box>
                                    )}
                                    {response.generationError && <Alert severity='warning'>{response.generationError}</Alert>}
                                    {!response.answer && response.prompt && (
                                        <>
                                            <Typography variant='caption' color='text.secondary'>
                                                Le contexte et le prompt sont construits ; sélectionnez un modèle pour générer la réponse.
                                            </Typography>
                                            <Box
                                                sx={{
                                                    p: 1.5,
                                                    border: 1,
                                                    borderColor: 'divider',
                                                    borderRadius: 2,
                                                    maxHeight: 260,
                                                    overflowY: 'auto'
                                                }}
                                            >
                                                <Typography variant='caption' sx={{ whiteSpace: 'pre-wrap' }}>
                                                    {response.prompt.system}
                                                    {'\n\n'}
                                                    {response.prompt.user}
                                                </Typography>
                                            </Box>
                                        </>
                                    )}
                                </Stack>
                            </StepAccordion>

                            {selectedSource && (
                                <MainCard sx={{ mt: 1 }}>
                                    <Stack flexDirection='column' sx={{ gap: 1 }}>
                                        <Typography variant='subtitle2'>Traçabilité de la source sélectionnée</Typography>
                                        <Typography variant='caption' color='text.secondary'>
                                            Réponse → contexte → résultat → chunk → segment → document (et nœud/relation de graphe lorsque
                                            applicable)
                                        </Typography>
                                        <Stack flexDirection='column' sx={{ gap: 0.5 }}>
                                            {provenanceChain(selectedSource).map((entry) => (
                                                <Stack key={entry.label} flexDirection='row' sx={{ gap: 1, alignItems: 'center' }}>
                                                    <Chip size='small' variant='outlined' label={entry.label} />
                                                    <Typography variant='caption' sx={{ overflowWrap: 'anywhere' }}>
                                                        {entry.value}
                                                        {entry.extra ? ` (${entry.extra})` : ''}
                                                    </Typography>
                                                    <Tooltip title={copied === entry.value ? 'Copied' : 'Copy'}>
                                                        <IconButton size='small' onClick={() => copy(String(entry.value))}>
                                                            <IconCopy size={14} />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Stack>
                                            ))}
                                        </Stack>
                                        <Divider />
                                        <Typography variant='body2' sx={{ whiteSpace: 'pre-wrap' }}>
                                            {selectedSource.content}
                                        </Typography>
                                        <Stack flexDirection='row' sx={{ gap: 1, flexWrap: 'wrap' }}>
                                            {Object.entries(selectedSource.scores || {}).map(([key, value]) => (
                                                <Chip
                                                    key={key}
                                                    size='small'
                                                    variant='outlined'
                                                    label={`${key}: ${typeof value === 'number' ? value.toFixed(4) : value}`}
                                                />
                                            ))}
                                            {selectedSource.metadata?.graphNodeId && (
                                                <Chip
                                                    size='small'
                                                    color='primary'
                                                    variant='outlined'
                                                    label={`graph node: ${selectedSource.metadata.graphNodeId}`}
                                                />
                                            )}
                                        </Stack>
                                        <Link
                                            component='button'
                                            variant='caption'
                                            onClick={() =>
                                                navigate(
                                                    selectedSource.provenance.document_id
                                                        ? `/document-stores/chunks/${storeId}/${selectedSource.provenance.document_id}`
                                                        : '/document-stores'
                                                )
                                            }
                                        >
                                            Open the stored chunks of this document store
                                        </Link>
                                    </Stack>
                                </MainCard>
                            )}
                        </Stack>
                    )}
                </Stack>
            </MainCard>

            <ComponentsListDialog
                show={showChatModelDialog}
                dialogProps={{ title: 'Select a Chat Model to generate the final answer' }}
                onCancel={() => setShowChatModelDialog(false)}
                apiCall={nodesApi.getNodesByCategory}
                onSelected={(node) => {
                    const found = (getNodesByCategoryApi.data || []).find((candidate) => candidate.name === (node?.name || node))
                    setSelectedChatModel(found ? { ...found } : { name: node?.name || node })
                    setShowChatModelDialog(false)
                }}
            />
        </>
    )
}

export default RagTestPage
