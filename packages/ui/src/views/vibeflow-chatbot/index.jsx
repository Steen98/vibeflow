import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// material-ui
import {
    Alert,
    Box,
    Button,
    Chip,
    IconButton,
    LinearProgress,
    MenuItem,
    Skeleton,
    Stack,
    TextField,
    Tooltip,
    Typography
} from '@mui/material'

// project imports
import MainCard from '@/ui-component/cards/MainCard'
import ConversationMessage from './ConversationMessage'
import SessionSidebar from './SessionSidebar'
import ComposerBar from './ComposerBar'
import { streamChatBotExecute } from './streaming'
import vibeflowChatBotApi from '@/api/vibeflowChatBot'

// icons
import { IconLayoutSidebarRightExpand } from '@tabler/icons-react'

const MESSAGE_PAGE_SIZE = 40
const MONITORING_INTERVAL_MS = 10000

const extractError = (error) => error?.response?.data?.message || error?.message || 'Unexpected error'

/**
 * VibeFlow ChatBot — conversational execution layer for the existing workflows.
 * Three zones: conversation, input (text / attachments / voice), right sidebar (sessions,
 * workspaces, AI monitoring). The workflow is never re-implemented here: every execution goes
 * through the real Flowise prediction pipeline.
 */
const VibeFlowChatBot = () => {
    const [sessions, setSessions] = useState([])
    const [activeSessionId, setActiveSessionId] = useState(null)
    const [activeSession, setActiveSession] = useState(null)
    const [messages, setMessages] = useState([])
    const [hasMore, setHasMore] = useState(false)
    const [messagesLoading, setMessagesLoading] = useState(false)

    const [workflows, setWorkflows] = useState([])
    const [workflowsLoading, setWorkflowsLoading] = useState(true)
    const [workspaces, setWorkspaces] = useState([])
    const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
    const [capabilities, setCapabilities] = useState(null)

    const [input, setInput] = useState('')
    const [attachments, setAttachments] = useState([])
    const [sending, setSending] = useState(false)
    const [streamingId, setStreamingId] = useState(null)
    const [runningExecution, setRunningExecution] = useState(null)
    const [notice, setNotice] = useState(null)

    const [search, setSearch] = useState('')
    const [monitoring, setMonitoring] = useState(null)
    const [monitoringLoading, setMonitoringLoading] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(true)

    const scrollRef = useRef(null)
    const bottomRef = useRef(null)
    const abortControllerRef = useRef(null)

    // ------------------------------ loaders ------------------------------

    const loadMonitoring = useCallback(async (sessionId) => {
        setMonitoringLoading(true)
        try {
            const response = await vibeflowChatBotApi.getMonitoring(sessionId ? { sessionId } : {})
            setMonitoring(response.data)
        } catch {
            setMonitoring(null)
        } finally {
            setMonitoringLoading(false)
        }
    }, [])

    const loadWorkflows = useCallback(async () => {
        setWorkflowsLoading(true)
        try {
            const response = await vibeflowChatBotApi.getWorkflows()
            setWorkflows(response.data?.data || [])
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        } finally {
            setWorkflowsLoading(false)
        }
    }, [])

    const loadWorkspaces = useCallback(async () => {
        try {
            const response = await vibeflowChatBotApi.getWorkspaces()
            setWorkspaces(response.data?.data || [])
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        }
    }, [])

    const loadSessions = useCallback(async (filter) => {
        try {
            const response = await vibeflowChatBotApi.getSessions(filter || {})
            setSessions(response.data?.data || [])
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        }
    }, [])

    const loadMessages = useCallback(async (sessionId, options = {}) => {
        if (!sessionId) {
            setMessages([])
            setHasMore(false)
            return
        }
        setMessagesLoading(true)
        try {
            const response = await vibeflowChatBotApi.getMessages(sessionId, { limit: options.limit || MESSAGE_PAGE_SIZE })
            if (options.prepend) setMessages((previous) => [...(response.data || []), ...previous])
            else setMessages(response.data || [])
            setHasMore(Boolean(response.hasMore))
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        } finally {
            setMessagesLoading(false)
        }
    }, [])

    const loadCapabilities = useCallback(async (workflowId) => {
        if (!workflowId) {
            setCapabilities(null)
            return
        }
        try {
            const response = await vibeflowChatBotApi.getWorkflowCapabilities(workflowId)
            setCapabilities(response.data?.data || null)
        } catch {
            setCapabilities(null)
        }
    }, [])

    const openSession = useCallback(
        async (sessionId) => {
            setActiveSessionId(sessionId)
            setRunningExecution(null)
            try {
                const response = await vibeflowChatBotApi.getSession(sessionId)
                setActiveSession(response.data)
                if (response.data?.defaultWorkflowId) setSelectedWorkflowId(response.data.defaultWorkflowId)
            } catch (error) {
                setNotice({ severity: 'error', text: extractError(error) })
            }
            await loadMessages(sessionId)
            await loadMonitoring(sessionId)
        },
        [loadMessages, loadMonitoring]
    )

    useEffect(() => {
        loadWorkflows()
        loadWorkspaces()
        loadSessions()
        loadMonitoring()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        loadCapabilities(selectedWorkflowId)
    }, [selectedWorkflowId, loadCapabilities])

    useEffect(() => {
        const timer = setInterval(() => loadMonitoring(activeSessionId), MONITORING_INTERVAL_MS)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSessionId])

    useEffect(() => {
        if (hasMore) return
        const container = scrollRef.current
        if (!container) return
        const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200
        if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, hasMore])

    // ------------------------------ sessions ------------------------------

    const createSession = async (options = {}) => {
        const response = await vibeflowChatBotApi.createSession({
            workspaceId: options.workspaceId,
            defaultWorkflowId: selectedWorkflowId || undefined,
            title: options.title
        })
        await loadSessions()
        await openSession(response.data.id)
        return response.data
    }

    const handleNewSession = async () => {
        try {
            await createSession()
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        }
    }

    const handleRenameSession = async (session) => {
        const title = window.prompt('Session name', session.title)
        if (!title || !title.trim().length) return
        try {
            await vibeflowChatBotApi.updateSession(session.id, { title: title.trim() })
            await loadSessions()
            if (session.id === activeSessionId) {
                const refreshed = await vibeflowChatBotApi.getSession(session.id)
                setActiveSession(refreshed.data)
            }
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        }
    }

    const handleDeleteSession = async (session) => {
        if (!window.confirm(`Delete the session "${session.title}" and its history?`)) return
        try {
            await vibeflowChatBotApi.deleteSession(session.id)
            if (session.id === activeSessionId) {
                setActiveSessionId(null)
                setActiveSession(null)
                setMessages([])
            }
            await loadSessions()
            await loadMonitoring()
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        }
    }

    const handleAssignWorkspace = async (workspaceId) => {
        try {
            if (!activeSessionId) {
                const created = await vibeflowChatBotApi.createSession({ workspaceId, defaultWorkflowId: selectedWorkflowId || undefined })
                await loadSessions()
                await openSession(created.data.id)
                return
            }
            await vibeflowChatBotApi.updateSession(activeSessionId, { workspaceId })
            await openSession(activeSessionId)
            await loadSessions()
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        }
    }

    // ------------------------------ execution ------------------------------

    const runRequest = async (question, options = {}) => {
        if (!question || !question.trim().length) return
        const workflowId = options.workflowId || selectedWorkflowId
        if (!workflowId) {
            setNotice({ severity: 'warning', text: 'Select a workflow before sending a request.' })
            return
        }

        setSending(true)
        setNotice(null)

        try {
            let sessionId = activeSessionId
            if (!sessionId || options.asBranch) {
                const created = await createSession({
                    title: options.asBranch ? `Branch · ${(question || '').slice(0, 40)}` : activeSession?.title || undefined,
                    workspaceId: activeSession?.workspaceId
                })
                sessionId = created.id
            }

            // Pre-create the execution so "Stop" is usable while the workflow runs
            let execution = null
            try {
                const createdExecution = await vibeflowChatBotApi.createExecution(sessionId, { workflowId })
                execution = createdExecution.data
                setRunningExecution(execution)
            } catch {
                execution = null
            }

            const optimisticMessage = {
                id: `local_${Date.now()}`,
                sessionId,
                role: 'user',
                content: question,
                workflowId,
                attachments: (attachments || []).map(({ data: _data, ...rest }) => ({ ...rest, status: 'uploaded' })),
                createdAt: new Date().toISOString()
            }
            setMessages((previous) => [...previous, optimisticMessage])

            const uploads = (attachments || []).map((attachment) => ({
                data: attachment.data,
                name: attachment.name,
                type: 'file',
                mime: attachment.mime || attachment.type
            }))

            const streamId = `stream_${Date.now()}`
            setStreamingId(streamId)
            const abortController = new AbortController()
            abortControllerRef.current = abortController

            let streamedText = ''
            let completed = false

            try {
                await streamChatBotExecute({
                    sessionId,
                    body: {
                        question,
                        workflowId,
                        executionId: execution?.id,
                        uploads,
                        includeContext: options.includeContext
                    },
                    signal: abortController.signal,
                    onEvent: (event) => {
                        if (!event?.event) return
                        if (event.event === 'token') {
                            streamedText += typeof event.data === 'string' ? event.data : ''
                            setMessages((previous) => {
                                const without = previous.filter((message) => message.id !== streamId)
                                return [
                                    ...without,
                                    {
                                        id: streamId,
                                        sessionId,
                                        role: 'assistant',
                                        content: streamedText,
                                        workflowId,
                                        executionId: execution?.id,
                                        createdAt: new Date().toISOString(),
                                        metadata: { streaming: true, workflowId }
                                    }
                                ]
                            })
                        } else if (event.event === 'vibeflowChatBotDone') {
                            completed = true
                            const payload = event.data || {}
                            setMessages((previous) =>
                                [
                                    ...previous.filter((message) => message.id !== streamId && message.id !== optimisticMessage.id),
                                    payload.userMessage,
                                    payload.assistantMessage
                                ].filter(Boolean)
                            )
                        } else if (event.event === 'vibeflowChatBotError') {
                            completed = true
                            const payload = event.data || {}
                            setMessages((previous) =>
                                [
                                    ...previous.filter((message) => message.id !== streamId && message.id !== optimisticMessage.id),
                                    payload.systemMessage
                                ].filter(Boolean)
                            )
                            setNotice({ severity: 'error', text: payload.message })
                        }
                    }
                })

                if (!completed) {
                    // Stream closed without the final event: fall back to a reload from the store
                    await loadMessages(sessionId)
                }
            } catch (streamError) {
                if (streamError?.name === 'AbortError') {
                    setNotice({ severity: 'info', text: 'Streaming request aborted.' })
                    await loadMessages(sessionId)
                } else {
                    // Streaming unavailable: fall back to the non streaming endpoint (real execution too)
                    try {
                        const response = await vibeflowChatBotApi.executeWorkflow(sessionId, {
                            question,
                            workflowId,
                            executionId: execution?.id,
                            uploads
                        })
                        const payload = response.data || {}
                        setMessages((previous) =>
                            [
                                ...previous.filter((message) => message.id !== streamId && message.id !== optimisticMessage.id),
                                payload.userMessage,
                                payload.assistantMessage
                            ].filter(Boolean)
                        )
                    } catch (fallbackError) {
                        setNotice({ severity: 'error', text: extractError(fallbackError) })
                        await loadMessages(sessionId)
                    }
                }
            }

            await loadSessions()
            await loadMonitoring(sessionId)
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
            if (activeSessionId) await loadMessages(activeSessionId)
        } finally {
            abortControllerRef.current = null
            setStreamingId(null)
            setSending(false)
            setRunningExecution(null)
            setAttachments([])
        }
    }

    const handleSend = async () => {
        const question = input.trim()
        if (!question.length) return
        setInput('')
        await runRequest(question)
    }

    const handleRetry = async (message) => {
        await runRequest(message.content, { workflowId: message.workflowId })
    }

    const handleRetryAsBranch = async (message) => {
        await runRequest(message.content, { workflowId: message.workflowId, asBranch: true })
    }

    const handleStop = async () => {
        if (abortControllerRef.current) {
            try {
                abortControllerRef.current.abort()
            } catch {
                /* ignored */
            }
        }
        if (!activeSessionId || !runningExecution?.id) {
            setNotice({
                severity: 'warning',
                text: 'Stop requested. No cancellation handle is available for this run, so the workflow may keep running server side.'
            })
            return
        }
        try {
            const response = await vibeflowChatBotApi.stopExecution(activeSessionId, runningExecution.id)
            const outcome = response.data || {}
            setNotice({
                severity: outcome.supported ? 'info' : 'warning',
                text: `${outcome.message}${outcome.cancelled ? ' (cancelled)' : ' (still running)'}`
            })
        } catch (error) {
            setNotice({ severity: 'error', text: extractError(error) })
        }
    }

    const handleLoadOlder = async () => {
        if (!activeSessionId || !messages.length) return
        const container = scrollRef.current
        const previousHeight = container ? container.scrollHeight : 0
        await loadMessages(activeSessionId, { limit: MESSAGE_PAGE_SIZE, prepend: true })
        if (container) {
            container.scrollTop = container.scrollTop + (container.scrollHeight - previousHeight)
        }
        setHasMore(false)
    }

    const handleTranscript = (text) => {
        setInput((previous) => (previous.trim().length ? `${previous} ${text}` : text))
        setNotice({ severity: 'success', text: 'Transcription added to the input, you can edit it before sending.' })
    }

    const workflowOptions = useMemo(
        () =>
            workflows.map((workflow) => (
                <MenuItem key={workflow.id} value={workflow.id}>
                    {workflow.name} · {workflow.type}
                </MenuItem>
            )),
        [workflows]
    )

    return (
        <MainCard content={false} sx={{ height: 'calc(100vh - 120px)', overflow: 'hidden' }}>
            <Stack flexDirection='row' sx={{ height: '100%', minHeight: 0 }}>
                <Stack sx={{ flex: 1, minWidth: 0, height: '100%' }}>
                    {/* header */}
                    <Stack
                        flexDirection='row'
                        sx={{
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 2,
                            p: 1.5,
                            borderBottom: 1,
                            borderColor: 'divider'
                        }}
                    >
                        <Stack flexDirection='row' sx={{ alignItems: 'center', gap: 1, minWidth: 0 }}>
                            <Typography variant='subtitle1' noWrap>
                                {activeSession?.title || 'ChatBot'}
                            </Typography>
                            {activeSession?.workspaceId && (
                                <Chip
                                    size='small'
                                    variant='outlined'
                                    label={workspaces.find((workspace) => workspace.id === activeSession.workspaceId)?.name || 'workspace'}
                                />
                            )}
                            {capabilities?.speechToText?.available && (
                                <Chip size='small' variant='outlined' color='primary' label={`STT: ${capabilities.speechToText.source}`} />
                            )}
                        </Stack>
                        <Stack flexDirection='row' sx={{ alignItems: 'center', gap: 1 }}>
                            <TextField
                                select
                                size='small'
                                label='Workflow'
                                value={selectedWorkflowId}
                                onChange={(event) => setSelectedWorkflowId(event.target.value)}
                                sx={{ minWidth: 240 }}
                                disabled={workflowsLoading}
                            >
                                <MenuItem value=''>
                                    <em>{workflowsLoading ? 'Loading…' : 'Select a workflow'}</em>
                                </MenuItem>
                                {workflowOptions}
                            </TextField>
                            {!sidebarOpen && (
                                <Tooltip title='Show sidebar'>
                                    <IconButton onClick={() => setSidebarOpen(true)}>
                                        <IconLayoutSidebarRightExpand size={18} />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Stack>
                    </Stack>

                    {/* conversation */}
                    <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', p: 2, minHeight: 0 }}>
                        {hasMore && (
                            <Stack sx={{ alignItems: 'center', mb: 1 }}>
                                <Button size='small' onClick={handleLoadOlder}>
                                    Load older messages
                                </Button>
                            </Stack>
                        )}
                        {messagesLoading && messages.length === 0 && <Skeleton variant='rounded' height={120} />}
                        {!messagesLoading && messages.length === 0 && (
                            <Stack sx={{ alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1 }}>
                                <Typography variant='body1'>Select a workflow, then send your first request.</Typography>
                                <Typography variant='caption' color='text.secondary'>
                                    The ChatBot executes the workflows that already exist in Flowise.
                                </Typography>
                            </Stack>
                        )}
                        <Stack sx={{ gap: 2 }}>
                            {messages.map((message) => (
                                <ConversationMessage
                                    key={message.id}
                                    message={message}
                                    isExecuting={Boolean(sending) && message.role === 'user'}
                                    onRetry={handleRetry}
                                    onRetryAsBranch={handleRetryAsBranch}
                                    onStop={handleStop}
                                />
                            ))}
                        </Stack>
                        {sending && (
                            <Stack sx={{ mt: 2, gap: 1 }}>
                                <LinearProgress />
                                <Stack flexDirection='row' sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Typography variant='caption' color='text.secondary'>
                                        {streamingId ? 'Streaming the workflow answer…' : 'Running the workflow…'}
                                    </Typography>
                                    <Button size='small' color='error' onClick={handleStop}>
                                        Stop
                                    </Button>
                                </Stack>
                            </Stack>
                        )}
                        <div ref={bottomRef} />
                    </Box>

                    {notice && (
                        <Box sx={{ px: 2 }}>
                            <Alert severity={notice.severity} onClose={() => setNotice(null)} sx={{ mb: 1 }}>
                                {notice.text}
                            </Alert>
                        </Box>
                    )}

                    <ComposerBar
                        value={input}
                        onChange={setInput}
                        onSend={handleSend}
                        onStop={handleStop}
                        sending={sending}
                        attachments={attachments}
                        onAttachmentsChange={setAttachments}
                        maxFileSizeBytes={capabilities?.uploads?.maxFileSizeBytes}
                        speechToText={capabilities?.speechToText}
                        workflowSelected={Boolean(selectedWorkflowId)}
                        sessionId={activeSessionId}
                        workflowId={selectedWorkflowId}
                        onNotice={setNotice}
                        onTranscript={handleTranscript}
                    />
                </Stack>

                {sidebarOpen && (
                    <>
                        <Box sx={{ borderLeft: 1, borderColor: 'divider' }} />
                        <SessionSidebar
                            sessions={sessions.filter(
                                (session) => !search.trim().length || session.title.toLowerCase().includes(search.trim().toLowerCase())
                            )}
                            activeSessionId={activeSessionId}
                            activeWorkspaceId={activeSession?.workspaceId}
                            workspaces={workspaces}
                            workflows={workflows}
                            search={search}
                            monitoring={monitoring}
                            monitoringLoading={monitoringLoading}
                            onNewSession={handleNewSession}
                            onSelectSession={openSession}
                            onRenameSession={handleRenameSession}
                            onDeleteSession={handleDeleteSession}
                            onAssignWorkspace={handleAssignWorkspace}
                            onSearchChange={setSearch}
                            onWorkspaceCreated={async () => {
                                await loadWorkspaces()
                            }}
                            onRefreshMonitoring={() => loadMonitoring(activeSessionId)}
                            onCollapse={() => setSidebarOpen(false)}
                        />
                    </>
                )}
            </Stack>
        </MainCard>
    )
}

export default VibeFlowChatBot
