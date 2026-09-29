import { useCallback, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { useSelector } from 'react-redux'

// material-ui
import { Box, Button, Chip, CircularProgress, Grid, IconButton, Stack, TextField, Typography } from '@mui/material'

// project imports
import ComponentsListDialog from '@/views/docstore/ComponentsListDialog'
import { StyledButton } from '@/ui-component/button/StyledButton'
import vibeflowDocStoreApi from '@/api/vibeflowDocStore'

// assets
import graphologyIcon from '@/assets/images/graph_knowledge_graphology.svg'
import neo4jIcon from '@/assets/images/graph_knowledge_neo4j.svg'

// icons
import Share from '@mui/icons-material/Share'
import { IconChartDots, IconEditCircle, IconPlugConnected, IconRefresh } from '@tabler/icons-react'

const STORAGE_KEY = (storeId) => `vibeflowGraphConfig:${storeId}`

const ENGINE_ICONS = {
    'graphology-local': graphologyIcon,
    neo4j: neo4jIcon
}

const iconFor = (engineName) => ENGINE_ICONS[engineName] || graphologyIcon

/**
 * VibeFlow — "Graph Knowledge" block of a Document Store.
 *
 * Presented exactly like the three other blocks of the step (Embeddings, Vector Store,
 * Record Manager): a rounded block opens a picker listing the available engines as rectangular
 * blocks with a logo and a name, then the selected engine is configured inline.
 *
 * Engines: Graphology + JSON Persistence (Local) and Neo4j (Server).
 */
const GraphKnowledgeConfig = ({ documentStoreId, onViewGraph }) => {
    const customization = useSelector((state) => state.customization)

    const [providers, setProviders] = useState([])
    const [selectedEngine, setSelectedEngine] = useState(null)
    const [showListDialog, setShowListDialog] = useState(false)
    const [dialogProps, setDialogProps] = useState({})
    const [neo4j, setNeo4j] = useState({ url: '', username: '', password: '', database: '' })
    const [loading, setLoading] = useState(false)
    const [validation, setValidation] = useState(null)
    const [statistics, setStatistics] = useState(null)
    const [error, setError] = useState('')

    const engineName = selectedEngine?.name || 'graphology-local'
    const isNeo4j = engineName === 'neo4j'

    const persist = useCallback(
        (name, label, connection) => {
            if (!documentStoreId) return
            localStorage.setItem(
                STORAGE_KEY(documentStoreId),
                JSON.stringify({
                    engine: name,
                    label,
                    // the password is deliberately never persisted
                    neo4j: connection ? { url: connection.url, username: connection.username, database: connection.database } : undefined
                })
            )
        },
        [documentStoreId]
    )

    // restore the engine previously chosen for this store
    useEffect(() => {
        if (!documentStoreId) return
        try {
            const stored = localStorage.getItem(STORAGE_KEY(documentStoreId))
            if (!stored) return
            const parsed = JSON.parse(stored)
            if (parsed?.engine) setSelectedEngine({ name: parsed.engine, label: parsed.label || parsed.engine })
            if (parsed?.neo4j) {
                setNeo4j((previous) => ({
                    ...previous,
                    url: parsed.neo4j.url || '',
                    username: parsed.neo4j.username || '',
                    database: parsed.neo4j.database || ''
                }))
            }
        } catch {
            /* ignored: a corrupted entry simply means "nothing selected yet" */
        }
    }, [documentStoreId])

    const loadProviders = useCallback(async () => {
        try {
            const response = await vibeflowDocStoreApi.getGraphKnowledgeProviders()
            setProviders(Array.isArray(response.data) ? response.data : [])
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Unable to list the graph engines')
        }
    }, [])

    useEffect(() => {
        loadProviders()
    }, [loadProviders])

    // keep the selected engine in sync with the freshest description coming from the server
    const selectedProvider = useMemo(() => providers.find((provider) => provider.name === engineName) || null, [providers, engineName])

    const openList = () => {
        setDialogProps({ title: 'Select Graph Knowledge' })
        setShowListDialog(true)
    }

    const onEngineSelected = (component) => {
        setSelectedEngine({ name: component.name, label: component.label })
        setValidation(null)
        setStatistics(null)
        persist(component.name, component.label, neo4j)
        setShowListDialog(false)
    }

    /** Every edit of the connection is remembered at once, so a reload never loses the setup. */
    const updateNeo4j = (patch) => {
        const next = { ...neo4j, ...patch }
        setNeo4j(next)
        persist(engineName, selectedEngine?.label, next)
    }

    const validateConnection = async () => {
        setLoading(true)
        setValidation(null)
        setError('')
        try {
            const response = await vibeflowDocStoreApi.getGraphEngines(isNeo4j ? { neo4jConfig: neo4j } : {})
            const engines = response.data?.data || []
            setValidation(engines.find((candidate) => candidate.engine === engineName) || null)
            persist(engineName, selectedEngine?.label, neo4j)
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Unable to validate the connection')
        } finally {
            setLoading(false)
        }
    }

    const loadStatistics = async () => {
        if (!documentStoreId) return
        setLoading(true)
        setError('')
        try {
            const response = await vibeflowDocStoreApi.getStoreGraph(documentStoreId, {
                engine: engineName,
                limit: 1,
                neo4jConfig: isNeo4j ? neo4j : undefined
            })
            setStatistics(response.data?.data?.statistics || null)
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Unable to read the graph statistics')
        } finally {
            setLoading(false)
        }
    }

    const engineHint = selectedProvider?.available
        ? null
        : selectedProvider?.reason || (isNeo4j ? 'No Neo4j connection configured yet (url / username / password)' : null)

    return (
        <>
            {!selectedEngine ? (
                <Button
                    onClick={openList}
                    fullWidth={true}
                    startIcon={<Share style={{ background: 'transparent', height: 32, width: 32 }} />}
                    sx={{
                        color: customization?.isDarkMode ? 'white' : 'inherit',
                        borderRadius: '10px',
                        minHeight: '200px',
                        boxShadow: '0 2px 14px 0 rgb(32 40 45 / 20%)',
                        backgroundImage: customization?.isDarkMode
                            ? `linear-gradient(to right, #7c4dff, #52b69a)`
                            : `linear-gradient(to right, #e0d5fb, #d3efe6)`,
                        '&:hover': {
                            backgroundImage: customization?.isDarkMode
                                ? `linear-gradient(to right, #6a3ae8, #3f9e83)`
                                : `linear-gradient(to right, #cdbdf7, #bce5d8)`
                        }
                    }}
                >
                    Select Graph Knowledge
                </Button>
            ) : (
                <Box>
                    <Grid container spacing='2'>
                        <Grid item xs={12} md={12} lg={12} sm={12}>
                            <div style={{ display: 'flex', flexDirection: 'column', paddingRight: 15 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', flexDirection: 'row', p: 1 }}>
                                    <div
                                        style={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: '50%',
                                            backgroundColor: 'white',
                                            display: 'flex',
                                            boxShadow: '0 2px 14px 0 rgb(32 40 45 / 25%)'
                                        }}
                                    >
                                        <img
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                padding: 7,
                                                borderRadius: '50%',
                                                objectFit: 'contain'
                                            }}
                                            alt={selectedEngine.label}
                                            src={iconFor(engineName)}
                                        />
                                    </div>
                                    <Stack sx={{ ml: 2, minWidth: 0 }}>
                                        <Typography variant='h3' noWrap>
                                            {selectedEngine.label}
                                        </Typography>
                                        <Typography variant='caption' color='text.secondary' noWrap>
                                            {selectedProvider?.kind === 'server' ? 'Server engine' : 'Local engine'}
                                        </Typography>
                                    </Stack>
                                    <div style={{ flex: 1 }}></div>
                                    <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'row' }}>
                                        {loading && <CircularProgress size={16} sx={{ mr: 1 }} />}
                                        <IconButton
                                            variant='outlined'
                                            sx={{ ml: 1 }}
                                            color='secondary'
                                            onClick={openList}
                                            aria-label='change the graph engine'
                                        >
                                            <IconEditCircle />
                                        </IconButton>
                                    </div>
                                </Box>

                                {isNeo4j && (
                                    <Stack flexDirection='row' sx={{ gap: 1, flexWrap: 'wrap', px: 1, pt: 1 }}>
                                        <TextField
                                            size='small'
                                            label='Neo4j URL'
                                            placeholder='bolt://localhost:7687'
                                            value={neo4j.url}
                                            onChange={(event) => updateNeo4j({ url: event.target.value })}
                                            sx={{ minWidth: 240 }}
                                        />
                                        <TextField
                                            size='small'
                                            label='Username'
                                            value={neo4j.username}
                                            onChange={(event) => updateNeo4j({ username: event.target.value })}
                                            sx={{ minWidth: 160 }}
                                        />
                                        <TextField
                                            size='small'
                                            label='Password'
                                            type='password'
                                            value={neo4j.password}
                                            onChange={(event) => updateNeo4j({ password: event.target.value })}
                                            sx={{ minWidth: 160 }}
                                        />
                                        <TextField
                                            size='small'
                                            label='Database'
                                            value={neo4j.database}
                                            onChange={(event) => updateNeo4j({ database: event.target.value })}
                                            sx={{ minWidth: 140 }}
                                        />
                                    </Stack>
                                )}

                                <Stack flexDirection='row' sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center', px: 1, pt: 1.5 }}>
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
                                        Graph statistics
                                    </StyledButton>
                                    {onViewGraph && (
                                        <StyledButton
                                            variant='contained'
                                            sx={{ borderRadius: 2 }}
                                            disabled={!documentStoreId}
                                            onClick={() => onViewGraph({ documentStoreId, engine: engineName, neo4j })}
                                            startIcon={<IconChartDots size={16} />}
                                        >
                                            View graph
                                        </StyledButton>
                                    )}
                                </Stack>

                                {(engineHint || validation || statistics || error) && (
                                    <Stack flexDirection='row' sx={{ gap: 1, flexWrap: 'wrap', px: 1, pt: 1 }}>
                                        {engineHint && !validation && (
                                            <Typography variant='caption' color='text.secondary'>
                                                {engineHint}
                                            </Typography>
                                        )}
                                        {validation && (
                                            <Chip
                                                size='small'
                                                color={validation.available ? 'success' : 'warning'}
                                                variant='outlined'
                                                label={
                                                    validation.available
                                                        ? `${validation.label}: connection validated`
                                                        : `${validation.label}: ${validation.reason}`
                                                }
                                            />
                                        )}
                                        {statistics && (
                                            <>
                                                <Chip size='small' variant='outlined' label={`engine: ${statistics.engine}`} />
                                                <Chip size='small' variant='outlined' label={`${statistics.nodes} nodes`} />
                                                <Chip size='small' variant='outlined' label={`${statistics.relations} relations`} />
                                                {Object.entries(statistics.entityTypes || {}).map(([type, count]) => (
                                                    <Chip
                                                        key={`entity-${type}`}
                                                        size='small'
                                                        variant='outlined'
                                                        label={`${type}: ${count}`}
                                                    />
                                                ))}
                                                {Object.entries(statistics.relationTypes || {}).map(([type, count]) => (
                                                    <Chip
                                                        key={`relation-${type}`}
                                                        size='small'
                                                        variant='outlined'
                                                        label={`${type}: ${count}`}
                                                    />
                                                ))}
                                            </>
                                        )}
                                        {error && (
                                            <Typography variant='caption' color='error'>
                                                {error}
                                            </Typography>
                                        )}
                                    </Stack>
                                )}
                            </div>
                        </Grid>
                    </Grid>
                </Box>
            )}

            {showListDialog && (
                <ComponentsListDialog
                    show={showListDialog}
                    dialogProps={dialogProps}
                    onCancel={() => setShowListDialog(false)}
                    apiCall={vibeflowDocStoreApi.getGraphKnowledgeProviders}
                    onSelected={onEngineSelected}
                    getIconSrc={(component) => iconFor(component.name)}
                />
            )}
        </>
    )
}

GraphKnowledgeConfig.propTypes = {
    documentStoreId: PropTypes.string,
    onViewGraph: PropTypes.func
}

export default GraphKnowledgeConfig
