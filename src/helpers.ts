import * as os from 'os'
import * as fs from 'fs'
import * as core from '@actions/core'
import * as toolCache from '@actions/tool-cache'

export const DEFAULT_KUBECTL_BASE_URL = 'https://dl.k8s.io'

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
   const isLoopback =
      host === 'localhost' || host === '127.0.0.1' || host === '::1'
   const isLinkLocal = host.startsWith('169.254.')
   const isPrivateV4 =
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
   if (isLoopback || isLinkLocal || isPrivateV4) {
      throw new Error(
         `downloadBaseURL host "${host}" is loopback/link-local/private and is blocked by default.`
      )
   }

   return url
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
   try {
      const downloadPath = await toolCache.downloadTool(sourceURL)
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
   }
}

export function getExecutableExtension(): string {
   if (os.type().match(/^Win/)) {
      return '.exe'
   }
   return ''
}
