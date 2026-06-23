import * as os from 'os'
import * as util from 'util'
import * as fs from 'fs'
import * as core from '@actions/core'
import * as toolCache from '@actions/tool-cache'
export function getKubectlArch(): string {
   const arch = os.arch()
   if (arch === 'x64') {
      return 'amd64'
   }
   return arch
}

export function getkubectlDownloadURL(version: string, arch: string): string {
   switch (os.type()) {
      case 'Linux':
         return `https://dl.k8s.io/release/${version}/bin/linux/${arch}/kubectl`

      case 'Darwin':
         return `https://dl.k8s.io/release/${version}/bin/darwin/${arch}/kubectl`

      case 'Windows_NT':
      default:
         return `https://dl.k8s.io/release/${version}/bin/windows/${arch}/kubectl.exe`
   }
}

export async function getLatestPatchVersion(
   major: string,
   minor: string
): Promise<string> {
   const version = `${major}.${minor}`
   const sourceURL = `https://dl.k8s.io/release/stable-${version}.txt`
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

export function parseToolVersionsFile(filePath: string): string {
   const content = fs.readFileSync(filePath, 'utf8').toString()
   for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || trimmed === '') continue
      const [tool, version] = trimmed.split(/\s+/)
      if (tool === 'kubectl' && version) {
         return version
      }
   }
   throw new Error(
      `Could not find a kubectl entry in tool-versions file: ${filePath}`
   )
}
