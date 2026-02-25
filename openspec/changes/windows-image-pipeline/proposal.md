## Why

The project currently only supports Linux (Ubuntu 22.04) runner images. Many CI/CD workloads require Windows — .NET Framework builds, Windows-specific testing, MSVC compilation, etc. Adding a Windows Server 2022 Image Builder pipeline enables Windows runner presets, modeled on the GitHub Actions `windows-2022` runner image. The construct should live in its own file so it can be easily reused in other projects.

## What Changes

- Add a new `WindowsImagePipeline` CDK construct in a separate file (`lib/constructs/windows-image-pipeline.ts`) that creates an EC2 Image Builder pipeline for Windows Server 2022 Core
- Base image: Windows Server 2022 Core (no GUI — smaller, faster, cheaper)
- All Image Builder components use PowerShell scripts executed locally (no WinRM needed — Image Builder runs components directly on the build instance via SSM Agent)
- The pipeline installs: GitHub Actions runner, Git, Node.js, Python, .NET SDK — no Docker, no cloud CLI tools other than AWS CLI (pre-installed on Windows AMIs)
- The construct follows the same pattern as the existing `RunnerImagePipeline` (recipe, infrastructure config, distribution config, pipeline) but is self-contained
- Wire the new construct into `SpotRunnerStack` as an option when a preset specifies `platform: "windows"`
- User data generation in the provisioner needs a Windows (PowerShell) variant for bootstrapping the runner on Windows instances

## Capabilities

### New Capabilities
- `windows-image-pipeline`: EC2 Image Builder pipeline construct that builds Windows Server 2022 Core runner AMIs with GitHub Actions runner and essential dev tools pre-installed

### Modified Capabilities
- `runner-lifecycle`: Runner bootstrap user data must support Windows (PowerShell) in addition to Linux (bash)
- `infrastructure-deployment`: Stack must support `platform: "windows"` in preset configuration to select the Windows pipeline

## Impact

- **Code**: New file `lib/constructs/windows-image-pipeline.ts`; changes to `lib/constructs/index.ts` (export), `lib/spot-runner-stack.ts` (preset platform routing), `lambda/lib/provisioner.ts` (Windows user data)
- **Infrastructure**: New Image Builder components, recipe, pipeline per Windows preset; Windows build instances need larger instance types (c5.2xlarge+ recommended) and more build time (~45-60 min vs ~15 min for Linux)
- **Cost**: Windows AMI builds are more expensive (longer build time, Windows license cost on build instances); weekly schedule may need adjustment
- **Dependencies**: Windows Server 2022 Core base image from AWS Image Builder managed images (`windows-server-2022-english-core-base`)
- **No breaking changes**: Existing Linux presets are unaffected
