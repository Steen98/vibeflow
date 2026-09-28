const { app, BrowserWindow, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')
const net = require('net')

/**
 * VibeFlow desktop shell.
 *
 * The Flowise-compatible server is started as a child process (packages/server), then the UI is
 * loaded from it. Nothing is bundled into the Electron binary: the server keeps using the same
 * database, storage and .env configuration as the web version.
 */

const DEFAULT_PORT = process.env.VIBEFLOW_DESKTOP_PORT ? Number(process.env.VIBEFLOW_DESKTOP_PORT) : 3000
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

const resolveServerCommand = () => {
    // The desktop package lives next to the server package inside the repository
    const repoRoot = path.resolve(__dirname, '..', '..')
    const serverDir = path.join(repoRoot, 'packages', 'server')
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    return { repoRoot, serverDir, command: pnpm, args: ['start'] }
}

const startServer = async (port) => {
    const { repoRoot, command, args } = resolveServerCommand()
    const logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    const logStream = fs.createWriteStream(path.join(logDir, 'vibeflow-server.log'), { flags: 'a' })

    serverProcess = spawn(command, args, {
        cwd: repoRoot,
        env: { ...process.env, PORT: String(port), VIBEFLOW_DESKTOP: 'true' },
        shell: process.platform === 'win32',
        windowsHide: true
    })

    serverProcess.stdout.pipe(logStream)
    serverProcess.stderr.pipe(logStream)
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
        dialog.showErrorBox(
            'VibeFlow could not start',
            `${error.message}\n\nMake sure the dependencies are installed (pnpm install) and that the server can start from the repository.`
        )
        app.quit()
    }
})
