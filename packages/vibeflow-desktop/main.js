const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')
const net = require('net')

/**
 * VibeFlow desktop shell.
 *
 * The Flowise-compatible server is started as a child process from the VibeFlow repository
 * (packages/server), then the UI is loaded from it. The monorepo is deliberately not bundled:
 * it keeps using the same database, storage and .env configuration as the web version.
 *
 * Because of that, the installed application must be able to locate the repository. The lookup
 * order is:
 *   1. the VIBEFLOW_REPO_ROOT environment variable;
 *   2. a `vibeflow-repo-path.txt` file in the Electron userData directory (one line: the path);
 *   3. a `vibeflow-repo` folder next to the executable, or in the packaged resources directory;
 *   4. walking up from the executable, then from this file, looking for packages/server/package.json;
 *   5. in development, the parent of this package.
 */

const DEFAULT_PORT = process.env.VIBEFLOW_DESKTOP_PORT ? Number(process.env.VIBEFLOW_DESKTOP_PORT) : 3000
const REPO_MARKER = path.join('packages', 'server', 'package.json')
const REPO_SERVER_ENTRY = path.join('packages', 'server', 'dist', 'index.js')

let serverProcess = null
let mainWindow = null

const findFreePort = (startPort) =>
    new Promise((resolve) => {
        const server = net.createServer()
        server.once('error', () => resolve(findFreePort(startPort + 1)))
        server.once('listening', () => {
            server.close(() => resolve(startPort))
        })
        server.listen(startPort, '127.0.0.1')
    })

const waitForServer = (port, timeoutMs = 180000) =>
    new Promise((resolve, reject) => {
        const startedAt = Date.now()
        const attempt = () => {
            const request = http.get({ host: '127.0.0.1', port, path: '/api/v1/version', timeout: 3000 }, (response) => {
                response.resume()
                resolve(true)
            })
            request.on('error', () => {
                if (Date.now() - startedAt > timeoutMs) {
                    reject(new Error(`The VibeFlow server did not answer on port ${port} within ${timeoutMs / 1000}s`))
                    return
                }
                setTimeout(attempt, 1500)
            })
            request.on('timeout', () => {
                request.destroy()
            })
        }
        attempt()
    })

const isRepoRoot = (candidate) => {
    if (!candidate) return false
    try {
        return fs.existsSync(path.join(candidate, REPO_MARKER))
    } catch {
        return false
    }
}

const walkUp = (startDir, maxDepth = 8) => {
    let current = startDir
    for (let depth = 0; depth <= maxDepth; depth += 1) {
        if (isRepoRoot(current)) return current
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
    }
    return null
}

const readConfiguredRepoRoot = () => {
    try {
        const configFile = path.join(app.getPath('userData'), 'vibeflow-repo-path.txt')
        if (!fs.existsSync(configFile)) return null
        const value = fs.readFileSync(configFile, 'utf8').split(/\r?\n/)[0].trim()
        if (!value) return null
        return isRepoRoot(value) ? value : null
    } catch {
        return null
    }
}

const searchRepoRoot = () => {
    const searched = []
    const consider = (candidate, label) => {
        if (!candidate) return null
        searched.push(`${label}: ${candidate}`)
        return isRepoRoot(candidate) ? candidate : null
    }

    let found = consider(process.env.VIBEFLOW_REPO_ROOT, 'VIBEFLOW_REPO_ROOT')
    if (found) return { repoRoot: found, searched }

    found = readConfiguredRepoRoot()
    if (found) return { repoRoot: found, searched }

    const execDir = path.dirname(process.execPath)
    found = consider(path.join(execDir, 'vibeflow-repo'), 'vibeflow-repo next to the executable')
    if (found) return { repoRoot: found, searched }

    if (process.resourcesPath) {
        found = consider(path.join(process.resourcesPath, 'vibeflow-repo'), 'vibeflow-repo in resources')
        if (found) return { repoRoot: found, searched }
    }

    found = walkUp(execDir)
    if (found) return { repoRoot: found, searched }

    found = walkUp(__dirname, 4)
    if (found) return { repoRoot: found, searched }

    return { repoRoot: null, searched }
}

const resolveServerCommand = () => {
    const { repoRoot, searched } = searchRepoRoot()
    if (!repoRoot) {
        const error = new Error('The VibeFlow repository could not be located.')
        error.searched = searched
        throw error
    }
    const serverDir = path.join(repoRoot, 'packages', 'server')
    if (!fs.existsSync(path.join(repoRoot, REPO_SERVER_ENTRY)) || !fs.existsSync(path.join(repoRoot, 'node_modules'))) {
        const error = new Error(
            `The VibeFlow repository at "${repoRoot}" is not built or its dependencies are missing.\n\n` +
                'Run "pnpm install" then "pnpm build" at the repository root, then start VibeFlow again.'
        )
        error.searched = searched
        throw error
    }
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    return { repoRoot, serverDir, command: pnpm, args: ['start'], searched }
}

const startServer = async (port) => {
    const { repoRoot, command, args } = resolveServerCommand()
    const logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, 'vibeflow-server.log')
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    logStream.write(`\n[desktop] starting "${command} ${args.join(' ')}" in ${repoRoot}\n`)

    serverProcess = spawn(command, args, {
        cwd: repoRoot,
        env: { ...process.env, PORT: String(port), VIBEFLOW_DESKTOP: 'true' },
        shell: process.platform === 'win32',
        windowsHide: true
    })

    if (serverProcess.stdout) serverProcess.stdout.pipe(logStream)
    if (serverProcess.stderr) serverProcess.stderr.pipe(logStream)
    serverProcess.on('error', (error) => {
        logStream.write(`\n[desktop] failed to start the server: ${error.message}\n`)
    })
    serverProcess.on('exit', (code) => {
        logStream.write(`\n[desktop] server process exited with code ${code}\n`)
    })

    return await waitForServer(port)
}

const createWindow = async (port) => {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 950,
        minWidth: 1024,
        minHeight: 700,
        title: 'VibeFlow',
        backgroundColor: '#121212',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    })

    mainWindow.setMenuBarVisibility(true)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })

    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
    if (serverProcess && !serverProcess.killed) {
        try {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F'])
            } else {
                process.kill(-serverProcess.pid)
            }
        } catch {
            serverProcess.kill()
        }
    }
})

app.whenReady().then(async () => {
    try {
        const port = await findFreePort(DEFAULT_PORT)
        await startServer(port)
        await createWindow(port)
    } catch (error) {
        const details = error.searched && error.searched.length ? `\n\nSearched locations:\n- ${error.searched.join('\n- ')}` : ''
        const hint =
            '\n\nTo point VibeFlow at the repository, either set the VIBEFLOW_REPO_ROOT environment variable, ' +
            'or write the repository path on a single line in:\n' +
            path.join(app.getPath('userData'), 'vibeflow-repo-path.txt')
        dialog.showErrorBox('VibeFlow could not start', `${error.message}${details}${hint}`)
        app.quit()
    }
})
