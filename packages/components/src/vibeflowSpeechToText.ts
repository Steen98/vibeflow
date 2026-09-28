import { ICommonObject, IFileUpload } from './Interface'
import { addSingleFileToStorage } from './storageUtils'
import { convertSpeechToText } from './speechToText'

/**
 * VibeFlow Speech-to-Text adapters.
 *
 * The recorder is only advertised as available when an engine is really usable:
 *  - the workflow's own Speech-to-Text configuration (any of the Flowise engines:
 *    OpenAI Whisper, AssemblyAI, LocalAI, Azure, Groq), or
 *  - a server level engine configured through environment variables.
 *
 * Nothing is ever reported as available "by default": capabilities carry the reason.
 */

export const VIBEFLOW_STT_ENGINE_ENV = 'VIBEFLOW_STT_ENGINE'
export const VIBEFLOW_STT_LOCAL_URL_ENV = 'VIBEFLOW_STT_LOCAL_URL'

export interface ISpeechToTextEngineCapability {
    name: string
    label: string
    available: boolean
    reason?: string
}

export interface ISpeechToTextCapabilities {
    available: boolean
    source: 'workflow' | 'server' | null
    engines: ISpeechToTextEngineCapability[]
    reason?: string
}

export interface ITranscriptionResult {
    text: string
    engine: string
    language?: string
}

const ENGINE_LABELS: Record<string, string> = {
    openAIWhisper: 'OpenAI Whisper',
    assemblyAiTranscribe: 'AssemblyAI',
    localAISTT: 'LocalAI (self-hosted Whisper)',
    azureCognitive: 'Azure Cognitive Services',
    groqWhisper: 'Groq Whisper'
}

/**
 * Parse the workflow `speechToText` column: `{ "<engine>": { credentialId, language, ... } }`.
 */
export const parseWorkflowSpeechToText = (speechToText?: string | null): ICommonObject | null => {
    if (!speechToText || !speechToText.trim().length) return null
    try {
        const providers = JSON.parse(speechToText)
        for (const provider in providers) {
            const providerObj = providers[provider]
            if (providerObj && Object.keys(providerObj).length) {
                return { ...providerObj, name: provider }
            }
        }
        return null
    } catch {
        return null
    }
}

/** Server level engine, configured with environment variables. */
export const getServerSpeechToTextConfig = (): ICommonObject | null => {
    const engine = (process.env[VIBEFLOW_STT_ENGINE_ENV] || '').trim()
    if (!engine.length) return null
    if (engine === 'openAIWhisper' && process.env.OPENAI_API_KEY) return { name: engine, apiKey: process.env.OPENAI_API_KEY }
    if (engine === 'groqWhisper' && process.env.GROQ_API_KEY) return { name: engine, apiKey: process.env.GROQ_API_KEY }
    if (engine === 'assemblyAiTranscribe' && process.env.ASSEMBLYAI_API_KEY) return { name: engine, apiKey: process.env.ASSEMBLYAI_API_KEY }
    if (engine === 'localAISTT' && process.env[VIBEFLOW_STT_LOCAL_URL_ENV]) {
        return { name: engine, baseUrl: process.env[VIBEFLOW_STT_LOCAL_URL_ENV], apiKey: process.env.LOCALAI_API_KEY }
    }
    return null
}

/**
 * Describe what is really available for a given workflow.
 */
export const getSpeechToTextCapabilities = (workflowSpeechToText?: string | null): ISpeechToTextCapabilities => {
    const engines: ISpeechToTextEngineCapability[] = []
    const workflowConfig = parseWorkflowSpeechToText(workflowSpeechToText)

    for (const engine of Object.keys(ENGINE_LABELS)) {
        const configuredOnWorkflow = workflowConfig?.name === engine
        engines.push({
            name: engine,
            label: ENGINE_LABELS[engine],
            available: configuredOnWorkflow,
            reason: configuredOnWorkflow ? undefined : 'Not configured on this workflow'
        })
    }

    const serverConfig = getServerSpeechToTextConfig()
    if (serverConfig) {
        const existing = engines.find((engine) => engine.name === serverConfig.name)
        if (existing) {
            existing.available = true
            existing.reason = undefined
        }
    }

    if (workflowConfig) {
        return { available: true, source: 'workflow', engines }
    }
    if (serverConfig) {
        return { available: true, source: 'server', engines }
    }
    return {
        available: false,
        source: null,
        engines,
        reason:
            `No speech-to-text engine configured. Select a Speech-to-Text provider in the workflow settings, ` +
            `or set ${VIBEFLOW_STT_ENGINE_ENV} (with the matching API key) on the server.`
    }
}

export interface ITranscribeOptions {
    buffer: Buffer
    mime: string
    fileName: string
    chatflowId: string
    chatId: string
    orgId?: string
    language?: string
    options?: ICommonObject
    workflowSpeechToText?: string | null
}

/**
 * Store the recorded audio with the regular Flowise storage helpers, then run the configured
 * engine. The engine is never chosen silently: if none is configured, an explicit error is thrown.
 */
export const transcribeAudio = async (params: ITranscribeOptions): Promise<ITranscriptionResult> => {
    const workflowConfig = parseWorkflowSpeechToText(params.workflowSpeechToText)
    const serverConfig = getServerSpeechToTextConfig()
    const config = workflowConfig || serverConfig

    if (!config) {
        const capabilities = getSpeechToTextCapabilities(params.workflowSpeechToText)
        throw new Error(capabilities.reason || 'No speech-to-text engine configured')
    }

    const fileName = params.fileName || `vibeflow-recording-${Date.now()}.webm`
    await addSingleFileToStorage(params.mime || 'audio/webm', params.buffer, fileName, params.orgId || '', params.chatflowId, params.chatId)

    const upload: IFileUpload = {
        name: fileName,
        type: params.mime || 'audio/webm',
        mime: params.mime || 'audio/webm'
    }

    const configWithLanguage = params.language ? { ...config, language: params.language } : config

    const text = await convertSpeechToText(upload, configWithLanguage, {
        ...(params.options || {}),
        orgId: params.orgId,
        chatflowid: params.chatflowId,
        chatId: params.chatId
    })

    return {
        text: (text || '').trim(),
        engine: String(config.name),
        language: params.language
    }
}
