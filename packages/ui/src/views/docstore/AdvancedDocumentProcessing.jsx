import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'

// material-ui
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    Collapse,
    Divider,
    FormControlLabel,
    LinearProgress,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography
} from '@mui/material'

// project imports
import MainCard from '@/ui-component/cards/MainCard'
import { StyledButton } from '@/ui-component/button/StyledButton'
import ComponentsListDialog from '@/views/docstore/ComponentsListDialog'
import vibeflowDocStoreApi from '@/api/vibeflowDocStore'
import nodesApi from '@/api/nodes'
import useApi from '@/hooks/useApi'

// icons
import { IconAlertTriangle, IconPlayerStop, IconRefresh, IconSparkles } from '@tabler/icons-react'

const JOB_POLL_INTERVAL_MS = 2000

const formatDuration = (ms) => (typeof ms === 'number' ? `${ms} ms` : '-')

/**
 * VibeFlow — Advanced Document Processing.
 *
 * Optional pre-processing that runs before the splitter:
 *   Document Fractionator (segments of at most 3 pages, split on semantic boundaries)
 *   + Document Summary Pipeline (summary produced by the selected chat model).
 * The knowledge graph is built from the same segments and summaries.
 *
 * Everything is executed by the server pipeline (`/vibeflow-docstore/.../pipeline`) which uses the
 * real loader nodes and chat models: the preview and the background job both show measured results.
 */
const AdvancedDocumentProcessing = ({ documentStoreId, loaderId, disabled, onReport }) => {
    const getNodesByCategoryApi = useApi(nodesApi.getNodesByCategory)

    const [enabled, setEnabled] = useState(false)
    const [maxPagesPerSegment, setMaxPagesPerSegment] = useState(3)
    const [detectSemanticBoundaries, setDetectSemanticBoundaries] = useState(true)
    const [summaryEnabled, setSummaryEnabled] = useState(false)
    const [selectedChatModel, setSelectedChatModel] = useState({})
    const [showChatModelDialog, setShowChatModelDialog] = useState(false)

    const [loading, setLoading] = useState(false)
    const [report, setReport] = useState(null)
    const [error, setError] = useState('')
    const [job, setJob] = useState(null)
    const [jobId, setJobId] = useState('')

    useEffect(() => {
        if (disabled) return
        getNodesByCategoryApi.request('Chat Models')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disabled])

    useEffect(() => {
        if (!jobId) return
        const timer = setInterval(async () => {
            try {
                const response = await vibeflowDocStoreApi.getPipelineJob(documentStoreId, jobId)
                const current = response.data?.data
                setJob(current)
                if (current && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status)) {
                    clearInterval(timer)
                    if (current.result && onReport) onReport(current.result)
                }
            } catch {
                clearInterval(timer)
            }
        }, JOB_POLL_INTERVAL_MS)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobId, documentStoreId])

    const buildOptions = (withGraph = true) => ({
        maxPagesPerSegment,
        detectSemanticBoundaries,
        clean: true,
        backup: true,
        summary: summaryEnabled
            ? {
                  enabled: true,
                  name: selectedChatModel.name,
                  credentialId: selectedChatModel.credential,
                  config: selectedChatModel.inputs || {}
              }
            : { enabled: false },
        graph: { enabled: withGraph }
    })

    const runPreview = async () => {
        setError('')
        setReport(null)
        setLoading(true)
        try {
            const response = await vibeflowDocStoreApi.previewPipeline(documentStoreId, { loaderId, options: buildOptions() })
            setReport(response.data?.data || null)
            if (onReport && response.data?.data) onReport(response.data.data)
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Pipeline failed')
        } finally {
            setLoading(false)
        }
    }

    const runJob = async () => {
        setError('')
        setReport(null)
        setJob(null)
        try {
            const response = await vibeflowDocStoreApi.startPipelineJob(documentStoreId, { loaderId, options: buildOptions() })
            const created = response.data?.data
            if (created?.id) setJobId(created.id)
            setJob(created || null)
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Unable to start the job')
        }
    }

    const cancelJob = async () => {
        if (!jobId) return
        try {
            const response = await vibeflowDocStoreApi.cancelPipelineJob(documentStoreId, jobId)
            setJob(response.data?.data || job)
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError.message || 'Unable to cancel')
        }
    }

    return (
        <MainCard sx={{ mb: 2 }}>
            <Stack flexDirection='column' sx={{ gap: 1 }}>
                <Stack flexDirection='row' sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Stack flexDirection='row' sx={{ alignItems: 'center', gap: 1 }}>
                        <Typography variant='h4'>Advanced Document Processing</Typography>
                        <Chip size='small' variant='outlined' label='optional' />
                    </Stack>
                    <FormControlLabel
                        control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={disabled} />}
                        label={enabled ? 'Enabled' : 'Disabled'}
                    />
                </Stack>
                <Typography variant='body2' color='text.secondary'>
                    Pre-processing applied before the splitter: fractionator (segments of at most 3 pages, cut on semantic boundaries) and
                    optional summary per segment. The knowledge graph is built from the same segments.
                </Typography>

                <Collapse in={enabled}>
                    <Stack flexDirection='column' sx={{ gap: 1.5, mt: 1 }}>
                        <Divider />
                        <Stack flexDirection='row' sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Typography variant='subtitle2'>Document Fractionator</Typography>
                            <TextField
                                size='small'
                                type='number'
                                label='Max pages per segment'
                                value={maxPagesPerSegment}
                                onChange={(event) => setMaxPagesPerSegment(Number(event.target.value) || 3)}
                                inputProps={{ min: 1, max: 20 }}
                                sx={{ width: 220 }}
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={detectSemanticBoundaries}
                                        onChange={(event) => setDetectSemanticBoundaries(event.target.checked)}
                                    />
                                }
                                label='Cut on semantic boundaries'
                            />
                        </Stack>

                        <Divider />
                        <Stack flexDirection='row' sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Typography variant='subtitle2'>Document Summary Pipeline</Typography>
                            <FormControlLabel
                                control={<Switch checked={summaryEnabled} onChange={(event) => setSummaryEnabled(event.target.checked)} />}
                                label={summaryEnabled ? 'Summary enabled' : 'Summary disabled'}
                            />
                            {summaryEnabled && (
                                <>
                                    <StyledButton
                                        variant='outlined'
                                        sx={{ borderRadius: 2 }}
                                        onClick={() => setShowChatModelDialog(true)}
                                        startIcon={<IconSparkles size={16} />}
                                    >
                                        {selectedChatModel?.label ? `Model: ${selectedChatModel.label}` : 'Select model'}
                                    </StyledButton>
                                    {!selectedChatModel?.name && (
                                        <Typography variant='caption' color='warning.main'>
                                            A chat model is required to produce summaries
                                        </Typography>
                                    )}
                                </>
                            )}
                        </Stack>

                        <Stack flexDirection='row' sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                            <StyledButton
                                variant='contained'
                                sx={{ borderRadius: 2 }}
                                disabled={loading || disabled || !documentStoreId || (summaryEnabled && !selectedChatModel?.name)}
                                onClick={runPreview}
                                startIcon={<IconRefresh size={16} />}
                            >
                                Preview the pipeline
                            </StyledButton>
                            <StyledButton
                                variant='outlined'
                                sx={{ borderRadius: 2 }}
                                disabled={loading || disabled || !documentStoreId || (summaryEnabled && !selectedChatModel?.name)}
                                onClick={runJob}
                            >
                                Run as background job
                            </StyledButton>
                            {jobId && job && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status) && (
                                <StyledButton
                                    variant='outlined'
                                    color='error'
                                    sx={{ borderRadius: 2 }}
                                    onClick={cancelJob}
                                    startIcon={<IconPlayerStop size={16} />}
                                >
                                    Cancel
                                </StyledButton>
                            )}
                            {(loading || (job && ['QUEUED', 'RUNNING', 'CANCELLING'].includes(job.status))) && (
                                <CircularProgress size={18} />
                            )}
                        </Stack>

                        {error && <Alert severity='error'>{error}</Alert>}

                        {job && (
                            <Box>
                                <Typography variant='subtitle2'>
                                    Job {job.id} · {job.status} · {job.progress}% ({job.processed}/{job.total || '?'})
                                </Typography>
                                <LinearProgress
                                    variant={job.total ? 'determinate' : 'indeterminate'}
                                    value={job.progress}
                                    sx={{ height: 6, borderRadius: 3 }}
                                />
                                <Stack flexDirection='row' sx={{ gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                                    {(job.stages || []).map((stage) => (
                                        <Chip
                                            key={stage.name}
                                            size='small'
                                            variant='outlined'
                                            color={
                                                stage.status === 'completed'
                                                    ? 'success'
                                                    : stage.status === 'failed'
                                                    ? 'error'
                                                    : stage.status === 'running'
                                                    ? 'primary'
                                                    : 'default'
                                            }
                                            label={`${stage.name}: ${stage.status}${stage.detail ? ` (${stage.detail})` : ''}`}
                                        />
                                    ))}
                                </Stack>
                                {job.error && (
                                    <Typography variant='caption' color='error'>
                                        {job.error}
                                    </Typography>
                                )}
                            </Box>
                        )}

                        {report && (
                            <Box>
                                <Typography variant='subtitle2'>
                                    {report.loaderName} · {report.pages} page(s) [{report.pageGranularity}] · {report.segments.length}{' '}
                                    segment(s)
                                </Typography>
                                {report.pageGranularity === 'unavailable' && (
                                    <Stack flexDirection='row' sx={{ gap: 0.5, alignItems: 'center' }}>
                                        <IconAlertTriangle size={14} />
                                        <Typography variant='caption' color='warning.main'>
                                            This loader does not expose page numbers: the 3-page rule is applied on the extracted blocks
                                        </Typography>
                                    </Stack>
                                )}
                                <Table size='small'>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>#</TableCell>
                                            <TableCell>Pages</TableCell>
                                            <TableCell>Characters</TableCell>
                                            <TableCell>Words</TableCell>
                                            <TableCell>Split reason</TableCell>
                                            <TableCell>Summary</TableCell>
                                            <TableCell>Graph</TableCell>
                                            <TableCell>Backup</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {report.segments.map((segment) => (
                                            <TableRow key={segment.index}>
                                                <TableCell>{segment.index}</TableCell>
                                                <TableCell>
                                                    {segment.startPage}-{segment.endPage}
                                                </TableCell>
                                                <TableCell>{segment.characters}</TableCell>
                                                <TableCell>{segment.words}</TableCell>
                                                <TableCell>
                                                    <Chip size='small' variant='outlined' label={segment.splitReason} />
                                                </TableCell>
                                                <TableCell>
                                                    {segment.summary ? `${segment.summary.slice(0, 40)}…` : <em>none</em>}
                                                </TableCell>
                                                <TableCell>{`${segment.entities} ent. / ${segment.relations} rel.`}</TableCell>
                                                <TableCell>
                                                    {segment.backupPath ? (
                                                        <Typography variant='caption'>{segment.backupPath}</Typography>
                                                    ) : (
                                                        <em>none</em>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                <Stack flexDirection='row' sx={{ gap: 1, flexWrap: 'wrap', mt: 1 }}>
                                    {Object.entries(report.durationsMs || {}).map(([stage, duration]) => (
                                        <Chip key={stage} size='small' variant='outlined' label={`${stage}: ${formatDuration(duration)}`} />
                                    ))}
                                    {report.graph && (
                                        <Chip
                                            size='small'
                                            color='primary'
                                            variant='outlined'
                                            label={`graph ${report.graph.engine}: ${report.graph.nodes} nœuds / ${report.graph.relations} relations`}
                                        />
                                    )}
                                    {report.cleaning && (
                                        <Chip
                                            size='small'
                                            variant='outlined'
                                            label={`cleaner: ${report.cleaning.removedPageNumbers} pages, ${report.cleaning.removedRepeatedLines} répétitions`}
                                        />
                                    )}
                                </Stack>
                            </Box>
                        )}
                    </Stack>
                </Collapse>
            </Stack>

            <ComponentsListDialog
                show={showChatModelDialog}
                dialogProps={{ title: 'Select a Chat Model for the summary' }}
                onCancel={() => setShowChatModelDialog(false)}
                apiCall={nodesApi.getNodesByCategory}
                onSelected={(node) => {
                    // node is a node name: fetch nothing more, the dialog already carries the label
                    const found = (getNodesByCategoryApi.data || []).find(
                        (candidate) => candidate.name === node?.name || candidate.name === node
                    )
                    setSelectedChatModel(found ? { ...found } : { name: node?.name || node, label: node?.label || node })
                    setShowChatModelDialog(false)
                }}
            />
        </MainCard>
    )
}

AdvancedDocumentProcessing.propTypes = {
    documentStoreId: PropTypes.string,
    loaderId: PropTypes.string,
    disabled: PropTypes.bool,
    onReport: PropTypes.func
}

export default AdvancedDocumentProcessing
