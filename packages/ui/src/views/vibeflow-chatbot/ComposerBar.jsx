import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'

// material-ui
import { Box, Chip, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

// project imports
import vibeflowChatBotApi from '@/api/vibeflowChatBot'

// icons
import { IconMicrophone, IconPaperclip, IconPlayerStop, IconSend, IconTrash } from '@tabler/icons-react'

const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const readFileAsBase64 = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (event) => {
            const result = event.target.result || ''
            resolve(typeof result === 'string' ? result.split(',')[1] : '')
        }
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}`))
        reader.readAsDataURL(file)
    })

/**
 * Input zone of the ChatBot: text, attachments, voice recorder and send / stop.
 * Attachments and recorder are only enabled when their backend is really available.
 */
const ComposerBar = ({
    value,
    onChange,
    onSend,
    onStop,
    sending,
    attachments,
    onAttachmentsChange,
    maxFileSizeBytes,
    speechToText,
    workflowSelected,
    sessionId,
    workflowId,
    onNotice,
    onTranscript
}) => {
    const theme = useTheme()
    const fileInputRef = useRef(null)

    const [recording, setRecording] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [recorderError, setRecorderError] = useState('')
    const mediaRecorderRef = useRef(null)
    const chunksRef = useRef([])
    const timeoutRef = useRef(null)

    useEffect(
        () => () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
            try {
                mediaRecorderRef.current?.stop()
            } catch {
                /* ignored */
            }
        },
        []
    )

    const handleFiles = async (event) => {
        const files = Array.from(event.target.files || [])
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (!files.length) return

        const limit = maxFileSizeBytes || 50 * 1024 * 1024
        const accepted = []
        for (const file of files) {
            if (file.size > limit) {
                onNotice({ severity: 'error', text: `"${file.name}" exceeds the ${Math.round(limit / (1024 * 1024))} MB limit` })
                continue
            }
            try {
                const data = await readFileAsBase64(file)
                accepted.push({ name: file.name, type: file.type || 'application/octet-stream', mime: file.type, size: file.size, data })
            } catch (error) {
                onNotice({ severity: 'error', text: error.message })
            }
        }
        if (accepted.length) onAttachmentsChange([...(attachments || []), ...accepted])
    }

    const startRecording = async () => {
        setRecorderError('')
        if (!speechToText?.available) {
            onNotice({ severity: 'warning', text: speechToText?.reason || 'No speech-to-text engine configured' })
            return
        }
        if (!sessionId) {
            onNotice({ severity: 'warning', text: 'Create a session before recording a request' })
            return
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const recorder = new MediaRecorder(stream)
            chunksRef.current = []
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
            }
            recorder.onstop = async () => {
                stream.getTracks().forEach((track) => track.stop())
                const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
                if (!blob.size) {
                    setRecorderError('Empty recording')
                    return
                }
                setTranscribing(true)
                try {
                    const dataUrl = await readFileAsBase64(new File([blob], 'recording.webm', { type: blob.type }))
                    const response = await vibeflowChatBotApi.transcribe(sessionId, {
                        audioBase64: dataUrl,
                        mime: blob.type || 'audio/webm',
                        fileName: `vibeflow-recording-${Date.now()}.webm`,
                        workflowId
                    })
                    const text = response.data?.data?.text || ''
                    if (!text.length) {
                        setRecorderError('The transcription came back empty')
                    } else if (onTranscript) {
                        onTranscript(text, response.data.data)
                    }
                } catch (error) {
                    setRecorderError(error?.response?.data?.message || error.message || 'Transcription failed')
                } finally {
                    setTranscribing(false)
                }
            }
            mediaRecorderRef.current = recorder
            recorder.start()
            setRecording(true)
            // Safety timeout: never leave the microphone open indefinitely
            timeoutRef.current = setTimeout(() => {
                try {
                    recorder.stop()
                } catch {
                    /* ignored */
                }
                setRecording(false)
            }, 120000)
        } catch (error) {
            const message =
                error?.name === 'NotAllowedError'
                    ? 'Microphone permission denied'
                    : error?.name === 'NotFoundError'
                    ? 'No microphone available'
                    : error.message || 'Unable to access the microphone'
            setRecorderError(message)
            onNotice({ severity: 'error', text: message })
        }
    }

    const stopRecording = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        try {
            mediaRecorderRef.current?.stop()
        } catch {
            /* ignored */
        }
        setRecording(false)
    }

    const recorderDisabled = !speechToText?.available || transcribing || !sessionId

    return (
        <Box sx={{ px: { xs: 2, md: 3 }, pt: 1.5, pb: 1.25, borderTop: 1, borderColor: 'divider' }}>
            <Box sx={{ maxWidth: 920, mx: 'auto' }}>
                {attachments && attachments.length > 0 && (
                    <Stack flexDirection='row' sx={{ gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
                        {attachments.map((attachment, index) => (
                            <Chip
                                key={`${attachment.name}-${index}`}
                                size='small'
                                variant='outlined'
                                label={`${attachment.name} · ${formatSize(attachment.size)}`}
                                onDelete={() => onAttachmentsChange(attachments.filter((_, position) => position !== index))}
                                deleteIcon={<IconTrash size={14} />}
                            />
                        ))}
                    </Stack>
                )}

                {recorderError && (
                    <Typography variant='caption' color='error'>
                        {recorderError}
                    </Typography>
                )}

                <Stack flexDirection='row' sx={{ gap: 1, alignItems: 'flex-end' }}>
                    <TextField
                        multiline
                        minRows={1}
                        maxRows={10}
                        fullWidth
                        size='small'
                        placeholder={recording ? 'Recording… press the microphone again to stop' : 'Write your request…'}
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                onSend()
                            }
                        }}
                        disabled={sending}
                        inputProps={{ 'aria-label': 'Your request' }}
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
                    />

                    <input ref={fileInputRef} type='file' multiple hidden onChange={handleFiles} />
                    <Tooltip title='Attachments'>
                        <span>
                            <IconButton
                                onClick={() => fileInputRef.current?.click()}
                                disabled={sending}
                                aria-label='add attachments'
                                sx={{ p: 1.15 }}
                            >
                                <IconPaperclip size={18} />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <Tooltip
                        title={speechToText?.available ? 'Record a voice request' : speechToText?.reason || 'Speech-to-text unavailable'}
                    >
                        <span>
                            <IconButton
                                onClick={recording ? stopRecording : startRecording}
                                disabled={recorderDisabled && !recording}
                                color={recording ? 'error' : 'default'}
                                aria-label={recording ? 'stop recording' : 'record a voice request'}
                                sx={{ p: 1.15 }}
                            >
                                {transcribing ? <CircularProgress size={16} /> : <IconMicrophone size={18} />}
                            </IconButton>
                        </span>
                    </Tooltip>

                    {sending ? (
                        <Tooltip title='Stop'>
                            <IconButton
                                color='error'
                                onClick={onStop}
                                sx={{ bgcolor: alpha(theme.palette.error.main, 0.12), borderRadius: 2, p: 1.2 }}
                            >
                                <IconPlayerStop size={18} />
                            </IconButton>
                        </Tooltip>
                    ) : (
                        <Tooltip title={workflowSelected ? 'Send' : 'Select a workflow first'}>
                            <span>
                                <IconButton
                                    color='primary'
                                    onClick={onSend}
                                    disabled={!value.trim().length || !workflowSelected}
                                    sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12), borderRadius: 2, p: 1.2 }}
                                >
                                    <IconSend size={18} />
                                </IconButton>
                            </span>
                        </Tooltip>
                    )}
                </Stack>

                <Stack
                    flexDirection='row'
                    sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 0.75, flexWrap: 'wrap' }}
                >
                    <Typography variant='caption' color='text.secondary'>
                        Enter to send · Shift+Enter for a new line
                    </Typography>
                    <Typography variant='caption' color='text.secondary'>
                        {recording
                            ? 'Recording…'
                            : transcribing
                            ? 'Transcribing…'
                            : workflowSelected
                            ? 'Ready to send'
                            : 'Select a workflow to enable sending'}
                    </Typography>
                </Stack>
            </Box>
        </Box>
    )
}

ComposerBar.propTypes = {
    value: PropTypes.string,
    onChange: PropTypes.func,
    onSend: PropTypes.func,
    onStop: PropTypes.func,
    sending: PropTypes.bool,
    attachments: PropTypes.array,
    onAttachmentsChange: PropTypes.func,
    maxFileSizeBytes: PropTypes.number,
    speechToText: PropTypes.object,
    workflowSelected: PropTypes.bool,
    sessionId: PropTypes.string,
    workflowId: PropTypes.string,
    onNotice: PropTypes.func,
    onTranscript: PropTypes.func
}

export default ComposerBar
