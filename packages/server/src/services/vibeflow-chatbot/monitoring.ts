import os from 'os'
import { buildSessionContext, getSession } from 'flowise-components'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

/**
 * VibeFlow AI monitoring.
 *
 * Only real, measured values are returned. When a metric cannot be measured on the host
 * (no provider balance endpoint configured for instance), the metric is reported as
 * unavailable with the reason - never with an invented number.
 */

export interface ICpuMetric {
    usagePercent: number
    cores: number
    model: string
    loadAverage: number[]
}

export interface IMemoryMetric {
    usedPercent: number
    totalBytes: number
    freeBytes: number
    usedBytes: number
}

export interface IProviderBalanceMetric {
    available: boolean
    provider?: string
    balance?: number
    currency?: string
    reason?: string
}

export interface IContextMetric {
    windowMessages: number
    usedMessages: number
    usedPercent: number
    totalMessages: number
}

export interface ILlmContextMetric {
    source: 'workflow' | 'unavailable'
    model?: string
    providerNode?: string
    maxContextTokens?: number
    declaredMaxTokens?: number
    reason?: string
}

export interface IMonitoringSnapshot {
    collectedAt: string
    platform: string
    cpu: ICpuMetric
    memory: IMemoryMetric
    providerBalance: IProviderBalanceMetric
    context?: IContextMetric
    llm?: ILlmContextMetric
}

const sampleCpu = (): Promise<{ idle: number; total: number }> => {
    return new Promise((resolve) => {
        const cpus = os.cpus()
        let idle = 0
        let total = 0
        for (const cpu of cpus) {
            for (const type of Object.keys(cpu.times) as (keyof typeof cpu.times)[]) {
                total += cpu.times[type]
            }
            idle += cpu.times.idle
        }
        resolve({ idle, total })
    })
}

const getCpuMetric = async (): Promise<ICpuMetric> => {
    const cpus = os.cpus()
    const first = await sampleCpu()
    await new Promise((resolve) => setTimeout(resolve, 220))
    const second = await sampleCpu()
    const idleDelta = second.idle - first.idle
    const totalDelta = second.total - first.total
    const usagePercent = totalDelta > 0 ? Math.min(100, Math.max(0, Math.round((1 - idleDelta / totalDelta) * 1000) / 10)) : 0
    return {
        usagePercent,
        cores: cpus.length,
        model: cpus[0]?.model?.trim() || 'unknown',
        loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100)
    }
}

const getMemoryMetric = (): IMemoryMetric => {
    const totalBytes = os.totalmem()
    const freeBytes = os.freemem()
    const usedBytes = totalBytes - freeBytes
    return {
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0
    }
}

/**
 * Provider balance adapters.
 * Each adapter declares how to detect that it is configured; when no adapter matches,
 * the metric is reported as unavailable.
 */
export interface IProviderBalanceAdapter {
    provider: string
    isConfigured: () => boolean
    fetchBalance: () => Promise<{ balance: number; currency: string }>
}

const openRouterAdapter: IProviderBalanceAdapter = {
    provider: 'OpenRouter',
    isConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),
    fetchBalance: async () => {
        const response = await fetch('https://openrouter.ai/api/v1/credits', {
            headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
        })
        if (!response.ok) throw new Error(`OpenRouter responded ${response.status}`)
        const payload: any = await response.json()
        const credits = payload?.data
        const balance = Number(credits?.total_credits ?? 0) - Number(credits?.total_usage ?? 0)
        return { balance, currency: 'USD' }
    }
}

const deepSeekAdapter: IProviderBalanceAdapter = {
    provider: 'DeepSeek',
    isConfigured: () => Boolean(process.env.DEEPSEEK_API_KEY),
    fetchBalance: async () => {
        const response = await fetch('https://api.deepseek.com/user/balance', {
            headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }
        })
        if (!response.ok) throw new Error(`DeepSeek responded ${response.status}`)
        const payload: any = await response.json()
        const info = payload?.balance_infos?.[0]
        if (!info) throw new Error('DeepSeek returned no balance information')
        return { balance: Number(info.total_balance), currency: info.currency || 'USD' }
    }
}

export const providerBalanceAdapters: IProviderBalanceAdapter[] = [openRouterAdapter, deepSeekAdapter]

const getProviderBalanceMetric = async (): Promise<IProviderBalanceMetric> => {
    const configured = providerBalanceAdapters.filter((adapter) => adapter.isConfigured())
    if (!configured.length) {
        return {
            available: false,
            reason: 'No provider balance endpoint configured (supported: OpenRouter, DeepSeek through their API keys).'
        }
    }
    for (const adapter of configured) {
        try {
            const { balance, currency } = await adapter.fetchBalance()
            return { available: true, provider: adapter.provider, balance, currency }
        } catch (error) {
            return {
                available: false,
                provider: adapter.provider,
                reason: error instanceof Error ? error.message : 'Provider balance request failed'
            }
        }
    }
    return { available: false, reason: 'No provider balance available' }
}

const getContextMetric = (sessionId?: string): IContextMetric | undefined => {
    if (!sessionId) return undefined
    try {
        const context = buildSessionContext(sessionId)
        const windowMessages = context.strategy.maxPreviousMessages
        const totalMessages = context.messages.length
        return {
            windowMessages,
            usedMessages: totalMessages,
            usedPercent: windowMessages > 0 ? Math.round((totalMessages / windowMessages) * 1000) / 10 : 0,
            totalMessages: context.totalMessages
        }
    } catch {
        return undefined
    }
}

/**
 * Maximum context supported: read from the workflow itself.
 * The value is only reported when the workflow really declares it; otherwise the reason is
 * returned instead of an estimation.
 */
const getWorkflowModelInfo = async (workflowId?: string): Promise<ILlmContextMetric> => {
    if (!workflowId) return { source: 'unavailable', reason: 'No workflow bound to this session' }
    try {
        const appServer = getRunningExpressApp()
        const flow = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({ id: workflowId })
        if (!flow) return { source: 'unavailable', reason: 'Workflow not found' }

        const flowData = typeof (flow as any).flowData === 'string' ? JSON.parse((flow as any).flowData) : (flow as any).flowData
        const nodes = flowData?.nodes || []
        const modelNode = nodes.find((node: any) => node?.data?.category === 'Chat Models')
        if (!modelNode) return { source: 'unavailable', reason: 'This workflow does not expose a Chat Models node' }

        const inputs = modelNode.data.inputs || {}
        const model = inputs.modelName || inputs.model
        const declaredMaxTokens = Number(inputs.maxTokens) || undefined
        const declaredContextWindow = Number(inputs.maxContextTokens ?? inputs.contextWindow ?? inputs.contextLength) || undefined
        if (!declaredContextWindow) {
            return {
                source: 'workflow',
                model,
                providerNode: modelNode.data.name,
                declaredMaxTokens,
                reason: 'The workflow does not declare a context window size'
            }
        }
        return {
            source: 'workflow',
            model,
            providerNode: modelNode.data.name,
            declaredMaxTokens,
            maxContextTokens: declaredContextWindow
        }
    } catch (error) {
        return { source: 'unavailable', reason: error instanceof Error ? error.message : 'Unable to read the workflow model' }
    }
}

export const collectMonitoring = async (sessionId?: string): Promise<IMonitoringSnapshot> => {
    const [cpu, providerBalance] = await Promise.all([getCpuMetric(), getProviderBalanceMetric()])
    const session = sessionId ? getSession(sessionId) : undefined
    const llm = await getWorkflowModelInfo(session?.defaultWorkflowId)
    return {
        collectedAt: new Date().toISOString(),
        platform: `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
        cpu,
        memory: getMemoryMetric(),
        providerBalance,
        context: getContextMetric(sessionId),
        llm
    }
}
