import { useCallback, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import ReactFlow, { Background, Controls, MiniMap, MarkerType } from 'reactflow'
import 'reactflow/dist/style.css'

// material-ui
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    TextField,
    Typography
} from '@mui/material'

// project imports
import { StyledButton } from '@/ui-component/button/StyledButton'
import vibeflowDocStoreApi from '@/api/vibeflowDocStore'

// icons
import { IconArrowsMaximize, IconRefresh, IconSearch, IconX } from '@tabler/icons-react'

const DEFAULT_LIMIT = 150
const PAGE_STEP = 150

const TYPE_COLORS = {
    Document: '#2f9e91',
    Segment: '#4b86e7',
    Chunk: '#8e7cc3',
    Entity: '#e6a23c',
    Concept: '#e654bc',
    Personne: '#e65454',
    Organisation: '#4b86e7',
    Organisation_: '#4b86e7'
}

const colorForType = (type) => TYPE_COLORS[type] || '#6b7280'

/**
 * Deterministic concentric layout: nodes are grouped by type and placed on circles,
 * so a very large graph is never laid out all at once and the view stays readable.
 */
const computeLayout = (nodes) => {
    const groups = new Map()
    for (const node of nodes) {
        const type = node.data?.type || 'Concept'
        if (!groups.has(type)) groups.set(type, [])
        groups.get(type).push(node)
    }

    const positioned = []
    const types = [...groups.keys()]
    const radiusStep = 260
    types.forEach((type, typeIndex) => {
        const members = groups.get(type)
        const radius = 140 + typeIndex * radiusStep
        members.forEach((node, index) => {
            const angle = (2 * Math.PI * index) / Math.max(members.length, 1) + typeIndex * 0.35
            positioned.push({
                ...node,
                position: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
            })
        })
    })
    return positioned
}

/**
 * VibeFlow — interactive Knowledge Graph viewer.
 * Zoom / pan / node selection / relation exploration / entity search / type filters /
 * progressive loading (the whole graph is never loaded at once).
 */
const KnowledgeGraphView = ({ show, documentStoreId, engine = 'graphology-local', neo4j, onCancel }) => {
    const [statistics, setStatistics] = useState(null)
    const [subgraph, setSubgraph] = useState({ nodes: [], relations: [], truncated: false })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [depth, setDepth] = useState(2)
    const [limit, setLimit] = useState(DEFAULT_LIMIT)
    const [selected, setSelected] = useState(null)
    const [hiddenNodeTypes, setHiddenNodeTypes] = useState([])
    const [hiddenRelationTypes, setHiddenRelationTypes] = useState([])

    const loadGraph = useCallback(
        async (nextLimit) => {
            if (!documentStoreId) return
            setLoading(true)
            setError('')
            try {
                const response = await vibeflowDocStoreApi.getStoreGraph(documentStoreId, {
                    engine,
                    limit: nextLimit || limit,
                    neo4jConfig: neo4j
                })
                const payload = response.data?.data || {}
                setStatistics(payload.statistics || null)
                setSubgraph(payload.subgraph || { nodes: [], relations: [], truncated: false })
            } catch (requestError) {
                setError(requestError?.response?.data?.message || requestError.message || 'Unable to load the graph')
            } finally {
                setLoading(false)
            }
        },
        [documentStoreId, engine, limit, neo4j]
    )

    useEffect(() => {
        if (show && documentStoreId) {
            setLimit(DEFAULT_LIMIT)
            loadGraph(DEFAULT_LIMIT)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [show, documentStoreId, engine, neo4j])

    const runSearch = async () => {
        if (!query.trim().length || !documentStoreId) return
        setLoading(true)
        setError('')
        try {
            const response = await vibeflowDocStoreApi.searchStoreGraph(documentStoreId, query.trim(), {
                engine,
                neo4jConfig: neo4j
            })
            const found = response.data?.data || { nodes: [], relations: [] }
            if (!found.nodes.length) {
                setError(`No entity matches "${query}"`)
            } else {
                setSubgraph((previous) => {
                    const known = new Set(previous.nodes.map((node) => node.id))
                    const additions = found.nodes.filter((node) => !known.has(node.id))
                    return { ...previous, nodes: [...previous.nodes, ...additions] }
                })
                setSelected({ id: found.nodes[0].id, attributes: found.nodes[0] })
            }
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Search failed')
        } finally {
            setLoading(false)
        }
    }

    const traverseFrom = async (nodeId) => {
        if (!documentStoreId || !nodeId) return
        setLoading(true)
        setError('')
        try {
            const response = await vibeflowDocStoreApi.traverseStoreGraph(documentStoreId, nodeId, {
                depth,
                engine,
                neo4jConfig: neo4j
            })
            const found = response.data?.data || { nodes: [], relations: [] }
            setSubgraph((previous) => {
                const knownNodes = new Set(previous.nodes.map((node) => node.id))
                const knownRelations = new Set(previous.relations.map((relation) => relation.id))
                return {
                    nodes: [...previous.nodes, ...found.nodes.filter((node) => !knownNodes.has(node.id))],
                    relations: [...previous.relations, ...found.relations.filter((relation) => !knownRelations.has(relation.id))],
                    truncated: previous.truncated
                }
            })
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Traversal failed')
        } finally {
            setLoading(false)
        }
    }

    const visibleNodes = useMemo(() => {
        return subgraph.nodes
            .filter((node) => !hiddenNodeTypes.includes(node.attributes?.type || 'Concept'))
            .map((node) => ({
                id: node.id,
                data: { label: node.attributes?.name || node.id, type: node.attributes?.type || 'Concept' },
                style: {
                    border: `1px solid ${colorForType(node.attributes?.type)}`,
                    borderRadius: 8,
                    padding: 6,
                    fontSize: 11,
                    background: 'transparent',
                    width: 'auto'
                }
            }))
    }, [subgraph.nodes, hiddenNodeTypes])

    const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])

    const flowNodes = useMemo(() => computeLayout(visibleNodes), [visibleNodes])

    const flowEdges = useMemo(
        () =>
            subgraph.relations
                .filter((relation) => {
                    const type = relation.attributes?.type || 'RELATED_TO'
                    return !hiddenRelationTypes.includes(type) && visibleNodeIds.has(relation.source) && visibleNodeIds.has(relation.target)
                })
                .map((relation) => ({
                    id: relation.id,
                    source: relation.source,
                    target: relation.target,
                    label: relation.attributes?.type || '',
                    labelStyle: { fontSize: 10 },
                    style: { strokeWidth: 1 },
                    markerEnd: { type: MarkerType.ArrowClosed }
                })),
        [subgraph.relations, hiddenRelationTypes, visibleNodeIds]
    )

    const nodeTypes = Object.keys(statistics?.entityTypes || {})
    const relationTypes = Object.keys(statistics?.relationTypes || {})

    return (
        <Dialog open={show} onClose={onCancel} fullWidth maxWidth='xl'>
            <DialogTitle sx={{ fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Knowledge Graph · {documentStoreId}</span>
                <IconButton size='small' onClick={onCancel}>
                    <IconX size={16} />
                </IconButton>
            </DialogTitle>
            <DialogContent sx={{ height: '78vh', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Stack flexDirection='row' sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <TextField
                        size='small'
                        placeholder='Search an entity'
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') runSearch()
                        }}
                        sx={{ width: 240 }}
                    />
                    <StyledButton variant='outlined' sx={{ borderRadius: 2 }} onClick={runSearch} startIcon={<IconSearch size={16} />}>
                        Search
                    </StyledButton>
                    <TextField
                        size='small'
                        select
                        label='Depth'
                        value={depth}
                        onChange={(event) => setDepth(Number(event.target.value))}
                        SelectProps={{ native: true }}
                        sx={{ width: 110 }}
                    >
                        {[1, 2, 3, 4].map((value) => (
                            <option key={value} value={value}>
                                {value}
                            </option>
                        ))}
                    </TextField>
                    <StyledButton
                        variant='outlined'
                        sx={{ borderRadius: 2 }}
                        disabled={!selected?.id}
                        onClick={() => traverseFrom(selected?.id)}
                        startIcon={<IconArrowsMaximize size={16} />}
                    >
                        Explore relations
                    </StyledButton>
                    <StyledButton
                        variant='outlined'
                        sx={{ borderRadius: 2 }}
                        onClick={() => loadGraph(limit)}
                        startIcon={<IconRefresh size={16} />}
                    >
                        Refresh
                    </StyledButton>
                    {subgraph.truncated && (
                        <StyledButton
                            variant='outlined'
                            sx={{ borderRadius: 2 }}
                            onClick={() => {
                                const nextLimit = limit + PAGE_STEP
                                setLimit(nextLimit)
                                loadGraph(nextLimit)
                            }}
                        >
                            Load more ({flowNodes.length} / {statistics?.nodes ?? '?'})
                        </StyledButton>
                    )}
                    {loading && <CircularProgress size={16} />}
                </Stack>

                <Stack flexDirection='row' sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                    {nodeTypes.map((type) => (
                        <Chip
                            key={type}
                            size='small'
                            variant={hiddenNodeTypes.includes(type) ? 'outlined' : 'filled'}
                            label={`${type} (${statistics.entityTypes[type]})`}
                            onClick={() =>
                                setHiddenNodeTypes((previous) =>
                                    previous.includes(type) ? previous.filter((entry) => entry !== type) : [...previous, type]
                                )
                            }
                        />
                    ))}
                    {relationTypes.map((type) => (
                        <Chip
                            key={type}
                            size='small'
                            variant={hiddenRelationTypes.includes(type) ? 'outlined' : 'filled'}
                            color='secondary'
                            label={`${type} (${statistics.relationTypes[type]})`}
                            onClick={() =>
                                setHiddenRelationTypes((previous) =>
                                    previous.includes(type) ? previous.filter((entry) => entry !== type) : [...previous, type]
                                )
                            }
                        />
                    ))}
                </Stack>

                {error && <Alert severity='warning'>{error}</Alert>}

                <Box sx={{ flex: 1, border: 1, borderColor: 'divider', borderRadius: 2, minHeight: 320 }}>
                    {flowNodes.length === 0 && !loading ? (
                        <Stack sx={{ alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1 }}>
                            <Typography variant='body2'>The graph is empty for this Document Store.</Typography>
                            <Typography variant='caption' color='text.secondary'>
                                Run the advanced pipeline (Advanced Document Processing) to build the vector store and its knowledge graph.
                            </Typography>
                        </Stack>
                    ) : (
                        <ReactFlow
                            nodes={flowNodes}
                            edges={flowEdges}
                            fitView
                            minZoom={0.1}
                            maxZoom={2.5}
                            nodesDraggable
                            onNodeClick={(_event, node) => {
                                const original = subgraph.nodes.find((candidate) => candidate.id === node.id)
                                setSelected({ id: node.id, attributes: original?.attributes || {} })
                            }}
                        >
                            <Background />
                            <Controls />
                            <MiniMap pannable zoomable />
                        </ReactFlow>
                    )}
                </Box>

                <Stack flexDirection='row' sx={{ gap: 2, flexWrap: 'wrap' }}>
                    <Typography variant='caption' color='text.secondary'>
                        {flowNodes.length} node(s) · {flowEdges.length} relation(s) displayed
                        {statistics
                            ? ` · graph total: ${statistics.nodes} nodes / ${statistics.relations} relations (${statistics.engine})`
                            : ''}
                    </Typography>
                    {selected && (
                        <Typography variant='caption' sx={{ overflowWrap: 'anywhere' }}>
                            selected: <strong>{selected.attributes?.name || selected.id}</strong> [{selected.attributes?.type || 'Concept'}]
                            {selected.attributes?.description ? ` — ${String(selected.attributes.description).slice(0, 160)}` : ''}
                            {selected.attributes?.documentId ? ` · document ${selected.attributes.documentId}` : ''}
                            {selected.attributes?.segmentId ? ` · segment ${selected.attributes.segmentId}` : ''}
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
        </Dialog>
    )
}

KnowledgeGraphView.propTypes = {
    show: PropTypes.bool,
    documentStoreId: PropTypes.string,
    engine: PropTypes.string,
    neo4j: PropTypes.object,
    onCancel: PropTypes.func
}

export default KnowledgeGraphView
