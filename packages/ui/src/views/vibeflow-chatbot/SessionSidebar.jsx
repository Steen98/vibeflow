import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'

// material-ui
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    LinearProgress,
    List,
    ListItemButton,
    ListItemText,
    OutlinedInput,
    Stack,
    Tooltip,
    Typography
} from '@mui/material'

// project imports
import vibeflowChatBotApi from '@/api/vibeflowChatBot'

// icons
import {
    IconChevronLeft,
    IconFolder,
    IconLayoutSidebarRightCollapse,
    IconPencil,
    IconPlus,
    IconRefresh,
    IconTrash
} from '@tabler/icons-react'

const Gauge = ({ label, value, reason, suffix = '%' }) => {
    const hasValue = typeof value === 'number' && Number.isFinite(value)
    return (
        <Box>
            <Stack flexDirection='row' sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant='caption'>{label}</Typography>
                <Typography variant='caption' color='text.secondary'>
                    {hasValue ? `${value}${suffix}` : 'unavailable'}
                </Typography>
            </Stack>
            {hasValue ? (
                <LinearProgress variant='determinate' value={Math.max(0, Math.min(100, value))} sx={{ height: 6, borderRadius: 3 }} />
            ) : (
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.3 }}>
                    {reason || 'Not measurable on this host'}
                </Typography>
            )}
        </Box>
    )
}

Gauge.propTypes = {
    label: PropTypes.string,
    value: PropTypes.number,
    reason: PropTypes.string,
    suffix: PropTypes.string
}

/**
 * Right sidebar: session management (new session, workspace, history, search) and AI monitoring.
 * Collapsible so the ChatBot stays usable on small screens.
 */
const SessionSidebar = ({
    sessions,
    activeSessionId,
    activeWorkspaceId,
    workspaces,
    workflows,
    search,
    monitoring,
    monitoringLoading,
    onNewSession,
    onSelectSession,
    onRenameSession,
    onDeleteSession,
    onAssignWorkspace,
    onSearchChange,
    onWorkspaceCreated,
    onRefreshMonitoring,
    onCollapse
}) => {
    const [workspaceDialog, setWorkspaceDialog] = useState(false)
    const [browsing, setBrowsing] = useState({ path: '', parent: null, entries: [] })
    const [browseLoading, setBrowseLoading] = useState(false)
    const [newWorkspaceName, setNewWorkspaceName] = useState('')
    const [browseError, setBrowseError] = useState('')

    const browse = async (targetPath) => {
        setBrowseLoading(true)
        setBrowseError('')
        try {
            const response = await vibeflowChatBotApi.browse(targetPath)
            setBrowsing(response.data)
            if (!newWorkspaceName && response.data.path) {
                setNewWorkspaceName(response.data.path.split(/[\\/]/).filter(Boolean).pop() || '')
            }
        } catch (error) {
            setBrowseError(error?.response?.data?.message || error.message || 'Unable to browse this directory')
        } finally {
            setBrowseLoading(false)
        }
    }

    useEffect(() => {
        if (workspaceDialog) browse('')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceDialog])

    const createWorkspace = async () => {
        if (!browsing.path || !newWorkspaceName.trim().length) return
        await vibeflowChatBotApi.createWorkspace({ name: newWorkspaceName.trim(), workingDirectory: browsing.path })
        setWorkspaceDialog(false)
        setNewWorkspaceName('')
        if (onWorkspaceCreated) onWorkspaceCreated()
    }

    const workflowName = (workflowId) => workflows.find((workflow) => workflow.id === workflowId)?.name || ''

    return (
        <Box sx={{ width: 340, minWidth: 340, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.5 }}>
            <Stack flexDirection='row' sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant='subtitle1' sx={{ fontWeight: 600 }}>
                    Conversations
                </Typography>
                <Stack flexDirection='row' sx={{ gap: 0.5 }}>
                    <Tooltip title='Refresh monitoring'>
                        <IconButton size='small' onClick={onRefreshMonitoring} aria-label='refresh monitoring'>
                            <IconRefresh size={16} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title='Hide sidebar'>
                        <IconButton size='small' onClick={onCollapse} aria-label='hide sidebar'>
                            <IconLayoutSidebarRightCollapse size={16} />
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Stack>

            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, pr: 0.25 }}>
                <Button variant='contained' startIcon={<IconPlus size={16} />} sx={{ borderRadius: 2 }} onClick={onNewSession}>
                    New Session
                </Button>

                <Stack flexDirection='row' sx={{ gap: 1, alignItems: 'center' }}>
                    <OutlinedInput
                        size='small'
                        fullWidth
                        placeholder='Search sessions'
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                    />
                </Stack>

                {/* Workspace of the active session */}
                <Box>
                    <Typography variant='caption' color='text.secondary'>
                        Workspace
                    </Typography>
                    <Stack flexDirection='row' sx={{ gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                        {workspaces.map((workspace) => (
                            <Chip
                                key={workspace.id}
                                size='small'
                                icon={<IconFolder size={14} />}
                                label={workspace.name}
                                color={activeSessionId && activeWorkspaceId === workspace.id ? 'primary' : 'default'}
                                variant='outlined'
                                onClick={() => onAssignWorkspace(workspace.id)}
                            />
                        ))}
                        <Chip
                            size='small'
                            variant='outlined'
                            label='New workspace'
                            icon={<IconPlus size={14} />}
                            onClick={() => setWorkspaceDialog(true)}
                        />
                    </Stack>
                </Box>

                <Divider />

                <Box sx={{ minHeight: 120 }}>
                    {sessions.length === 0 && (
                        <Typography variant='caption' color='text.secondary'>
                            No session yet. Create one to start a conversation.
                        </Typography>
                    )}
                    <List dense disablePadding>
                        {sessions.map((session) => (
                            <ListItemButton
                                key={session.id}
                                selected={session.id === activeSessionId}
                                onClick={() => onSelectSession(session.id)}
                                sx={{ borderRadius: 2, alignItems: 'flex-start' }}
                            >
                                <ListItemText
                                    primary={
                                        <Typography variant='body2' sx={{ fontWeight: session.id === activeSessionId ? 600 : 400 }}>
                                            {session.title}
                                        </Typography>
                                    }
                                    secondary={
                                        <Typography variant='caption' color='text.secondary' component='span'>
                                            {workflowName(session.defaultWorkflowId) || 'no default workflow'} · {session.messageCount} msg
                                            · {new Date(session.lastActivityAt).toLocaleString()}
                                            {session.workspaceId
                                                ? ` · ${workspaces.find((w) => w.id === session.workspaceId)?.name || ''}`
                                                : ''}
                                        </Typography>
                                    }
                                />
                                <Stack flexDirection='row' sx={{ gap: 0 }}>
                                    <Tooltip title='Rename'>
                                        <IconButton
                                            size='small'
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                onRenameSession(session)
                                            }}
                                        >
                                            <IconPencil size={14} />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title='Delete'>
                                        <IconButton
                                            size='small'
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                onDeleteSession(session)
                                            }}
                                        >
                                            <IconTrash size={14} />
                                        </IconButton>
                                    </Tooltip>
                                </Stack>
                            </ListItemButton>
                        ))}
                    </List>
                </Box>

                <Divider />

                {/* AI monitoring */}
                <Box sx={{ p: 1.25, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                    <Stack flexDirection='row' sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant='subtitle2' sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            AI Monitoring
                        </Typography>
                        {monitoringLoading && <CircularProgress size={12} />}
                    </Stack>
                    <Stack sx={{ gap: 1, mt: 1 }}>
                        <Gauge label='Context usage' value={monitoring?.context?.usedPercent} reason='No active session context' />
                        {monitoring?.context && (
                            <Typography variant='caption' color='text.secondary'>
                                {monitoring.context.usedMessages} / {monitoring.context.windowMessages} messages of the context window
                                (session holds {monitoring.context.totalMessages})
                            </Typography>
                        )}
                        {monitoring?.llm && (
                            <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.3 }}>
                                Max context supported:{' '}
                                {monitoring.llm.maxContextTokens
                                    ? `${monitoring.llm.maxContextTokens} tokens (declared by the workflow${
                                          monitoring.llm.model ? ` · ${monitoring.llm.model}` : ''
                                      })`
                                    : monitoring.llm.reason || 'not declared by the workflow'}
                            </Typography>
                        )}
                        <Gauge label={`CPU (${monitoring?.cpu?.cores ?? '?'} cores)`} value={monitoring?.cpu?.usagePercent} />
                        <Gauge label='RAM' value={monitoring?.memory?.usedPercent} reason='Memory usage unavailable on this host' />
                        {monitoring?.memory && (
                            <Typography variant='caption' color='text.secondary'>
                                {(monitoring.memory.usedBytes / 1024 ** 3).toFixed(1)} GB /{' '}
                                {(monitoring.memory.totalBytes / 1024 ** 3).toFixed(1)} GB
                            </Typography>
                        )}
                        <Box>
                            <Stack flexDirection='row' sx={{ justifyContent: 'space-between' }}>
                                <Typography variant='caption'>Provider balance</Typography>
                                <Typography variant='caption' color='text.secondary'>
                                    {monitoring?.providerBalance?.available
                                        ? `${monitoring.providerBalance.balance?.toFixed?.(2)} ${monitoring.providerBalance.currency} (${
                                              monitoring.providerBalance.provider
                                          })`
                                        : 'unavailable'}
                                </Typography>
                            </Stack>
                            {!monitoring?.providerBalance?.available && (
                                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.3 }}>
                                    {monitoring?.providerBalance?.reason || 'No provider balance endpoint configured'}
                                </Typography>
                            )}
                        </Box>
                        {monitoring?.platform && (
                            <Typography variant='caption' color='text.secondary'>
                                {monitoring.platform}
                            </Typography>
                        )}
                    </Stack>
                </Box>
            </Box>

            {/* Host directory browser for a new workspace */}
            <Dialog open={workspaceDialog} onClose={() => setWorkspaceDialog(false)} fullWidth maxWidth='sm'>
                <DialogTitle sx={{ fontSize: '1rem' }}>New workspace</DialogTitle>
                <DialogContent>
                    <Stack sx={{ gap: 1.5, mt: 1 }}>
                        <OutlinedInput
                            size='small'
                            fullWidth
                            placeholder='Workspace name'
                            value={newWorkspaceName}
                            onChange={(event) => setNewWorkspaceName(event.target.value)}
                        />
                        <Stack flexDirection='row' sx={{ gap: 1, alignItems: 'center' }}>
                            <IconButton
                                size='small'
                                disabled={!browsing.parent && !browsing.path}
                                onClick={() => browse(browsing.parent || '')}
                            >
                                <IconChevronLeft size={16} />
                            </IconButton>
                            <Typography variant='caption' sx={{ overflowWrap: 'anywhere' }}>
                                {browsing.path || 'Select a drive or a root folder'}
                            </Typography>
                        </Stack>
                        {browseLoading && <LinearProgress />}
                        {browseError && (
                            <Typography variant='caption' color='error'>
                                {browseError}
                            </Typography>
                        )}
                        <Box sx={{ maxHeight: 260, overflowY: 'auto' }}>
                            {browsing.entries?.map((entry) => (
                                <ListItemButton key={entry.path} onClick={() => browse(entry.path)} sx={{ borderRadius: 2 }}>
                                    <IconFolder size={16} style={{ marginRight: 8 }} />
                                    <ListItemText primary={<Typography variant='body2'>{entry.name}</Typography>} />
                                </ListItemButton>
                            ))}
                            {!browseLoading && browsing.entries?.length === 0 && (
                                <Typography variant='caption' color='text.secondary'>
                                    No sub-directory here
                                </Typography>
                            )}
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setWorkspaceDialog(false)}>Cancel</Button>
                    <Button variant='contained' disabled={!browsing.path || !newWorkspaceName.trim().length} onClick={createWorkspace}>
                        Use this folder
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

SessionSidebar.propTypes = {
    sessions: PropTypes.array,
    activeSessionId: PropTypes.string,
    activeWorkspaceId: PropTypes.string,
    workspaces: PropTypes.array,
    workflows: PropTypes.array,
    search: PropTypes.string,
    monitoring: PropTypes.object,
    monitoringLoading: PropTypes.bool,
    onNewSession: PropTypes.func,
    onSelectSession: PropTypes.func,
    onRenameSession: PropTypes.func,
    onDeleteSession: PropTypes.func,
    onAssignWorkspace: PropTypes.func,
    onSearchChange: PropTypes.func,
    onWorkspaceCreated: PropTypes.func,
    onRefreshMonitoring: PropTypes.func,
    onCollapse: PropTypes.func
}

export default SessionSidebar
