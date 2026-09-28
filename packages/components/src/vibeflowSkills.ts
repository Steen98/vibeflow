import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'

/**
 * VibeFlow Skills registry.
 *
 * A skill is a folder (imported from a `.zip` or `.skill` archive) that contains a
 * `SKILL.md` file with a front-matter header:
 *
 *   ---
 *   name: my-skill
 *   description: What the skill does and when to use it
 *   version: 1.0.0
 *   ---
 *   # Instructions
 *   ...
 *
 * Skills are stored on disk (no database migration needed), indexed in `index.json`,
 * so they can be enabled/disabled, imported and deleted independently of Flowise entities.
 *
 * Archives are read with the built-in `zlib` module: no new runtime dependency is required.
 */

export const SKILL_MANIFEST_FILENAME = 'SKILL.md'
export const VIBEFLOW_SKILLS_PATH_ENV = 'VIBEFLOW_SKILLS_PATH'

export interface IVibeFlowSkill {
    id: string
    name: string
    description: string
    version: string
    enabled: boolean
    source: string
    directory: string
    files: number
    importedAt: string
    updatedAt: string
}

interface ISkillsIndex {
    skills: Record<string, IVibeFlowSkill>
}

export const getSkillsRoot = (): string => {
    const configured = process.env[VIBEFLOW_SKILLS_PATH_ENV]
    if (configured && configured.trim().length) return path.resolve(configured.trim())
    const storageRoot = process.env.BLOB_STORAGE_PATH || path.join(os.homedir(), '.flowise')
    return path.join(path.resolve(storageRoot), 'vibeflow-skills')
}

const getIndexPath = (): string => path.join(getSkillsRoot(), 'index.json')

const readIndex = (): ISkillsIndex => {
    const indexPath = getIndexPath()
    if (!existsSync(indexPath)) return { skills: {} }
    try {
        const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as ISkillsIndex
        return parsed && parsed.skills ? parsed : { skills: {} }
    } catch {
        return { skills: {} }
    }
}

const writeIndex = (index: ISkillsIndex): void => {
    const root = getSkillsRoot()
    mkdirSync(root, { recursive: true })
    writeFileSync(getIndexPath(), JSON.stringify(index, null, 2), 'utf8')
}

export const listSkills = (): IVibeFlowSkill[] => {
    const index = readIndex()
    return Object.values(index.skills)
        .map((skill) => ({ ...skill }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

export const getSkill = (id: string): IVibeFlowSkill | undefined => {
    return readIndex().skills[id]
}

export const setSkillEnabled = (id: string, enabled: boolean): IVibeFlowSkill => {
    const index = readIndex()
    const skill = index.skills[id]
    if (!skill) throw new Error(`Skill "${id}" not found`)
    skill.enabled = enabled
    skill.updatedAt = new Date().toISOString()
    writeIndex(index)
    return skill
}

export const deleteSkill = (id: string): { id: string; deleted: boolean } => {
    const index = readIndex()
    const skill = index.skills[id]
    if (!skill) return { id, deleted: false }
    const directory = path.resolve(skill.directory)
    const root = path.resolve(getSkillsRoot())
    const relative = path.relative(root, directory)
    if (relative.length && !relative.startsWith('..') && !path.isAbsolute(relative) && existsSync(directory)) {
        rmSync(directory, { recursive: true, force: true })
    }
    delete index.skills[id]
    writeIndex(index)
    return { id, deleted: true }
}

export const slugify = (value: string, fallback = 'skill'): string => {
    const slug = (value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return slug.length ? slug : fallback
}

/** Reject absolute paths and any `..` traversal coming from an archive entry. */
const safeArchivePath = (entryName: string): string => {
    const normalized = entryName.replace(/\\/g, '/').replace(/^\/+/, '')
    if (normalized.split('/').includes('..')) throw new Error(`Unsafe path in archive: ${entryName}`)
    return normalized
}

export interface IZipEntry {
    name: string
    content: Buffer
}

/**
 * Minimal ZIP reader (stored + deflate entries). Zip64 archives are explicitly rejected
 * instead of being silently mis-read.
 */
export const readZipEntries = (archive: Buffer): IZipEntry[] => {
    const EOCD_SIGNATURE = 0x06054b50
    let eocdOffset = -1
    for (let offset = archive.length - 22; offset >= 0 && offset >= archive.length - 22 - 65535; offset--) {
        if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
            eocdOffset = offset
            break
        }
    }
    if (eocdOffset < 0) throw new Error('Invalid archive: end of central directory not found')

    const entryCount = archive.readUInt16LE(eocdOffset + 10)
    const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16)
    if (centralDirectoryOffset === 0xffffffff || entryCount === 0xffff) {
        throw new Error('Zip64 archives are not supported, please re-create the archive without zip64')
    }

    const entries: IZipEntry[] = []
    let cursor = centralDirectoryOffset

    for (let index = 0; index < entryCount; index++) {
        if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid archive: bad central directory entry')
        const compressionMethod = archive.readUInt16LE(cursor + 10)
        const compressedSize = archive.readUInt32LE(cursor + 20)
        const uncompressedSize = archive.readUInt32LE(cursor + 24)
        const fileNameLength = archive.readUInt16LE(cursor + 28)
        const extraFieldLength = archive.readUInt16LE(cursor + 30)
        const commentLength = archive.readUInt16LE(cursor + 32)
        const localHeaderOffset = archive.readUInt32LE(cursor + 42)
        const fileName = archive.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8')
        cursor += 46 + fileNameLength + extraFieldLength + commentLength

        if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
            throw new Error('Zip64 archives are not supported, please re-create the archive without zip64')
        }
        if (fileName.endsWith('/')) continue // directory entry

        if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error('Invalid archive: bad local header')
        const localNameLength = archive.readUInt16LE(localHeaderOffset + 26)
        const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28)
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
        const rawData = archive.subarray(dataStart, dataStart + compressedSize)

        let content: Buffer
        if (compressionMethod === 0) content = Buffer.from(rawData)
        else if (compressionMethod === 8) content = zlib.inflateRawSync(rawData)
        else throw new Error(`Unsupported compression method ${compressionMethod} for entry ${fileName}`)

        entries.push({ name: safeArchivePath(fileName), content })
    }

    return entries
}

export interface ISkillManifest {
    name: string
    description: string
    version: string
    body: string
    raw: string
}

/**
 * Parse a SKILL.md file: optional YAML front-matter (`key: value` lines) + Markdown body.
 */
export const parseSkillManifest = (content: string, fallbackName = 'skill'): ISkillManifest => {
    const normalized = (content || '').replace(/\r\n/g, '\n')
    const manifest: Record<string, string> = {}
    let body = normalized

    if (normalized.startsWith('---')) {
        const end = normalized.indexOf('\n---', 3)
        if (end > 0) {
            const frontMatter = normalized.slice(3, end)
            body = normalized.slice(end + 4).replace(/^\n+/, '')
            for (const line of frontMatter.split('\n')) {
                const separator = line.indexOf(':')
                if (separator <= 0) continue
                const key = line.slice(0, separator).trim().toLowerCase()
                let value = line.slice(separator + 1).trim()
                value = value.replace(/^["']|["']$/g, '')
                if (key.length) manifest[key] = value
            }
        }
    }

    const titleMatch = body.match(/^#\s+(.+)$/m)
    const name = manifest.name || titleMatch?.[1]?.trim() || fallbackName
    const description = manifest.description || ''

    return {
        name,
        description,
        version: manifest.version || '1.0.0',
        body,
        raw: normalized
    }
}

export interface IImportSkillOptions {
    fileName?: string
    id?: string
}

/**
 * Import a `.zip` / `.skill` archive (or a raw SKILL.md buffer) into the registry.
 * The archive must contain a SKILL.md file (at the root or inside a single top-level folder).
 */
export const importSkillFromArchive = (archive: Buffer, options: IImportSkillOptions = {}): IVibeFlowSkill => {
    const fileName = options.fileName || ''
    const lowerName = fileName.toLowerCase()

    let entries: IZipEntry[]
    if (lowerName.endsWith('.md')) {
        entries = [{ name: SKILL_MANIFEST_FILENAME, content: Buffer.from(archive) }]
    } else {
        entries = readZipEntries(archive)
    }

    if (!entries.length) throw new Error('The archive is empty')

    const manifestEntry =
        entries.find((entry) => entry.name.toLowerCase() === SKILL_MANIFEST_FILENAME.toLowerCase()) ||
        entries.find((entry) => entry.name.toLowerCase().endsWith(`/${SKILL_MANIFEST_FILENAME.toLowerCase()}`))

    if (!manifestEntry) {
        throw new Error(`The archive must contain a ${SKILL_MANIFEST_FILENAME} file at its root`)
    }

    const topLevelFolder = manifestEntry.name.includes('/') ? manifestEntry.name.split('/')[0] : ''
    const manifest = parseSkillManifest(manifestEntry.content.toString('utf8'), options.id || path.parse(fileName).name || 'skill')

    const baseSlug = slugify(options.id || manifest.name, 'skill')
    const index = readIndex()
    let id = baseSlug
    let suffix = 2
    while (index.skills[id]) {
        const existing = index.skills[id]
        if (existing.name !== manifest.name) {
            id = `${baseSlug}-${suffix++}`
            continue
        }
        break
    }

    const directory = path.join(getSkillsRoot(), id)
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })

    let fileCount = 0
    for (const entry of entries) {
        const relativeName =
            topLevelFolder && entry.name.startsWith(`${topLevelFolder}/`) ? entry.name.slice(topLevelFolder.length + 1) : entry.name
        if (!relativeName.length || relativeName.endsWith('/')) continue
        const target = path.join(directory, safeArchivePath(relativeName))
        const root = path.resolve(directory)
        const resolvedTarget = path.resolve(target)
        const relative = path.relative(root, resolvedTarget)
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe path in archive: ${entry.name}`)
        mkdirSync(path.dirname(resolvedTarget), { recursive: true })
        writeFileSync(resolvedTarget, entry.content)
        fileCount += 1
    }

    const now = new Date().toISOString()
    const skill: IVibeFlowSkill = {
        id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        enabled: true,
        source: fileName || 'archive',
        directory,
        files: fileCount,
        importedAt: index.skills[id]?.importedAt || now,
        updatedAt: now
    }

    index.skills[id] = skill
    writeIndex(index)

    return skill
}

/** Raw SKILL.md content of a skill, used to inject the instructions into a prompt. */
export const getSkillInstructions = (id: string): string => {
    const skill = getSkill(id)
    if (!skill) return ''
    const manifestPath = path.join(skill.directory, SKILL_MANIFEST_FILENAME)
    if (!existsSync(manifestPath)) return ''
    const parsed = parseSkillManifest(readFileSync(manifestPath, 'utf8'), skill.name)
    return parsed.body.trim()
}

export const getSkillsPrompt = (ids: string[]): string => {
    const sections: string[] = []
    for (const id of ids || []) {
        const skill = getSkill(id)
        if (!skill || !skill.enabled) continue
        const instructions = getSkillInstructions(id)
        if (!instructions.length) continue
        sections.push(`## Skill: ${skill.name}\n${skill.description ? `${skill.description}\n` : ''}${instructions}`)
    }
    if (!sections.length) return ''
    return `You have the following skills available. Follow their instructions when relevant:\n\n${sections.join('\n\n')}`
}

export const getSkillsStats = (): { total: number; enabled: number; sizeBytes: number; root: string } => {
    const root = getSkillsRoot()
    const skills = listSkills()
    let totalSize = 0
    for (const skill of skills) {
        try {
            totalSize += statSync(skill.directory).size
        } catch {
            /* ignored */
        }
    }
    return { total: skills.length, enabled: skills.filter((skill) => skill.enabled).length, sizeBytes: totalSize, root }
}

/** Ensure the registry directory exists (called at import time and by the API). */
export const ensureSkillsRoot = (): string => {
    const root = getSkillsRoot()
    mkdirSync(root, { recursive: true })
    const indexPath = getIndexPath()
    if (!existsSync(indexPath)) writeIndex({ skills: {} })
    return root
}

export const listSkillDirectories = (): string[] => {
    const root = getSkillsRoot()
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
}
