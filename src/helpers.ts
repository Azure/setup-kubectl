import * as os from 'os'
import * as fs from 'fs'
import * as net from 'net'
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

export async function secureDownload(downloadURL: string): Promise<string> {
   const client = new HttpClient('setup-kubectl', [], {
      allowRedirects: false
   })

   let currentURL = downloadURL
   let response
   let status: number | undefined
   for (let hop = 0; hop <= SECURE_DOWNLOAD_MAX_REDIRECTS; hop++) {
      response = await client.get(currentURL)
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
      // Resolve relative redirects against the current URL, then re-run host
      // validation so a mirror can't bounce us to a literal internal IP.
      const next = new URL(location, currentURL)
      validateBaseURL(next.toString())
      currentURL = next.toString()
   }

   if (!response) {
      throw new Error('Download failed: no response received.')
   }
   if (status === 404) {
      response.message.resume()
      throw new toolCache.HTTPError(404)
   }
   if (status !== 200) {
      response.message.resume()
      throw new toolCache.HTTPError(status)
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

   const chunks: Buffer[] = []
   let received = 0
   for await (const chunk of response.message as AsyncIterable<Buffer>) {
      received += chunk.length
      if (received > SECURE_DOWNLOAD_MAX_BYTES) {
         response.message.destroy()
         throw new Error(
            `Refusing download: response body exceeded cap ${SECURE_DOWNLOAD_MAX_BYTES} bytes.`
         )
      }
      chunks.push(chunk)
   }

   const tmpDir = process.env['RUNNER_TEMP'] || os.tmpdir()
   const tmpFile = path.join(tmpDir, `kubectl-${crypto.randomUUID()}`)
   fs.writeFileSync(tmpFile, Buffer.concat(chunks))
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

   const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

   // Only literal IPs in dangerous ranges are blocked. DNS names (e.g. artifactory.corp.local)
   // pass through even if they resolve internally to a private IP -- that's the air-gap case.
   // The SSRF threat is attacker-supplied literal IPs aimed at cloud metadata (169.254.169.254)
   // or internal services.
   const ipFamily = net.isIP(host)
   if (ipFamily === 0) {
      return url
   }

   let effectiveHost = host
   let effectiveFamily = ipFamily
   if (ipFamily === 6) {
      // Catch IPv4-mapped (::ffff:a.b.c.d / ::ffff:XXXX:YYYY) and IPv4-compatible
      // (::a.b.c.d) addresses so e.g. [::ffff:169.254.169.254] can't bypass the v4 rules.
      const embedded = extractEmbeddedV4(host)
      if (embedded) {
         effectiveHost = embedded
         effectiveFamily = 4
      }
   }

   const isLoopback = effectiveHost === '127.0.0.1' || effectiveHost === '::1'
   const isLoopbackV4Range =
      effectiveFamily === 4 && /^127\./.test(effectiveHost)
   const isLinkLocal = effectiveHost.startsWith('169.254.')
   const isPrivateV4 =
      /^10\./.test(effectiveHost) ||
      /^192\.168\./.test(effectiveHost) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(effectiveHost)
   const isUniqueLocalV6 = effectiveFamily === 6 && /^f[cd]/.test(effectiveHost)
   const isLinkLocalV6 =
      effectiveFamily === 6 && /^fe[89ab]/.test(effectiveHost)
   const isUnspecified = effectiveHost === '0.0.0.0' || effectiveHost === '::'
   if (
      isLoopback ||
      isLoopbackV4Range ||
      isLinkLocal ||
      isPrivateV4 ||
      isUniqueLocalV6 ||
      isLinkLocalV6 ||
      isUnspecified
   ) {
      throw new Error(
         `downloadBaseURL host "${host}" is a literal loopback/link-local/private IP and is blocked.`
      )
   }

   return url
}

// Returns the dotted-quad IPv4 embedded in a v4-mapped (::ffff:a.b.c.d) IPv6
// address, or null otherwise. Handles both the dotted (::ffff:127.0.0.1) and
// pure-hex (::ffff:7f00:1) forms. v4-compatible (::a.b.c.d) is deliberately
// NOT decoded, because that would misclassify ::1 (loopback) as 0.0.0.1.
function extractEmbeddedV4(v6Host: string): string | null {
   const dotted = v6Host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
   if (dotted) return dotted[1]

   // Pure-hex v4-mapped: ::ffff:XXXX:YYYY. Expand the single :: and split into
   // 16-bit groups; require the first 5 groups == 0 and group[5] == 0xffff.
   if (!v6Host.includes('::')) return null
   const [headPart, tailPart] = v6Host.split('::')
   const head = headPart ? headPart.split(':') : []
   const tail = tailPart ? tailPart.split(':') : []
   const fillCount = 8 - head.length - tail.length
   if (fillCount < 0) return null
   const groups = [...head, ...Array(fillCount).fill('0'), ...tail]
   if (groups.length !== 8) return null
   const ints = groups.map((g) => Number.parseInt(g, 16))
   if (ints.some((n) => Number.isNaN(n))) return null

   if (!ints.slice(0, 5).every((n) => n === 0)) return null
   if (ints[5] !== 0xffff) return null

   const a = (ints[6] >> 8) & 0xff
   const b = ints[6] & 0xff
   const c = (ints[7] >> 8) & 0xff
   const d = ints[7] & 0xff
   return `${a}.${b}.${c}.${d}`
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
   baseURL: string = DEFAULT_KUBECTL_BASE_URL
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
         ? await secureDownload(sourceURL)
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
