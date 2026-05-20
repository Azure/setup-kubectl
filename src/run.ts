import * as path from 'path'
import * as util from 'util'
import * as os from 'os'
import * as fs from 'fs'
import * as crypto from 'crypto'
import {buffer as readStreamToBuffer} from 'stream/consumers'
import * as toolCache from '@actions/tool-cache'
import * as core from '@actions/core'
import {HttpClient} from '@actions/http-client'
import {
   DEFAULT_KUBECTL_BASE_URL,
   getkubectlDownloadURL,
   getKubectlArch,
   getExecutableExtension,
   getLatestPatchVersion,
   validateBaseURL,
   validateVersion
} from './helpers.js'

const kubectlToolName = 'kubectl'
const stableKubectlVersion = 'v1.15.0'

export async function run() {
   let version = core.getInput('version', {required: true})

   const rawBaseURL = core.getInput('downloadBaseURL', {required: false}).trim()
   const downloadBaseURL = rawBaseURL || DEFAULT_KUBECTL_BASE_URL
   validateBaseURL(downloadBaseURL)

   const expectedChecksum = core
      .getInput('checksum', {required: false})
      .trim()
      .toLowerCase()

   if (downloadBaseURL !== DEFAULT_KUBECTL_BASE_URL) {
      core.notice(
         `kubectl will be downloaded from a custom mirror: ${downloadBaseURL}`
      )
      if (!expectedChecksum) {
         core.warning(
            'Custom downloadBaseURL set without a `checksum` input; downloaded binary will not be integrity-verified.'
         )
      }
   }

   if (version.toLocaleLowerCase() === 'latest') {
      version = await getStableKubectlVersion(downloadBaseURL)
   } else {
      version = await resolveKubectlVersion(version, downloadBaseURL)
   }
   const cachedPath = await downloadKubectl(
      version,
      downloadBaseURL,
      expectedChecksum
   )

   core.addPath(path.dirname(cachedPath))

   core.debug(
      `Kubectl tool version: '${version}' has been cached at ${cachedPath}`
   )
   core.setOutput('kubectl-path', cachedPath)
}

export async function getStableKubectlVersion(
   baseURL: string = DEFAULT_KUBECTL_BASE_URL
): Promise<string> {
   const url = validateBaseURL(baseURL)
   const basePath = url.pathname.replace(/\/+$/, '')
   url.pathname = `${basePath}/release/stable.txt`
   const stableVersionUrl = url.toString()

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

export async function downloadKubectl(
   version: string,
   baseURL: string = DEFAULT_KUBECTL_BASE_URL,
   expectedChecksum: string = ''
): Promise<string> {
   validateVersion(version)

   let cachedToolpath = toolCache.find(kubectlToolName, version)
   let kubectlDownloadPath = ''
   const arch = getKubectlArch()
   if (!cachedToolpath) {
      const downloadURL = getkubectlDownloadURL(version, arch, baseURL)
      try {
         if (baseURL === DEFAULT_KUBECTL_BASE_URL) {
            kubectlDownloadPath = await toolCache.downloadTool(downloadURL)
         } else {
            kubectlDownloadPath = await secureDownload(downloadURL)
         }
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

      if (expectedChecksum) {
         verifyChecksum(kubectlDownloadPath, expectedChecksum)
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

async function secureDownload(downloadURL: string): Promise<string> {
   const client = new HttpClient('setup-kubectl', [], {
      allowRedirects: false
   })
   const response = await client.get(downloadURL)
   const status = response.message.statusCode

   if (status && status >= 300 && status < 400) {
      const location = response.message.headers['location']
      response.message.resume()
      throw new Error(
         `Refusing redirect from custom downloadBaseURL (status ${status} -> ${location}).`
      )
   }
   if (status === 404) {
      response.message.resume()
      throw new toolCache.HTTPError(404)
   }
   if (status !== 200) {
      response.message.resume()
      throw new Error(`Download failed with status ${status}`)
   }

   const tmpDir = process.env['RUNNER_TEMP'] || os.tmpdir()
   const tmpFile = path.join(tmpDir, `kubectl-${crypto.randomUUID()}`)
   const body = await readStreamToBuffer(response.message)
   fs.writeFileSync(tmpFile, body)
   return tmpFile
}

function verifyChecksum(filePath: string, expected: string): void {
   if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(
         `Invalid checksum input: expected a 64-character hex SHA256 string.`
      )
   }
   const actual = crypto
      .createHash('sha256')
      .update(fs.readFileSync(filePath))
      .digest('hex')
   if (actual !== expected) {
      throw new Error(
         `Checksum mismatch for downloaded kubectl. Expected ${expected}, got ${actual}.`
      )
   }
}

export async function resolveKubectlVersion(
   version: string,
   baseURL: string = DEFAULT_KUBECTL_BASE_URL
): Promise<string> {
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

   // Patch version is missing, fetch the latest from the (possibly custom) mirror.
   return await getLatestPatchVersion(major, minor, baseURL)
}
