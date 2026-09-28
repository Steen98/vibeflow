import { baseURL } from '@/store/constant'

/**
 * SSE reader for the ChatBot streaming endpoint.
 *
 * Flowise writes frames as `message:\ndata:{...}\n\n`, so every frame is parsed and forwarded
 * to the caller. Progressively received `token` events drive the progressive rendering;
 * `vibeflowChatBotDone` carries the persisted messages (user + assistant + execution).
 */
export const streamChatBotExecute = async ({ sessionId, body, onEvent, signal }) => {
    const response = await fetch(`${baseURL}/api/v1/vibeflow-chatbot/sessions/${sessionId}/execute/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-from': 'internal' },
        credentials: 'include',
        body: JSON.stringify(body),
        signal
    })

    if (!response.ok || !response.body) {
        const raw = await response.text().catch(() => '')
        let message = `Streaming execution failed (HTTP ${response.status})`
        try {
            const parsed = JSON.parse(raw)
            if (parsed?.message) message = parsed.message
        } catch {
            if (raw) message = raw
        }
        throw new Error(message)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''
        for (const frame of frames) {
            const dataLine = frame.split('\n').find((line) => line.startsWith('data:'))
            if (!dataLine) continue
            const raw = dataLine.slice(5).trim()
            if (!raw || raw === '[DONE]') continue
            try {
                onEvent(JSON.parse(raw))
            } catch {
                /* keep-alive or non JSON frame */
            }
        }
    }
}
