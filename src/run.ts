import * as path from 'path'
import * as util from 'util'
import * as fs from 'fs'
import * as toolCache from '@actions/tool-cache'
import * as core from '@actions/core'
import {
   getkubectlDownloadURL,
   getKubectlArch,
   getExecutableExtension,
   getLatestPatchVersion
} from './helpers'

const kubectlToolName = 'kubectl'
const stableKubectlVersion = 'v1.15.0'
const stableVersionUrl = 'https://dl.k8s.io/release/stable.txt'

export async function run() {
   let version = core.getInput('version', {required: true})
   if (version.toLocaleLowerCase() === 'latest') {
      version = await getStableKubectlVersion()
   } else {
      version = await resolveKubectlVersion(version)
   }
   const cachedPath = await downloadKubectl(version)

   core.addPath(path.dirname(cachedPath))

   core.debug(
      `Kubectl tool version: '${version}' has been cached at ${cachedPath}`
   )
   core.setOutput('kubectl-path', cachedPath)
}

export async function getStableKubectlVersion(): Promise<string> {
   return toolCache.downloadTool(stableVersionUrl).then(
      (downloadPath) => {
         let version = fs.readFileSync(downloadPath, 'utf8').toString().trim()
         if (!version) {
            version = stableKubectlVersion
         }
         return version
      },
      (error) => {
         core.debug(error)
         core.warning('GetStableVersionFailed')
         return stableKubectlVersion
      }
   )
}

export async function downloadKubectl(version: string): Promise<string> {
   let cachedToolpath = toolCache.find(kubectlToolName, version)
   let kubectlDownloadPath = ''
   const arch = getKubectlArch()
   if (!cachedToolpath) {
      try {
         kubectlDownloadPath = await toolCache.downloadTool(
            getkubectlDownloadURL(version, arch)
         )
      } catch (exception) {
         if (
            exception instanceof toolCache.HTTPError &&
            exception.httpStatusCode === 404
         ) {
            throw new Error(
               util.format(
                  "Kubectl '%s' for '%s' arch not found.",
                  version,
                  arch
               )
            )
         } else {
            throw new Error('DownloadKubectlFailed')
         }
      }

      cachedToolpath = await toolCache.cacheFile(
         kubectlDownloadPath,
         kubectlToolName + getExecutableExtension(),
         kubectlToolName,
         version
      )
   }

   const kubectlPath = path.join(
      cachedToolpath,
      kubectlToolName + getExecutableExtension()
   )
   fs.chmodSync(kubectlPath, '775')
   return kubectlPath
}

export async function resolveKubectlVersion(version: string): Promise<string> {
   const cleanedVersion = version.trim()
   const versionMatch = cleanedVersion.match(
      /^v?(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?$/
   )

   if (!versionMatch?.groups) {
      throw new Error(
         `Invalid version format: "${version}". Version must be in "major.minor" or "major.minor.patch" format (e.g., "1.27" or "v1.27.15").`
      )
   }

   const {major, minor, patch} = versionMatch.groups

   if (patch) {
      // Full version was provided, just ensure it has a 'v' prefix
      return cleanedVersion.startsWith('v')
         ? cleanedVersion
         : `v${cleanedVersion}`
   }

   // Patch version is missing, fetch the latest
   return await getLatestPatchVersion(major, minor)
}
