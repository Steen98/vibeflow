import { useState } from 'react'
import PropTypes from 'prop-types'

// material-ui
import { Avatar, Box, Chip, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

// project imports
import { MemoizedReactMarkdown } from '@/ui-component/markdown/MemoizedReactMarkdown'

// icons
import { IconCheck, IconCopy, IconGitBranch, IconPlayerStop, IconRefresh } from '@tabler/icons-react'

const shortId = (value) => (value && value.length > 10 ? `${value.slice(0, 8)}…` : value || '')

const formatSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * One conversation block. Origin is always explicit: user, workflow (assistant) or system.
 * Copy / Retry / Retry as new branch / Stop are contextual actions.
 */
const ConversationMessage = ({ message, isExecuting, onRetry, onRetryAsBranch, onStop }) => {
    const theme = useTheme()
    const [copied, setCopied] = useState(false)

    const copyToClipboard = async (value) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(value)
                return true
            }
        } catch {
            /* fallback below */
        }
        try {
            const textarea = document.createElement('textarea')
            textarea.value = value
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            document.body.appendChild(textarea)
            textarea.select()
            const ok = document.execCommand('copy')
            document.body.removeChild(textarea)
            return ok
        } catch {
            return false
        }
    }

    const handleCopy = async () => {
        const ok = await copyToClipboard(message.content || '')
        if (ok) {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        }
    }

    if (message.role === 'system') {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Paper
                    variant='outlined'
                    sx={{
                        px: 2,
                        py: 1,
                        borderRadius: 2,
                        maxWidth: '85%',
                        borderColor: theme.palette.warning.main,
                        bgcolor: alpha(theme.palette.warning.main, 0.08)
                    }}
                >
                    <Typography variant='caption' sx={{ whiteSpace: 'pre-wrap' }}>
                        {message.content}
                    </Typography>
                </Paper>
            </Box>
        )
    }

    const isUser = message.role === 'user'
    const usedTools = Array.isArray(message.metadata?.usedTools) ? message.metadata.usedTools : []
    const sourceDocuments = Array.isArray(message.metadata?.sourceDocuments) ? message.metadata.sourceDocuments : []

    return (
        <Stack flexDirection='row' sx={{ gap: 1, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
            {!isUser && <Avatar sx={{ width: 30, height: 30, bgcolor: theme.palette.primary.main, fontSize: 12 }}>AI</Avatar>}
            <Box sx={{ maxWidth: '82%', minWidth: 0 }}>
                <Paper
                    variant='outlined'
                    sx={{
                        px: 1.5,
                        py: 1,
                        borderRadius: 2,
                        bgcolor: isUser ? alpha(theme.palette.primary.main, 0.12) : theme.palette.background.paper
                    }}
                >
                    {isUser ? (
                        <Typography variant='body2' sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                            {message.content}
                        </Typography>
                    ) : (
                        <Box sx={{ overflowX: 'auto' }}>
                            <MemoizedReactMarkdown isFullWidth={false}>{message.content || ''}</MemoizedReactMarkdown>
                        </Box>
                    )}

                    {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                        <Stack sx={{ mt: 1, gap: 0.5 }}>
                            {message.attachments.map((attachment, index) => (
                                <Chip
                                    key={`${attachment.name}-${index}`}
                                    size='small'
                                    variant='outlined'
                                    label={`${attachment.name}${attachment.size ? ` · ${formatSize(attachment.size)}` : ''}${
                                        attachment.status ? ` · ${attachment.status}` : ''
                                    }`}
                                />
                            ))}
                        </Stack>
                    )}

                    {message.transcription && (
                        <Box sx={{ mt: 1 }}>
                            <Typography variant='caption' color='text.secondary'>
                                Transcription ({message.transcription.engine})
                            </Typography>
                            <Typography variant='body2' sx={{ fontStyle: 'italic' }}>
                                {message.transcription.text}
                            </Typography>
                        </Box>
                    )}
                </Paper>

                <Stack
                    flexDirection='row'
                    sx={{ gap: 0.5, mt: 0.5, alignItems: 'center', flexWrap: 'wrap', justifyContent: isUser ? 'flex-end' : 'flex-start' }}
                >
                    <Typography variant='caption' color='text.secondary'>
                        {message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}
                    </Typography>
                    {message.workflowId && <Chip size='small' variant='outlined' label={`workflow ${shortId(message.workflowId)}`} />}
                    {message.executionId && <Chip size='small' variant='outlined' label={`exec ${shortId(message.executionId)}`} />}
                    {usedTools.length > 0 && <Chip size='small' variant='outlined' color='primary' label={`${usedTools.length} tool(s)`} />}
                    {sourceDocuments.length > 0 && (
                        <Chip size='small' variant='outlined' color='primary' label={`${sourceDocuments.length} source(s)`} />
                    )}

                    <Tooltip title={copied ? 'Copied' : 'Copy'}>
                        <IconButton size='small' onClick={handleCopy} aria-label='copy message'>
                            {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                        </IconButton>
                    </Tooltip>
                    {isUser && (
                        <Tooltip title='Retry the same request with the same workflow'>
                            <IconButton size='small' onClick={() => onRetry && onRetry(message)} aria-label='retry request'>
                                <IconRefresh size={15} />
                            </IconButton>
                        </Tooltip>
                    )}
                    {isUser && (
                        <Tooltip title='Retry as a new conversational branch (new session)'>
                            <IconButton
                                size='small'
                                onClick={() => onRetryAsBranch && onRetryAsBranch(message)}
                                aria-label='retry in new branch'
                            >
                                <IconGitBranch size={15} />
                            </IconButton>
                        </Tooltip>
                    )}
                    {isExecuting && (
                        <Tooltip title='Stop this execution'>
                            <IconButton size='small' color='error' onClick={onStop} aria-label='stop execution'>
                                <IconPlayerStop size={15} />
                            </IconButton>
                        </Tooltip>
                    )}
                </Stack>
            </Box>
            {isUser && <Avatar sx={{ width: 30, height: 30, bgcolor: theme.palette.grey[600], fontSize: 12 }}>You</Avatar>}
        </Stack>
    )
}

ConversationMessage.propTypes = {
    message: PropTypes.object,
    isExecuting: PropTypes.bool,
    onRetry: PropTypes.func,
    onRetryAsBranch: PropTypes.func,
    onStop: PropTypes.func
}

export default ConversationMessage
