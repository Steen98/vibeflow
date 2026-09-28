/**
 * VibeFlow module & network policy.
 *
 * VibeFlow runs Flowise with the module restrictions lifted by default: AI agents,
 * Custom Tools and Custom Functions can `require()` any Node.js built-in module
 * (including `fs`, `child_process`, `os`, `process`, `worker_threads`, ...) as well as
 * any external package installed in the project, and outbound HTTP requests are not
 * filtered by the default IP deny list.
 *
 * The upstream Flowise hardening can be restored at any time, without touching the code,
 * by setting:
 *   VIBEFLOW_UNRESTRICTED_MODULES=false
 *   VIBEFLOW_UNRESTRICTED_NETWORK=false
 */

/**
 * Complete list of Node.js built-in modules exposed to sandboxed code when the module
 * restrictions are lifted (replaces `defaultAllowBuiltInDep`, which intentionally omits
 * fs / child_process / os / process / cluster / worker_threads).
 */
export const VIBEFLOW_BUILTIN_MODULES: string[] = [
    'assert',
    'assert/strict',
    'async_hooks',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'diagnostics_channel',
    'dns',
    'dns/promises',
    'domain',
    'events',
    'fs',
    'fs/promises',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'path/posix',
    'path/win32',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'stream/promises',
    'string_decoder',
    'sys',
    'timers',
    'timers/promises',
    'tls',
    'trace_events',
    'tty',
    'url',
    'util',
    'util/types',
    'v8',
    'vm',
    'wasi',
    'worker_threads',
    'zlib'
]

/**
 * Whether sandboxed code may import any module (built-in and external).
 * Enabled by default; set VIBEFLOW_UNRESTRICTED_MODULES=false to restore upstream Flowise behaviour.
 */
export const isUnrestrictedModules = (): boolean => process.env.VIBEFLOW_UNRESTRICTED_MODULES !== 'false'

/**
 * Whether outbound HTTP requests bypass the IP deny list (loopback / private ranges / IMDS).
 * Enabled by default; set VIBEFLOW_UNRESTRICTED_NETWORK=false to restore upstream Flowise behaviour.
 */
export const isUnrestrictedNetwork = (): boolean => process.env.VIBEFLOW_UNRESTRICTED_NETWORK !== 'false'
