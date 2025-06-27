import * as path from 'path'
import * as util from 'util'
import * as fs from 'fs'
import {Octokit} from '@octokit/rest'
import * as semver from 'semver'
import * as toolCache from '@actions/tool-cache'
import * as core from '@actions/core'

export const octo = new Octokit()
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
      version = await resolveKubectlVersion(version, octo)
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
export async function resolveKubectlVersion(
   version: string, octo:Octokit): Promise<string> {
   const cleanedVersion = version.trim()

   /*------ detect "major.minor" only ----------------*/
   const mmMatch=cleanedVersion.match(/^v?(?<major>\d+)\.(?<minor>\d+)$/)
   if (!mmMatch || !mmMatch.groups) {
       // User already provided a full version such as 1.27.15 – do nothing.
      return cleanedVersion.startsWith('v') ? cleanedVersion : `v${cleanedVersion}`
   }
   const {major, minor} = mmMatch.groups

    /* -------------------- fetch recent tags from GitHub ----------------- */
   const resp= await octo.repos.listTags({
        owner: 'kubernetes',
        repo: 'kubernetes',
         per_page: 100,
    })

    /* -------------------- find newest patch within that line ------------ */
  const wantedPrefix = `${major}.${minor}.`
  const newest = resp.data
    .map(tag => tag.name.replace(/^v/, ''))       // strip leading v
    .filter(v => v.startsWith(wantedPrefix))      // keep only 1.27.*
    .sort(semver.rcompare)[0]                     // newest first

  if (!newest) {
    throw new Error(`Could not find any ${wantedPrefix}* tag in kubernetes/kubernetes`)
  }

  return `v${newest}` // always return with leading "v"
}
