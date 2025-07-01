import * as path from 'path'
import * as util from 'util'
import * as fs from 'fs'
import * as semver from 'semver'
import * as toolCache from '@actions/tool-cache'
import * as runModule from './run'
import * as core from '@actions/core'
import {
   getkubectlDownloadURL,
   getKubectlArch,
   getExecutableExtension
} from './helpers'

const kubectlToolName = 'kubectl'
const stableKubectlVersion = 'v1.15.0'
const stableVersionUrl =
   'https://storage.googleapis.com/kubernetes-release/release/stable.txt'

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

export async function getLatestPatchVersion(
   major: string,
   minor: string
): Promise<string> {
   const sourceURL = `https://cdn.dl.k8s.io/release/stable-${major}.${minor}.txt`
   try {
      const downloadPath = await toolCache.downloadTool(sourceURL)
      const latestPatch = fs
         .readFileSync(downloadPath, 'utf8')
         .toString()
         .trim()
      if (!latestPatch) {
         throw new Error(`No patch version found for ${major}.${minor}`)
      }
      return latestPatch
   } catch (error) {
      core.debug(error)
      core.warning('GetLatestPatchVersionFailed')
      throw new Error(
         `Failed to get latest patch version for ${major}.${minor}`
      )
   }
}

export async function resolveKubectlVersion(version: string): Promise<string> {
   const cleanedVersion = version.trim()

   /*------ detect "major.minor" only ----------------*/
   const mmMatch = cleanedVersion.match(/^v?(?<major>\d+)\.(?<minor>\d+)$/)
   if (!mmMatch || !mmMatch.groups) {
      // User already provided a full version such as 1.27.15 – do nothing.
      return cleanedVersion.startsWith('v')
         ? cleanedVersion
         : `v${cleanedVersion}`
   }
   const {major, minor} = mmMatch.groups

   // Call the k8s CDN to get the latest patch version for the given major.minor
   return await runModule.getLatestPatchVersion(major, minor)
}
