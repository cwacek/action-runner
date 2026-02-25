## Context

The existing `RunnerImagePipeline` construct builds Ubuntu 22.04 images using bash-based Image Builder components (Docker, GitHub Actions runner, Docker image pre-pull). It's tightly coupled to Linux — bash scripts, apt-get, ubuntu user, etc. Windows requires a parallel construct using PowerShell components, a different parent image, and different tooling.

Image Builder runs components via SSM Agent directly on the build instance, so no WinRM or remote provisioning is needed — PowerShell scripts execute locally.

GitHub maintains a comprehensive set of Windows runner image build scripts at `actions/runner-images`. Their `images/windows/scripts/build/` directory contains 86+ PowerShell scripts for installing every tool in the `windows-2022` runner image. Rather than reimplementing this toolchain, we clone their repo and execute the relevant scripts directly.

## Goals / Non-Goals

**Goals:**
- Self-contained `WindowsImagePipeline` construct in its own file, reusable outside this project
- Mirrors the Linux construct's structure (recipe, infra config, dist config, pipeline) for consistency
- Leverage `actions/runner-images` scripts directly — clone the repo onto the build instance and execute the same install scripts the official images use
- Integrates into the existing preset system via a `platform` field
- Windows PowerShell user data script for runner bootstrap on provisioned instances

**Non-Goals:**
- Reimplementing install scripts that `actions/runner-images` already provides
- Running the full 86-script pipeline — we select a practical subset
- Docker support (Windows containers add significant complexity and image size)
- Visual Studio or full Windows SDK (too large for general-purpose runner images)
- GUI tools or Remote Desktop (Server Core, headless only)
- arm64 support (Windows on ARM via EC2 is limited)

## Decisions

### 1. Clone actions/runner-images and execute their scripts

**Decision:** The primary Image Builder component clones `actions/runner-images` to `C:\runner-images`, then executes the Packer provisioner steps from `build.windows-2022.pkr.hcl` by invoking the scripts directly in the same order. We select a subset of the 30 Packer steps — skipping cloud CLIs, browsers, databases, Visual Studio, and other heavyweight/unnecessary tooling.

**Rationale:** The `actions/runner-images` scripts handle edge cases, version pinning, PATH configuration, and Windows quirks that would take significant effort to replicate. By executing them directly, we get battle-tested installs and can easily add more tools later by including more scripts. The Packer HCL file defines the execution order and which scripts to run — we follow that order for the scripts we include.

**Scripts we include (from `images/windows/scripts/build/`):**
- Phase 1 (base config): `Configure-BaseImage.ps1`, `Configure-PowerShell.ps1`, `Install-PowerShellModules.ps1`, `Install-WindowsFeatures.ps1`, `Install-Chocolatey.ps1`, `Configure-WindowsDefner.ps1`
- Phase 2 (core tools): `Install-Git.ps1`, `Install-NodeJS.ps1`, `Install-DotnetSDK.ps1`, `Install-Python.ps1` (via `Install-Toolset.ps1` or `Install-Pipx.ps1`), `Install-PowershellCore.ps1`, `Install-VisualStudio.ps1`, `Install-Github-CLI.ps1`
- Phase 3 (runner): GitHub Actions runner install (custom, not from runner-images — they don't install the runner itself)
- Phase 4 (cleanup): `Configure-System.ps1`, `Invoke-Cleanup.ps1`

**Scripts we skip:** Docker, browsers (Chrome, Firefox, Edge), databases (MySQL, PostgreSQL, MongoDB), Android SDK, Java, Haskell, Ruby, Rust, R, PHP, cloud CLIs (Azure, Aliyun), Selenium, WSL2, WinAppDriver, etc.

**Alternative considered:** Write our own install scripts — rejected because it duplicates maintained work and misses edge cases.

### 2. Toolset JSON drives version pinning

**Decision:** The `actions/runner-images` scripts read versions from a `toolset.json` file. We copy their toolset JSON for Windows 2022 and can customize versions by modifying it before execution.

**Rationale:** This is how the upstream scripts work. Many install scripts call `Get-ToolsetContent` to determine which versions to install. By controlling the toolset JSON, we control what gets installed without forking the scripts.

### 3. Separate construct file, not extending the Linux construct

**Decision:** Create `WindowsImagePipeline` as a standalone construct in `lib/constructs/windows-image-pipeline.ts`.

**Rationale:** The two constructs share structural patterns (recipe → infra → dist → pipeline) but differ in every detail — component scripts, parent images, user accounts, file paths, checksums. A separate file is easier to copy to another project.

### 4. Windows Server 2022 Core as parent image

**Decision:** Use `windows-server-2022-english-core-base` as the parent image.

**Rationale:** Server Core is ~5 GB smaller than the full image, boots faster, has a smaller attack surface, and we don't need a GUI for CI runners. All required tools (PowerShell, .NET, AWS CLI) work on Core. Note: some `runner-images` scripts may assume the full desktop experience — if a script fails on Core, we skip it or patch the call.

### 5. Multi-component pipeline with restarts

**Decision:** Split the build into multiple Image Builder components to allow Windows restarts between phases. The Packer HCL uses `windows-restart` provisioners between heavy install phases — we replicate this with separate components (Image Builder automatically restarts between components when configured).

**Component structure:**
1. **CloneAndConfigure** — Clone `actions/runner-images`, run base configuration scripts, install Chocolatey
2. **InstallCoreTools** — Git, Node.js, .NET SDK, Python, PowerShell Core (reboot after)
3. **InstallRunner** — GitHub Actions runner (custom script, not from runner-images)
4. **Cleanup** — System configuration, cleanup, Sysprep preparation

### 6. Platform field on RunnerPreset

**Decision:** Add `platform?: "linux" | "windows"` to `RunnerPreset`, defaulting to `"linux"`. The stack routes to the appropriate pipeline construct based on this field.

### 7. Windows user data as PowerShell via `<powershell>` tags

**Decision:** Windows EC2 user data uses `<powershell>...</powershell>` tags. The provisioner generates a `generateWindowsUserData` function.

**Rationale:** EC2 Windows instances execute user data in `<powershell>` tags automatically on first boot. The script handles JIT config decoding, runner startup via `run.cmd`, spot interruption monitoring (via IMDS), and `Stop-Computer` on completion.

### 8. Default build instance: c5.2xlarge, 200 GB disk

**Decision:** Default Windows build instance is `c5.2xlarge` (8 vCPU, 16 GB RAM) with 200 GB root volume.

**Rationale:** Windows builds are heavier. The `actions/runner-images` scripts download and install significant tooling even for our subset. 200 GB gives headroom for install temps and the final image.

### 9. Pin runner-images to a specific tag/commit

**Decision:** The construct accepts a `runnerImagesRef` prop (default: a known stable tag like `win22/20250210.1`) that determines which commit of `actions/runner-images` to clone.

**Rationale:** Pinning prevents build breakage from upstream changes. The tag can be bumped deliberately when updating the toolchain.

## Risks / Trade-offs

- **Upstream script compatibility with Server Core** → Some scripts may assume desktop experience features. Mitigated by testing each included script on Core and skipping incompatible ones.
- **Upstream script breakage on version bump** → Pinning to a specific tag mitigates this. Only bump after testing.
- **Longer build times (~60-90 min)** → Acceptable for weekly builds. The subset is much faster than the full 86-script pipeline.
- **Windows license cost on build instances** → Unavoidable. Weekly builds keep cost predictable.
- **Toolset JSON drift** → If we customize the toolset JSON, it may diverge from upstream expectations on version bump. Keep customizations minimal.
- **Git clone requires network** → Build instance needs outbound internet. Already required for Chocolatey installs; security group allows outbound.
