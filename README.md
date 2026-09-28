<!-- markdownlint-disable MD030 -->

> ## VibeFlow — fork of Flowise
>
> **VibeFlow is an independent fork of [Flowise](https://github.com/FlowiseAI/Flowise) (Apache-2.0).**
> The product name, titles, favicon, UI texts and documentation are VibeFlow; the internal package
> identifiers stay those of Flowise so the fork can keep following upstream.
>
> What this fork adds on top of Flowise:
>
> -   a conversational execution layer, the **ChatBot** (sessions, workspaces bound to a host working
>     directory, attachments, voice input with a Speech-to-Text adapter, SSE streaming, retry/stop,
>     and real AI monitoring: CPU/RAM/GPU, provider balance, context usage);
> -   **hybrid Document Stores**: a vector store _and_ its knowledge graph, created/versioned/deleted
>     together, with an Advanced Document Processing pipeline (fractionator ≤ 3 pages, cleaner,
>     temporary Markdown backups, optional summary), an enriched table and an interactive graph viewer;
> -   a **hybrid retrieval pipeline** (prompt optimisation, axis decomposition, variants, semantic +
>     BM25 + graph retrievers, RRF fusion, reranking, top-K ≤ 50) with a **Test RAG** interface that
>     shows every step and the full provenance chain;
> -   **8 native tools** (READ, WRITE, EDIT, DELETE, LS, GREP, BASH, GIT), **3 native MCP servers**
>     (Serena, Playwright, Chrome DevTools), a dedicated **MCP Servers** section in the Agent node and
>     a **Skills** registry (`.zip` / `.skill` import, `SKILL.md` format).
>
> Module/network restrictions applied to AI agents and Custom Tools are lifted by default
> (`VIBEFLOW_UNRESTRICTED_MODULES`, `VIBEFLOW_UNRESTRICTED_NETWORK`). Set them to `false` to restore
> the upstream hardening, or `VIBEFLOW_UI_PROFILE=upstream` to restore the original sidebar.
>
> ## Desktop builds
>
> The desktop shell lives in `packages/vibeflow-desktop` (Electron + electron-builder). It starts the
> local VibeFlow server as a child process and loads the UI from it, so the database, storage and
> `.env` remain exactly those of the web version.
>
> **Prerequisite for every platform**: the VibeFlow repository must be present with its dependencies
> installed (`pnpm install && pnpm build` at the repository root). The desktop shell deliberately does
> not bundle the monorepo (it would be several GB); it launches the server from the repository so the
> desktop and web versions always share the same data and configuration.
>
> **Windows (installer `.exe`, NSIS) — build on Windows or a Windows CI runner**
>
> ```bash
> cd packages/vibeflow-desktop
> npm install
> npm run dist:win        # -> dist/VibeFlow-Setup-<version>-x64.exe
> ```
>
> The installer lets the user choose the installation directory and creates desktop and start-menu
> shortcuts. A `.exe` cannot be produced from Linux/macOS without Wine, so only the Windows path is
> documented here.
>
> **Linux (`.deb` and `.AppImage`) — build on Linux or a Linux CI runner**
>
> ```bash
> sudo apt-get install -y rpm fakeroot dpkg
> cd packages/vibeflow-desktop
> npm install
> npm run dist:linux      # -> dist/VibeFlow-<version>-x64.AppImage and dist/VibeFlow-<version>-amd64.deb
> chmod +x dist/VibeFlow-*.AppImage && ./dist/VibeFlow-*.AppImage
> sudo dpkg -i dist/VibeFlow-*.deb
> ```
>
> **macOS (`.dmg`) — build on a Mac or a macOS CI runner**
>
> ```bash
> cd packages/vibeflow-desktop
> npm install
> npm run dist:mac        # -> dist/VibeFlow-<version>-<arch>.dmg (x64 and arm64)
> ```
>
> Signing/notarisation needs an Apple Developer certificate; without it the produced `.dmg` is
> unsigned and macOS shows the usual "unidentified developer" warning (right-click → Open).
> A `.dmg` cannot be produced from Windows.
>
> **If `npm install` stalls on the Electron download**, retry with a mirror, for example:
>
> ```bash
> npm install --electron_mirror=https://github.com/electron/electron/releases/download/v
> ```
>
> (or set `ELECTRON_MIRROR` to a local mirror). Electron downloads ~100 MB from GitHub releases
> during `npm install`, which is the only step that needs network access.
>
> ### Windows installer — result obtained in this repository
>
> Built and verified here: `packages/vibeflow-desktop/dist/VibeFlow-Setup-3.1.4-x64.exe`
> (79.9 MB, PE signature `MZ`, SHA-256 `00F8F58EEB5ACFD22BFEDBEF802407DFCA80D48D3A19CCB74A9807CFF1A523B7`).
>
> Exact steps used:
>
> 1. `cd packages/vibeflow-desktop`
> 2. `pnpm install` (npm stalled on this machine; pnpm reused the warm store and finished in ~10 min)
> 3. `node node_modules/electron/install.js` (downloads the 115 MB Electron runtime from GitHub releases)
> 4. `npx electron-builder --win --x64`
>
> `signAndEditExecutable: false` is set in `electron-builder.yml` because extracting the `winCodeSign`
> tools needs symbolic-link privileges on Windows (Developer Mode or an administrator account); the
> installer therefore keeps the default Electron icon. Remove that line when the build runs with the
> required privileges and the custom icon/metadata is wanted. Signing is skipped when no certificate
> is configured (`no signing info identified, signing is skipped`).
>
> ### Windows installer — how the installed application finds the repository
>
> The installer does not embed the monorepo (it would be several GB). The installed `VibeFlow.exe`
> starts the server from the VibeFlow repository, so it looks for it in this order:
>
> 1. the `VIBEFLOW_REPO_ROOT` environment variable;
> 2. the first line of `<userData>/vibeflow-repo-path.txt`, where `<userData>` is `%APPDATA%\VibeFlow`
>    on Windows (`~/Library/Application Support/VibeFlow` on macOS, `~/.config/VibeFlow` on Linux);
> 3. a `vibeflow-repo` folder next to the executable, then inside the packaged `resources` folder;
> 4. walking up from the executable, then from the application directory, looking for
>    `packages/server/package.json` (so launching the installed app from inside the repository works);
> 5. the parent directory of `packages/vibeflow-desktop` in development (`pnpm start`).
>
> The repository must be installed and built (`pnpm install && pnpm build`). When it cannot be found,
> or when it exists but is not built, VibeFlow shows a dialog that lists every location it searched and
> the exact path of the file to create. Server output is logged to
> `%APPDATA%\VibeFlow\logs\vibeflow-server.log`.
>
> Runtime verified on this machine from `dist/win-unpacked/VibeFlow.exe`: the embedded server answered
> `GET /api/v1/version` with `{"version":"3.1.4"}` and the UI was served with the title
> `VibeFlow - Build AI Agents, Visually`; the process tree then stopped cleanly.
>
> ### macOS — `.dmg`, step by step (run on a Mac)
>
> 1. Install the toolchain: `xcode-select --install`, then Node 24 and pnpm (`brew install node pnpm`).
> 2. Clone the fork and build the application itself:
>    `git clone <your-fork-url> vibeflow && cd vibeflow && pnpm install && pnpm build`
>    (this builds `packages/server` and `packages/ui`; the desktop shell starts that server).
> 3. Build the desktop shell: `cd packages/vibeflow-desktop && pnpm install`
> 4. Fetch the Electron runtime if the postinstall was skipped:
>    `node node_modules/electron/install.js`
>    If GitHub is slow or blocked: `export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` first.
> 5. Produce the `.dmg`: `pnpm exec electron-builder --mac`
>    (both architectures: `pnpm exec electron-builder --mac --x64 --arm64`).
> 6. Expected output: `packages/vibeflow-desktop/dist/VibeFlow-3.1.4-<arch>.dmg`.
> 7. Optional signing/notarisation: provide `CSC_LINK` + `CSC_KEY_PASSWORD` (Developer ID Application
>    certificate) and `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` for notarisation.
>    Without them the `.dmg` is unsigned and Gatekeeper shows "unidentified developer"
>    (right-click → Open to launch it).
> 8. A `.dmg` cannot be produced from Windows or Linux: use a Mac or a macOS CI runner
>    (`runs-on: macos-latest`).
>
> ### Linux — `.deb` and `.AppImage`, step by step (run on Linux)
>
> 1. Install the packaging tools used by electron-builder:
>    `sudo apt-get update && sudo apt-get install -y rpm fakeroot dpkg libarchive-tools`
>    (Fedora: `sudo dnf install -y rpm-build fakeroot dpkg`).
> 2. Clone and build the application:
>    `git clone <your-fork-url> vibeflow && cd vibeflow && pnpm install && pnpm build`
> 3. Build the desktop shell: `cd packages/vibeflow-desktop && pnpm install`
> 4. Fetch the Electron runtime if needed: `node node_modules/electron/install.js`
>    (mirror alternative: `export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`).
> 5. Produce both targets: `pnpm exec electron-builder --linux --x64`
>    (one at a time: `pnpm exec electron-builder --linux AppImage` or `--linux deb`).
> 6. Expected outputs:
>     - `packages/vibeflow-desktop/dist/VibeFlow-3.1.4-x64.AppImage` → `chmod +x` then run it directly;
>     - `packages/vibeflow-desktop/dist/VibeFlow-3.1.4-amd64.deb` → `sudo dpkg -i <file>`
>       (or `sudo apt install ./<file>`).
> 7. On a minimal distribution the AppImage may need FUSE: `sudo apt-get install -y libfuse2`.
> 8. Both targets require a Linux host (or `runs-on: ubuntu-latest`); they cannot be produced from Windows.
>
> ### Optional CI matrix
>
> A single GitHub Actions workflow with
> `strategy: matrix: os: [windows-latest, ubuntu-latest, macos-latest]` and the matching
> `pnpm exec electron-builder --win` / `--linux` / `--mac` step produces all four artifacts
> (`.exe`, `.deb`, `.AppImage`, `.dmg`) without keeping the three machines locally.

<p align="center">
<img src="https://github.com/FlowiseAI/Flowise/blob/main/images/flowise_white.svg#gh-light-mode-only">
<img src="https://github.com/FlowiseAI/Flowise/blob/main/images/flowise_dark.svg#gh-dark-mode-only">
</p>

<div align="center">

[![Release Notes](https://img.shields.io/github/release/FlowiseAI/Flowise)](https://github.com/FlowiseAI/Flowise/releases)
[![Discord](https://img.shields.io/discord/1087698854775881778?label=Discord&logo=discord)](https://discord.gg/jbaHfsRVBW)
[![Twitter Follow](https://img.shields.io/twitter/follow/FlowiseAI?style=social)](https://twitter.com/FlowiseAI)
[![GitHub star chart](https://img.shields.io/github/stars/FlowiseAI/Flowise?style=social)](https://star-history.com/#FlowiseAI/Flowise)
[![GitHub fork](https://img.shields.io/github/forks/FlowiseAI/Flowise?style=social)](https://github.com/FlowiseAI/Flowise/fork)

English | [繁體中文](./i18n/README-TW.md) | [简体中文](./i18n/README-ZH.md) | [日本語](./i18n/README-JA.md) | [한국어](./i18n/README-KR.md)

</div>

<h2>Flowise has been archived. Refer to [Future of Flowise](https://github.com/FlowiseAI/Flowise/discussions/6727)</h2>

<h3>Build AI Agents, Visually</h3>
<a href="https://github.com/FlowiseAI/Flowise">
<img width="100%" src="https://github.com/FlowiseAI/Flowise/blob/main/images/flowise_agentflow.gif?raw=true"></a>

## 📚 Table of Contents

-   [⚡ Quick Start](#-quick-start)
-   [🐳 Docker](#-docker)
-   [👨‍💻 Developers](#-developers)
-   [🌱 Env Variables](#-env-variables)
-   [📖 Documentation](#-documentation)
-   [🌐 Self Host](#-self-host)
-   [☁️ Flowise Cloud](#️-flowise-cloud)
-   [🙋 Support](#-support)
-   [🙌 Contributing](#-contributing)
-   [📄 License](#-license)

## ⚡Quick Start

Download and Install [NodeJS](https://nodejs.org/en/download) >= 20.0.0

1. Install Flowise
    ```bash
    npm install -g flowise
    ```
2. Start Flowise

    ```bash
    npx flowise start
    ```

3. Open [http://localhost:3000](http://localhost:3000)

## 🐳 Docker

### Docker Compose

1. Clone the Flowise project
2. Go to `docker` folder at the root of the project
3. Copy `.env.example` file, paste it into the same location, and rename to `.env` file
4. `docker compose up -d`
5. Open [http://localhost:3000](http://localhost:3000)
6. You can bring the containers down by `docker compose stop`

### Docker Image

1. Build the image locally:

    ```bash
    docker build --no-cache -t flowise .
    ```

2. Run image:

    ```bash
    docker run -d --name flowise -p 3000:3000 flowise
    ```

3. Stop image:

    ```bash
    docker stop flowise
    ```

## 👨‍💻 Developers

Flowise has 3 different modules in a single mono repository.

-   `server`: Node backend to serve API logics
-   `ui`: React frontend
-   `components`: Third-party nodes integrations
-   `api-documentation`: Auto-generated swagger-ui API docs from express

### Prerequisite

-   Install [PNPM](https://pnpm.io/installation)
    ```bash
    npm i -g pnpm
    ```

### Setup

1.  Clone the repository:

    ```bash
    git clone https://github.com/FlowiseAI/Flowise.git
    ```

2.  Go into repository folder:

    ```bash
    cd Flowise
    ```

3.  Install all dependencies of all modules:

    ```bash
    pnpm install
    ```

4.  Build all the code:

    ```bash
    pnpm build
    ```

    <details>
    <summary>Exit code 134 (JavaScript heap out of memory)</summary>  
    If you get this error when running the above `build` script, try increasing the Node.js heap size and run the script again:

    ```bash
    # macOS / Linux / Git Bash
    export NODE_OPTIONS="--max-old-space-size=4096"

    # Windows PowerShell
    $env:NODE_OPTIONS="--max-old-space-size=4096"

    # Windows CMD
    set NODE_OPTIONS=--max-old-space-size=4096
    ```

    Then run:

    ```bash
    pnpm build
    ```

    </details>

5.  Start the app:

    ```bash
    pnpm start
    ```

    You can now access the app on [http://localhost:3000](http://localhost:3000)

6.  For development build:

    -   Create `.env` file and specify the `VITE_PORT` (refer to `.env.example`) in `packages/ui`
    -   Create `.env` file and specify the `PORT` (refer to `.env.example`) in `packages/server`
    -   Run:

        ```bash
        pnpm dev
        ```

    Any code changes will reload the app automatically on [http://localhost:8080](http://localhost:8080)

## 🌱 Env Variables

Flowise supports different environment variables to configure your instance. You can specify the following variables in the `.env` file inside `packages/server` folder. Read [more](https://github.com/FlowiseAI/Flowise/blob/main/CONTRIBUTING.md#-env-variables)

## 📖 Documentation

You can view the Flowise Docs [here](https://docs.flowiseai.com/)

## 🌐 Self Host

Deploy Flowise self-hosted in your existing infrastructure, we support various [deployments](https://docs.flowiseai.com/configuration/deployment)

-   [AWS](https://docs.flowiseai.com/configuration/deployment/aws)
-   [Azure](https://docs.flowiseai.com/configuration/deployment/azure)
-   [Digital Ocean](https://docs.flowiseai.com/configuration/deployment/digital-ocean)
-   [GCP](https://docs.flowiseai.com/configuration/deployment/gcp)
-   [Alibaba Cloud](https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=Flowise社区版)
-   <details>
      <summary>Others</summary>

    -   [Railway](https://docs.flowiseai.com/configuration/deployment/railway)

        [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/pn4G8S?referralCode=WVNPD9)

    -   [Northflank](https://northflank.com/stacks/deploy-flowiseai)

        [![Deploy to Northflank](https://assets.northflank.com/deploy_to_northflank_smm_36700fb050.svg)](https://northflank.com/stacks/deploy-flowiseai)

    -   [Render](https://docs.flowiseai.com/configuration/deployment/render)

        [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://docs.flowiseai.com/configuration/deployment/render)

    -   [HuggingFace Spaces](https://docs.flowiseai.com/configuration/deployment/hugging-face)

        <a href="https://huggingface.co/spaces/FlowiseAI/Flowise"><img src="https://huggingface.co/datasets/huggingface/badges/raw/main/open-in-hf-spaces-sm.svg" alt="HuggingFace Spaces"></a>

    -   [Elestio](https://elest.io/open-source/flowiseai)

        [![Deploy on Elestio](https://elest.io/images/logos/deploy-to-elestio-btn.png)](https://elest.io/open-source/flowiseai)

    -   [Sealos](https://template.sealos.io/deploy?templateName=flowise)

        [![Deploy on Sealos](https://sealos.io/Deploy-on-Sealos.svg)](https://template.sealos.io/deploy?templateName=flowise)

    -   [RepoCloud](https://repocloud.io/details/?app_id=29)

        [![Deploy on RepoCloud](https://d16t0pc4846x52.cloudfront.net/deploy.png)](https://repocloud.io/details/?app_id=29)

      </details>

## ☁️ Flowise Cloud

Get Started with [Flowise Cloud](https://flowiseai.com/).

## 🙋 Support

Feel free to ask any questions, raise problems, and request new features in [Discussion](https://github.com/FlowiseAI/Flowise/discussions).

## 🙌 Contributing

Thanks go to these awesome contributors

<a href="https://github.com/FlowiseAI/Flowise/graphs/contributors">
<img src="https://contrib.rocks/image?repo=FlowiseAI/Flowise" />
</a><br><br>

See [Contributing Guide](CONTRIBUTING.md). Reach out to us at [Discord](https://discord.gg/jbaHfsRVBW) if you have any questions or issues.

[![Star History Chart](https://api.star-history.com/svg?repos=FlowiseAI/Flowise&type=Timeline)](https://star-history.com/#FlowiseAI/Flowise&Date)

## 📄 License

Source code in this repository is made available under the [Apache License Version 2.0](LICENSE.md).
