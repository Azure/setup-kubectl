import * as os from 'os'
import * as fs from 'fs'
import * as net from 'net'
import * as dns from 'dns'
import * as path from 'path'
import * as crypto from 'crypto'
import * as core from '@actions/core'
import * as toolCache from '@actions/tool-cache'
import {HttpClient} from '@actions/http-client'

export const DEFAULT_KUBECTL_BASE_URL = 'https://dl.k8s.io'

export function normalizeBaseURL(input: string): string {
   const u = new URL(input)
   return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
}

export function isDefaultBaseURL(input: string): boolean {
   try {
      return (
         normalizeBaseURL(input) === normalizeBaseURL(DEFAULT_KUBECTL_BASE_URL)
      )
   } catch {
      return false
   }
}

const SECURE_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024
const SECURE_DOWNLOAD_MAX_REDIRECTS = 5

export async function secureDownload(
   downloadURL: string,
   authToken: string = ''
): Promise<string> {
   const client = new HttpClient('setup-kubectl', [], {
      allowRedirects: false
   })

   const initialOrigin = new URL(downloadURL).origin
   let currentURL = downloadURL
   let response!: Awaited<ReturnType<HttpClient['get']>>
   let status: number | undefined
   for (let hop = 0; hop <= SECURE_DOWNLOAD_MAX_REDIRECTS; hop++) {
      await assertHostResolvesSafely(new URL(currentURL).hostname)

      const sameOrigin = new URL(currentURL).origin === initialOrigin
      const headers =
         authToken && sameOrigin
            ? {Authorization: `Bearer ${authToken}`}
            : undefined
      response = await client.get(currentURL, headers)
      status = response.message.statusCode

      if (!status || status < 300 || status >= 400) break

      const locationHeader = response.message.headers['location']
      const location = Array.isArray(locationHeader)
         ? locationHeader[0]
         : locationHeader
      response.message.resume()
      if (!location) {
         throw new Error(
            `Redirect from custom downloadBaseURL had no Location header (status ${status}).`
         )
      }
      if (hop === SECURE_DOWNLOAD_MAX_REDIRECTS) {
         throw new Error(
            `Refusing download: exceeded ${SECURE_DOWNLOAD_MAX_REDIRECTS} redirects from custom downloadBaseURL.`
         )
      }
      // Re-validate the redirect target so a mirror can't bounce us to a literal internal IP.
      const next = new URL(location, currentURL)
      validateBaseURL(next.toString())
      currentURL = next.toString()
   }

   if (status !== 200) {
      response.message.resume()
      throw typeof status === 'number'
         ? new toolCache.HTTPError(status)
         : new Error(
              `Refusing download: no HTTP status returned for ${currentURL} (network or TLS error).`
           )
   }

   const contentLengthHeader = response.message.headers['content-length']
   const contentLength = Array.isArray(contentLengthHeader)
      ? contentLengthHeader[0]
      : contentLengthHeader
   if (contentLength) {
      const declared = Number.parseInt(contentLength, 10)
      if (Number.isFinite(declared) && declared > SECURE_DOWNLOAD_MAX_BYTES) {
         response.message.resume()
         throw new Error(
            `Refusing download: Content-Length ${declared} exceeds cap ${SECURE_DOWNLOAD_MAX_BYTES} bytes.`
         )
      }
   }

   const tmpDir = process.env['RUNNER_TEMP'] || os.tmpdir()
   const tmpFile = path.join(tmpDir, `kubectl-${crypto.randomUUID()}`)

   // 'wx' = create exclusive, so we never silently overwrite an existing file.
   const fd = fs.openSync(tmpFile, 'wx')
   let received = 0
   let success = false
   try {
      for await (const chunk of response.message as AsyncIterable<Buffer>) {
         received += chunk.length
         if (received > SECURE_DOWNLOAD_MAX_BYTES) {
            response.message.destroy()
            throw new Error(
               `Refusing download: response body exceeded cap ${SECURE_DOWNLOAD_MAX_BYTES} bytes.`
            )
         }
         fs.writeSync(fd, chunk)
      }
      success = true
   } finally {
      try {
         fs.closeSync(fd)
      } catch {
         /* empty */
      }
      if (!success) {
         try {
            fs.unlinkSync(tmpFile)
         } catch {
            /* empty */
         }
      }
   }
   return tmpFile
}

export function validateBaseURL(input: string): URL {
   let url: URL
   try {
      url = new URL(input)
   } catch {
      throw new Error(`Invalid downloadBaseURL: "${input}" is not a valid URL.`)
   }

   if (url.protocol !== 'https:') {
      throw new Error(
         `downloadBaseURL must use https://, got "${url.protocol}" in "${input}".`
      )
   }

   if (url.username || url.password) {
      throw new Error(
         'downloadBaseURL must not contain userinfo (user:pass@host).'
      )
   }

   // Strip IPv6 brackets so net.isIP recognises the address.
   const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

   const family = net.isIP(host)
   if (family !== 0 && isBlockedIP(host, family)) {
      throw new Error(
         `downloadBaseURL host "${host}" is a literal loopback/link-local/private IP and is blocked.`
      )
   }

   return url
}

// Loopback, link-local (incl. IMDS 169.254.169.254), RFC1918, IPv6 ULA, v4-mapped IPv6.
export function isBlockedIP(host: string, family: number): boolean {
   return (
      host === '::1' ||
      host === '::' ||
      host === '0.0.0.0' ||
      /^127\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      (family === 6 && /^f[cd]/.test(host)) || // ULA fc00::/7
      (family === 6 && /^fe[89ab]/.test(host)) || // link-local fe80::/10
      (family === 6 && host.startsWith('::ffff:')) // v4-mapped IPv6
   )
}

// Reject hostnames whose DNS resolves to any blocked range. Closes the SSRF hole
// where an attacker controls DNS for a public-looking name pointed at internal IPs.
export async function assertHostResolvesSafely(
   hostname: string
): Promise<void> {
   const bare = hostname.replace(/^\[|\]$/g, '')
   if (net.isIP(bare) !== 0) return

   let addresses: dns.LookupAddress[]
   try {
      addresses = await dns.promises.lookup(bare, {all: true, verbatim: true})
   } catch (err) {
      throw new Error(
         `Failed to resolve downloadBaseURL host "${bare}": ${
            err instanceof Error ? err.message : String(err)
         }`
      )
   }

   for (const {address, family} of addresses) {
      if (isBlockedIP(address.toLowerCase(), family)) {
         throw new Error(
            `downloadBaseURL host "${bare}" resolved to a blocked address (${address}); refusing to fetch.`
         )
      }
   }
}

export function validateVersion(version: string): void {
   if (!/^v?\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(
         `Invalid kubectl version: "${version}". Expected a value like "v1.30.0".`
      )
   }
}

export function getKubectlArch(): string {
   const arch = os.arch()
   if (arch === 'x64') {
      return 'amd64'
   }
   return arch
}

export function getkubectlDownloadURL(
   version: string,
   arch: string,
   baseURL: string = DEFAULT_KUBECTL_BASE_URL
): string {
   validateVersion(version)
   const url = validateBaseURL(baseURL)

   let osDir: string
   let file: string
   switch (os.type()) {
      case 'Linux':
         osDir = 'linux'
         file = 'kubectl'
         break
      case 'Darwin':
         osDir = 'darwin'
         file = 'kubectl'
         break
      case 'Windows_NT':
      default:
         osDir = 'windows'
         file = 'kubectl.exe'
         break
   }

   const basePath = url.pathname.replace(/\/+$/, '')
   url.pathname = `${basePath}/release/${version}/bin/${osDir}/${arch}/${file}`
   return url.toString()
}

export async function getLatestPatchVersion(
   major: string,
   minor: string,
   baseURL: string = DEFAULT_KUBECTL_BASE_URL,
   authToken: string = ''
): Promise<string> {
   const version = `${major}.${minor}`
   const url = validateBaseURL(baseURL)
   const basePath = url.pathname.replace(/\/+$/, '')
   url.pathname = `${basePath}/release/stable-${version}.txt`
   const sourceURL = url.toString()
   const useSecure = !isDefaultBaseURL(baseURL)
   let downloadPath = ''
   try {
      downloadPath = useSecure
         ? await secureDownload(sourceURL, authToken)
         : await toolCache.downloadTool(sourceURL)
      const latestPatch = fs
         .readFileSync(downloadPath, 'utf8')
         .toString()
         .trim()
      if (!latestPatch) {
         throw new Error(`No patch version found for ${version}`)
      }
      return latestPatch
   } catch (error) {
      core.debug(String(error))
      core.warning('GetLatestPatchVersionFailed')
      throw new Error(`Failed to get latest patch version for ${version}`)
   } finally {
      if (useSecure && downloadPath) {
         try {
            fs.unlinkSync(downloadPath)
         } catch {
            /* best-effort cleanup of secureDownload temp file */
         }
      }
   }
}

export function getExecutableExtension(): string {
   if (os.type().match(/^Win/)) {
      return '.exe'
   }
   return ''
}
