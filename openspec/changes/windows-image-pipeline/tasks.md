## 1. WindowsImagePipeline Construct

- [ ] 1.1 Create `lib/constructs/windows-image-pipeline.ts` with `WindowsImagePipelineProps` interface (fields: `vpc`, `subnet`, `presetName`, `architecture?`, `runnerVersion?`, `runnerSha256X64?`, `runnerImagesRef?`, `buildSchedule?`, `buildInstanceTypes?`, `additionalComponentArns?`)
- [ ] 1.2 Add IAM instance role with `EC2InstanceProfileForImageBuilder` and `AmazonSSMManagedInstanceCore` managed policies, and instance profile
- [ ] 1.3 Add build security group with `allowAllOutbound: true` (needs internet for Chocolatey, GitHub, etc.)
- [ ] 1.4 Implement `CloneAndConfigure` Image Builder component (PowerShell `ExecutePowerShell` action) — clones `actions/runner-images` at pinned `runnerImagesRef`, runs `Configure-BaseImage.ps1`, `Configure-PowerShell.ps1`, `Install-PowerShellModules.ps1`, `Install-WindowsFeatures.ps1`, `Install-Chocolatey.ps1`
- [ ] 1.5 Implement `InstallCoreTools` Image Builder component — installs Git, Node.js, .NET SDK, Python, PowerShell Core, GitHub CLI using scripts from `actions/runner-images/images/windows/scripts/build/`; configures a Windows restart after this component
- [ ] 1.6 Implement `InstallRunner` Image Builder component — downloads the GitHub Actions runner zip for `runnerVersion` to `C:\actions-runner`, SHA256-verifies it, extracts it (does NOT configure/register)
- [ ] 1.7 Implement `Cleanup` Image Builder component — runs `Invoke-Cleanup.ps1` and `Configure-System.ps1` from `actions/runner-images`
- [ ] 1.8 Create `CfnImageRecipe` using Windows Server 2022 Core parent image ARN (`windows-server-2022-english-core-base/x.x.x`), all four components in order, and a 200 GB gp3 root volume (`/dev/sda1`)
- [ ] 1.9 Create `CfnInfrastructureConfiguration` with defaults `c5.2xlarge`, instance profile, subnet, security group, `terminateInstanceOnFailure: true`
- [ ] 1.10 Create `CfnDistributionConfiguration` with AMI name pattern `spot-runner-<presetName>-{{imagebuilder:buildDate}}` and tags (`Name`, `Runner_Version`, `Preset_Name`, `Platform: windows`)
- [ ] 1.11 Create `CfnImagePipeline` wiring recipe → infra → dist configs, default schedule `cron(0 4 ? * SUN *)`, expose `pipelineArn` and `imageRecipeArn` as public readonly properties

## 2. Constructs Index Export

- [ ] 2.1 Add `export { WindowsImagePipeline, WindowsImagePipelineProps } from './windows-image-pipeline'` to `lib/constructs/index.ts`

## 3. Platform Field on RunnerPreset

- [ ] 3.1 Add `platform?: "linux" | "windows"` field to the `RunnerPreset` interface/type in `lib/spot-runner-stack.ts` (defaulting to `"linux"` at runtime)
- [ ] 3.2 Add CDK synthesis validation: fail if a preset has `platform: "windows"` and `architecture: "arm64"`
- [ ] 3.3 Add CDK synthesis validation: fail if a preset has `platform: "windows"` and a non-empty `additionalDockerImages` array
- [ ] 3.4 Route preset instantiation: if `platform === "windows"` create a `WindowsImagePipeline`; otherwise create a `RunnerImagePipeline` (existing behavior)
- [ ] 3.5 Include `platform` field in the SSM parameter JSON written for each preset (so the provisioner Lambda can read it)

## 4. Windows User Data in Provisioner

- [ ] 4.1 Implement `generateWindowsUserData(jitConfig: string, timeout: number): string` in `lambda/lib/provisioner.ts` — returns a `<powershell>...</powershell>`-wrapped PowerShell script that: decodes the base64 JIT config, runs `C:\actions-runner\config.cmd`, runs `C:\actions-runner\run.cmd`, then calls `Stop-Computer -Force`
- [ ] 4.2 Add spot interruption polling to the Windows user data script — a background loop that queries IMDS `/latest/meta-data/spot/termination-time` and logs a warning if a termination notice is found
- [ ] 4.3 Modify the provisioner's main provision flow to read the `platform` field from the SSM runner config (defaulting to `"linux"` if absent) and call `generateWindowsUserData` for Windows presets instead of `generateUserData`
