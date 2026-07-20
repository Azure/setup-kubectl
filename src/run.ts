import * as path from 'path'
import * as util from 'util'
import * as fs from 'fs'
import * as crypto from 'crypto'
import * as toolCache from '@actions/tool-cache'
import * as core from '@actions/core'
import {
   DEFAULT_KUBECTL_BASE_URL,
   getkubectlDownloadURL,
   getKubectlArch,
   getExecutableExtension,
   getLatestPatchVersion,
   isDefaultBaseURL,
   normalizeBaseURL,
   secureDownload,
   validateBaseURL
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

   const downloadAuthToken = core
      .getInput('downloadAuthToken', {required: false})
      .trim()
   if (downloadAuthToken) {
      core.setSecret(downloadAuthToken)
      if (isDefaultBaseURL(downloadBaseURL)) {
         throw new Error(
            '`downloadAuthToken` was set but `downloadBaseURL` is the default (https://dl.k8s.io). Refusing to send a bearer token to the public Kubernetes mirror.'
         )
      }
   }

   if (!isDefaultBaseURL(downloadBaseURL)) {
      if (!expectedChecksum) {
         throw new Error(
            'Refusing to download from a custom `downloadBaseURL` without a `checksum`. On self-hosted runners an unverified binary would poison the tool cache and be reused across jobs. Set the `checksum` input to a 64-char SHA-256 to enable integrity verification.'
         )
      }
      core.notice(
         `kubectl will be downloaded from a custom mirror: ${downloadBaseURL}`
      )
   }

   if (version.trim().toLowerCase() === 'latest') {
      version = await getStableKubectlVersion(
         downloadBaseURL,
         downloadAuthToken
      )
   } else {
      version = await resolveKubectlVersion(
         version,
         downloadBaseURL,
         downloadAuthToken
      )
   }
   const cachedPath = await downloadKubectl(
      version,
      downloadBaseURL,
      expectedChecksum,
      downloadAuthToken
   )

   core.addPath(path.dirname(cachedPath))

   core.debug(
      `Kubectl tool version: '${version}' has been cached at ${cachedPath}`
   )
   core.setOutput('kubectl-path', cachedPath)
}

export async function getStableKubectlVersion(
   baseURL: string = DEFAULT_KUBECTL_BASE_URL,
   authToken: string = ''
): Promise<string> {
   const url = validateBaseURL(baseURL)
   const basePath = url.pathname.replace(/\/+$/, '')
   url.pathname = `${basePath}/release/stable.txt`
   const stableVersionUrl = url.toString()
   const useSecure = !isDefaultBaseURL(baseURL)

   let downloadPath = ''
   try {
      downloadPath = useSecure
         ? await secureDownload(stableVersionUrl, authToken)
         : await toolCache.downloadTool(stableVersionUrl)
      let version = fs.readFileSync(downloadPath, 'utf8').toString().trim()
      if (!version) {
         version = stableKubectlVersion
      }
      return version
   } catch (error) {
      core.debug(String(error))
      if (useSecure) {
         throw new Error(
            `Failed to fetch stable.txt from custom downloadBaseURL "${baseURL}".`
         )
      }
      core.warning('GetStableVersionFailed')
      return stableKubectlVersion
   } finally {
      if (useSecure && downloadPath) {
         try {
            fs.unlinkSync(downloadPath)
         } catch {
            /* empty */
         }
      }
   }
}

export async function downloadKubectl(
   version: string,
   baseURL: string = DEFAULT_KUBECTL_BASE_URL,
   expectedChecksum: string = '',
   authToken: string = ''
): Promise<string> {
   validateBaseURL(baseURL)

   if (!isDefaultBaseURL(baseURL) && !expectedChecksum) {
      throw new Error(
         'Refusing to download from a custom `baseURL` without a `checksum`. Pass a 64-char SHA-256 to enable integrity verification.'
      )
   }

   const cacheKey = isDefaultBaseURL(baseURL)
      ? version
      : `${version}-${crypto
           .createHash('sha256')
           .update(normalizeBaseURL(baseURL))
           .digest('hex')
           .slice(0, 12)}`

   let cachedToolpath = toolCache.find(kubectlToolName, cacheKey)
   let kubectlDownloadPath = ''
   const arch = getKubectlArch()
   if (!cachedToolpath) {
      const downloadURL = getkubectlDownloadURL(version, arch, baseURL)
      try {
         if (isDefaultBaseURL(baseURL)) {
            kubectlDownloadPath = await toolCache.downloadTool(downloadURL)
         } else {
            kubectlDownloadPath = await secureDownload(downloadURL, authToken)
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
         }
         throw exception instanceof Error
            ? exception
            : new Error(`DownloadKubectlFailed: ${String(exception)}`)
      }

      try {
         cachedToolpath = await toolCache.cacheFile(
            kubectlDownloadPath,
            kubectlToolName + getExecutableExtension(),
            kubectlToolName,
            cacheKey
         )
      } finally {
         if (!isDefaultBaseURL(baseURL) && kubectlDownloadPath) {
            try {
               fs.unlinkSync(kubectlDownloadPath)
            } catch {
               /* empty */
            }
         }
      }
   }

   const kubectlPath = path.join(
      cachedToolpath,
      kubectlToolName + getExecutableExtension()
   )

   // Re-verify on every run so cached binaries are also checked.
   if (expectedChecksum) {
      verifyChecksum(kubectlPath, expectedChecksum)
   }

   fs.chmodSync(kubectlPath, '775')
   return kubectlPath
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
   baseURL: string = DEFAULT_KUBECTL_BASE_URL,
   authToken: string = ''
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
      return cleanedVersion.startsWith('v')
         ? cleanedVersion
         : `v${cleanedVersion}`
   }

   return await getLatestPatchVersion(major, minor, baseURL, authToken)
}
