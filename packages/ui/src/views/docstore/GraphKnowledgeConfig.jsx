import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'

// material-ui
import { Box, Chip, CircularProgress, FormControl, MenuItem, OutlinedInput, Stack, TextField, Typography } from '@mui/material'

// project imports
import MainCard from '@/ui-component/cards/MainCard'
import { StyledButton } from '@/ui-component/button/StyledButton'
import vibeflowDocStoreApi from '@/api/vibeflowDocStore'

// icons
import { IconChartDots, IconRefresh, IconPlugConnected } from '@tabler/icons-react'

const STORAGE_KEY = (storeId) => `vibeflowGraphConfig:${storeId}`

/**
 * VibeFlow — mandatory "Graph Knowledge" section of a Document Store.
 *
 * A Document Store is a hybrid unit: a vector store *and* a knowledge graph. The engine is chosen
 * here among the engines that are really available on this host (capability detection), and the
 * connection is validated before being used.
 */
const GraphKnowledgeConfig = ({ documentStoreId, onViewGraph }) => {
    const [engines, setEngines] = useState([])
    const [engine, setEngine] = useState('graphology-local')
    const [neo4j, setNeo4j] = useState({ url: '', username: '', password: '', database: '' })
    const [loading, setLoading] = useState(false)
    const [validation, setValidation] = useState(null)
    const [statistics, setStatistics] = useState(null)
    const [error, setError] = useState('')

    // restore the previously chosen configuration of this store
    useEffect(() => {
        if (!documentStoreId) return
        try {
            const stored = localStorage.getItem(STORAGE_KEY(documentStoreId))
            if (stored) {
                const parsed = JSON.parse(stored)
                if (parsed.engine) setEngine(parsed.engine)
                if (parsed.neo4j)
                    setNeo4j((previous) => ({
                        ...previous,
                        url: parsed.neo4j.url || '',
                        username: parsed.neo4j.username || '',
                        database: parsed.neo4j.database || ''
                    }))
            }
        } catch {
            /* ignored */
        }
    }, [documentStoreId])

    const persist = (nextEngine, nextNeo4j) => {
        if (!documentStoreId) return
        localStorage.setItem(
            STORAGE_KEY(documentStoreId),
            JSON.stringify({
                engine: nextEngine,
                neo4j: { url: nextNeo4j.url, username: nextNeo4j.username, database: nextNeo4j.database }
            })
        )
    }

    const loadEngines = async (neo4jConfig) => {
        setLoading(true)
        setError('')
        try {
            const response = await vibeflowDocStoreApi.getGraphEngines(neo4jConfig ? { neo4jConfig } : {})
            setEngines(response.data?.data || [])
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Unable to list the graph engines')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadEngines()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const selectedEngine = engines.find((candidate) => candidate.engine === engine)

    const validateConnection = async () => {
        const neo4jConfig = engine === 'neo4j' ? { ...neo4j, password: neo4j.password } : undefined
        setValidation(null)
        await loadEngines(neo4jConfig)
        const refreshed = await vibeflowDocStoreApi.getGraphEngines(neo4jConfig ? { neo4jConfig } : {})
        const descriptor = (refreshed.data?.data || []).find((candidate) => candidate.engine === engine)
        setValidation(descriptor || null)
        persist(engine, neo4j)
    }

    const loadStatistics = async () => {
        if (!documentStoreId) return
        setLoading(true)
        setError('')
        try {
            const response = await vibeflowDocStoreApi.getStoreGraph(documentStoreId, { engine, limit: 1 })
            setStatistics(response.data?.data?.statistics || null)
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Unable to read the graph statistics')
        } finally {
            setLoading(false)
        }
    }

    return (
        <MainCard sx={{ mb: 2 }}>
            <Stack flexDirection='column' sx={{ gap: 1 }}>
                <Stack flexDirection='row' sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant='h4'>Graph Knowledge</Typography>
                    <Chip size='small' color='primary' variant='outlined' label='required' />
                    {loading && <CircularProgress size={14} />}
                </Stack>
                <Typography variant='body2' color='text.secondary'>
                    A Document Store is a hybrid unit: the vector store and its knowledge graph are created, versioned and deleted together.
                    Only engines really available on this host can be selected.
                </Typography>

                <Stack flexDirection='row' sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    <FormControl sx={{ minWidth: 320 }} size='small'>
                        <OutlinedInput
                            notched
                            readOnly
                            value={engines.length ? selectedEngine?.label || engine : 'Loading engines…'}
                            sx={{ display: 'none' }}
                        />
                        <TextField
                            select
                            size='small'
                            label='Graph engine'
                            value={engine}
                            onChange={(event) => {
                                setEngine(event.target.value)
                                persist(event.target.value, neo4j)
                                setValidation(null)
                            }}
                        >
                            {(engines.length ? engines : [{ engine: 'graphology-local', label: 'Loading…', available: true }]).map(
                                (candidate) => (
                                    <MenuItem key={candidate.engine} value={candidate.engine} disabled={!candidate.available}>
                                        {candidate.label}
                                        {candidate.available ? '' : ` — unavailable: ${candidate.reason}`}
                                    </MenuItem>
                                )
                            )}
                        </TextField>
                    </FormControl>

                    {selectedEngine && !selectedEngine.available && (
                        <Typography variant='caption' color='warning.main'>
                            {selectedEngine.reason}
                        </Typography>
                    )}

                    <StyledButton
                        variant='outlined'
                        sx={{ borderRadius: 2 }}
                        onClick={validateConnection}
                        disabled={loading}
                        startIcon={<IconPlugConnected size={16} />}
                    >
                        Validate connection
                    </StyledButton>

                    <StyledButton
                        variant='outlined'
                        sx={{ borderRadius: 2 }}
                        onClick={loadStatistics}
                        disabled={loading || !documentStoreId}
                        startIcon={<IconRefresh size={16} />}
                    >
                        Load graph statistics
                    </StyledButton>

                    {onViewGraph && (
                        <StyledButton
                            variant='contained'
                            sx={{ borderRadius: 2 }}
                            disabled={!documentStoreId}
                            onClick={() => onViewGraph({ documentStoreId, engine, neo4j })}
                            startIcon={<IconChartDots size={16} />}
                        >
                            View graph
                        </StyledButton>
                    )}
                </Stack>

                {engine === 'neo4j' && (
                    <Stack flexDirection='row' sx={{ gap: 1, flexWrap: 'wrap' }}>
                        <TextField
                            size='small'
                            label='Neo4j URL'
                            placeholder='bolt://localhost:7687'
                            value={neo4j.url}
                            onChange={(event) => setNeo4j({ ...neo4j, url: event.target.value })}
                            sx={{ minWidth: 240 }}
                        />
                        <TextField
                            size='small'
                            label='Username'
                            value={neo4j.username}
                            onChange={(event) => setNeo4j({ ...neo4j, username: event.target.value })}
                            sx={{ minWidth: 160 }}
                        />
                        <TextField
                            size='small'
                            label='Password'
                            type='password'
                            value={neo4j.password}
                            onChange={(event) => setNeo4j({ ...neo4j, password: event.target.value })}
                            sx={{ minWidth: 160 }}
                        />
                        <TextField
                            size='small'
                            label='Database'
                            value={neo4j.database}
                            onChange={(event) => setNeo4j({ ...neo4j, database: event.target.value })}
                            sx={{ minWidth: 140 }}
                        />
                    </Stack>
                )}

                {validation && (
                    <Chip
                        size='small'
                        color={validation.available ? 'success' : 'warning'}
                        variant='outlined'
                        label={
                            validation.available ? `${validation.label}: connection validated` : `${validation.label}: ${validation.reason}`
                        }
                    />
                )}

                {statistics && (
                    <Stack flexDirection='row' sx={{ gap: 1, flexWrap: 'wrap' }}>
                        <Chip size='small' variant='outlined' label={`engine: ${statistics.engine}`} />
                        <Chip size='small' variant='outlined' label={`${statistics.nodes} nœuds`} />
                        <Chip size='small' variant='outlined' label={`${statistics.relations} relations`} />
                        {Object.entries(statistics.entityTypes || {}).map(([type, count]) => (
                            <Chip key={type} size='small' variant='outlined' label={`${type}: ${count}`} />
                        ))}
                        {Object.entries(statistics.relationTypes || {}).map(([type, count]) => (
                            <Chip key={type} size='small' variant='outlined' label={`${type}: ${count}`} />
                        ))}
                    </Stack>
                )}

                {error && (
                    <Box>
                        <Typography variant='caption' color='error'>
                            {error}
                        </Typography>
                    </Box>
                )}
            </Stack>
        </MainCard>
    )
}

GraphKnowledgeConfig.propTypes = {
    documentStoreId: PropTypes.string,
    onViewGraph: PropTypes.func
}

export default GraphKnowledgeConfig
