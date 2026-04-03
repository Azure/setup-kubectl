import {vi, describe, test, expect, beforeEach} from 'vitest'
import * as path from 'path'
import * as util from 'util'

vi.mock('os')
vi.mock('fs')
vi.mock('@actions/tool-cache', async (importOriginal) => {
   const actual = await importOriginal<typeof import('@actions/tool-cache')>()
   return {
      ...actual,
      downloadTool: vi.fn(),
      find: vi.fn(),
      cacheFile: vi.fn()
   }
})
vi.mock('@actions/core')

const os = await import('os')
const fs = await import('fs')
const toolCache = await import('@actions/tool-cache')
const core = await import('@actions/core')
const run = await import('./run.js')
const {
   getkubectlDownloadURL,
   getKubectlArch,
   getExecutableExtension,
   getLatestPatchVersion
} = await import('./helpers.js')

describe('Testing all functions in run file.', () => {
   beforeEach(() => {
      vi.clearAllMocks()
   })
   test('getExecutableExtension() - return .exe when os is Windows', () => {
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      expect(getExecutableExtension()).toBe('.exe')
      expect(os.type).toHaveBeenCalled()
   })
   test('getExecutableExtension() - return empty string for non-windows OS', () => {
      vi.mocked(os.type).mockReturnValue('Darwin')
      expect(getExecutableExtension()).toBe('')
      expect(os.type).toHaveBeenCalled()
   })
   test.each([
      ['arm', 'arm'],
      ['arm64', 'arm64'],
      ['x64', 'amd64']
   ])(
      'getKubectlArch() - return on %s os arch %s kubectl arch',
      (osArch, kubectlArch) => {
         vi.mocked(os.arch).mockReturnValue(osArch as NodeJS.Architecture)
         expect(getKubectlArch()).toBe(kubectlArch)
         expect(os.arch).toHaveBeenCalled()
      }
   )
   test.each([['arm'], ['arm64'], ['amd64']])(
      'getkubectlDownloadURL() - return the URL to download %s kubectl for Linux',
      (arch) => {
         vi.mocked(os.type).mockReturnValue('Linux')
         const kubectlLinuxUrl = util.format(
            'https://dl.k8s.io/release/v1.15.0/bin/linux/%s/kubectl',
            arch
         )
         expect(getkubectlDownloadURL('v1.15.0', arch)).toBe(kubectlLinuxUrl)
         expect(os.type).toHaveBeenCalled()
      }
   )
   test.each([['arm'], ['arm64'], ['amd64']])(
      'getkubectlDownloadURL() - return the URL to download %s kubectl for Darwin',
      (arch) => {
         vi.mocked(os.type).mockReturnValue('Darwin')
         const kubectlDarwinUrl = util.format(
            'https://dl.k8s.io/release/v1.15.0/bin/darwin/%s/kubectl',
            arch
         )
         expect(getkubectlDownloadURL('v1.15.0', arch)).toBe(kubectlDarwinUrl)
         expect(os.type).toHaveBeenCalled()
      }
   )
   test.each([['arm'], ['arm64'], ['amd64']])(
      'getkubectlDownloadURL() - return the URL to download %s kubectl for Windows',
      (arch) => {
         vi.mocked(os.type).mockReturnValue('Windows_NT')
         const kubectlWindowsUrl = util.format(
            'https://dl.k8s.io/release/v1.15.0/bin/windows/%s/kubectl.exe',
            arch
         )
         expect(getkubectlDownloadURL('v1.15.0', arch)).toBe(kubectlWindowsUrl)
         expect(os.type).toHaveBeenCalled()
      }
   )
   test('getStableKubectlVersion() - download stable version file, read version and return it', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.20.4')
      expect(await run.getStableKubectlVersion()).toBe('v1.20.4')
      expect(toolCache.downloadTool).toHaveBeenCalled()
      expect(fs.readFileSync).toHaveBeenCalledWith('pathToTool', 'utf8')
   })
   test('getStableKubectlVersion() - return default v1.15.0 if version read is empty', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('')
      expect(await run.getStableKubectlVersion()).toBe('v1.15.0')
      expect(toolCache.downloadTool).toHaveBeenCalled()
      expect(fs.readFileSync).toHaveBeenCalledWith('pathToTool', 'utf8')
   })
   test('getStableKubectlVersion() - return default v1.15.0 if unable to download file', async () => {
      vi.mocked(toolCache.downloadTool).mockRejectedValue('Unable to download.')
      expect(await run.getStableKubectlVersion()).toBe('v1.15.0')
      expect(toolCache.downloadTool).toHaveBeenCalled()
   })
   test('downloadKubectl() - download kubectl, add it to toolCache and return path to it', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      expect(await run.downloadKubectl('v1.15.0')).toBe(
         path.join('pathToCachedTool', 'kubectl.exe')
      )
      expect(toolCache.find).toHaveBeenCalledWith('kubectl', 'v1.15.0')
      expect(toolCache.downloadTool).toHaveBeenCalled()
      expect(toolCache.cacheFile).toHaveBeenCalled()
      expect(os.type).toHaveBeenCalled()
      expect(fs.chmodSync).toHaveBeenCalledWith(
         path.join('pathToCachedTool', 'kubectl.exe'),
         '775'
      )
   })
   test('downloadKubectl() - throw DownloadKubectlFailed error when unable to download kubectl', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockRejectedValue(
         'Unable to download kubectl.'
      )
      await expect(run.downloadKubectl('v1.15.0')).rejects.toThrow(
         'DownloadKubectlFailed'
      )
      expect(toolCache.find).toHaveBeenCalledWith('kubectl', 'v1.15.0')
      expect(toolCache.downloadTool).toHaveBeenCalled()
   })
   test('downloadKubectl() - throw kubectl not found error when receive 404 response', async () => {
      const kubectlVersion = 'v1.15.0'
      const arch = 'arm128'
      vi.mocked(os.arch).mockReturnValue(arch as NodeJS.Architecture)
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockImplementation((_) => {
         throw new toolCache.HTTPError(404)
      })
      await expect(run.downloadKubectl(kubectlVersion)).rejects.toThrow(
         util.format(
            "Kubectl '%s' for '%s' arch not found.",
            kubectlVersion,
            arch
         )
      )
      expect(os.arch).toHaveBeenCalled()
      expect(toolCache.find).toHaveBeenCalledWith('kubectl', kubectlVersion)
      expect(toolCache.downloadTool).toHaveBeenCalled()
   })
   test('downloadKubectl() - return path to existing cache of kubectl', async () => {
      vi.mocked(core.getInput).mockImplementation(() => 'v1.15.5')
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      expect(await run.downloadKubectl('v1.15.0')).toBe(
         path.join('pathToCachedTool', 'kubectl.exe')
      )
      expect(toolCache.find).toHaveBeenCalledWith('kubectl', 'v1.15.0')
      expect(os.type).toHaveBeenCalled()
      expect(fs.chmodSync).toHaveBeenCalledWith(
         path.join('pathToCachedTool', 'kubectl.exe'),
         '775'
      )
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
   })
   test('getLatestPatchVersion() - download and return latest patch version', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15')

      const result = await getLatestPatchVersion('1', '27')

      expect(result).toBe('v1.27.15')
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://dl.k8s.io/release/stable-1.27.txt'
      )
   })

   test('getLatestPatchVersion() - throw error when patch version is empty', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('')

      await expect(getLatestPatchVersion('1', '27')).rejects.toThrow(
         'Failed to get latest patch version for 1.27'
      )
   })

   test('getLatestPatchVersion() - throw error when download fails', async () => {
      vi.mocked(toolCache.downloadTool).mockRejectedValue(
         new Error('Network error')
      )

      await expect(getLatestPatchVersion('1', '27')).rejects.toThrow(
         'Failed to get latest patch version for 1.27'
      )
   })
   test('resolveKubectlVersion() - expands major.minor to latest patch', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15')

      const result = await run.resolveKubectlVersion('1.27')
      expect(result).toBe('v1.27.15')
   })

   test('resolveKubectlVersion() - returns full version unchanged', async () => {
      const result = await run.resolveKubectlVersion('v1.27.15')
      expect(result).toBe('v1.27.15')
   })
   test('resolveKubectlVersion() - adds v prefix to full version', async () => {
      const result = await run.resolveKubectlVersion('1.27.15')
      expect(result).toBe('v1.27.15')
   })
   test('resolveKubectlVersion() - expands v-prefixed major.minor to latest patch', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15')

      const result = await run.resolveKubectlVersion('v1.27')
      expect(result).toBe('v1.27.15')
   })
   test('run() - download specified version and set output', async () => {
      vi.mocked(core.getInput).mockReturnValue('v1.15.5')
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.spyOn(console, 'log').mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()
      expect(await run.run()).toBeUndefined()
      expect(core.getInput).toHaveBeenCalledWith('version', {required: true})
      expect(core.addPath).toHaveBeenCalledWith('pathToCachedTool')
      expect(core.setOutput).toHaveBeenCalledWith(
         'kubectl-path',
         path.join('pathToCachedTool', 'kubectl.exe')
      )
   })
   test('run() - get latest version, download it and set output', async () => {
      vi.mocked(core.getInput).mockReturnValue('latest')
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.20.4')
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.spyOn(console, 'log').mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()
      expect(await run.run()).toBeUndefined()
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://dl.k8s.io/release/stable.txt'
      )
      expect(core.getInput).toHaveBeenCalledWith('version', {required: true})
      expect(core.addPath).toHaveBeenCalledWith('pathToCachedTool')
      expect(core.setOutput).toHaveBeenCalledWith(
         'kubectl-path',
         path.join('pathToCachedTool', 'kubectl.exe')
      )
   })
})
