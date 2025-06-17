import * as run from './run'
import {
   getkubectlDownloadURL,
   getKubectlArch,
   getExecutableExtension
} from './helpers'
import * as os from 'os'
import * as toolCache from '@actions/tool-cache'
import * as fs from 'fs'
import * as path from 'path'
import * as core from '@actions/core'
import * as util from 'util'

describe('Testing all functions in run file.', () => {
   test('getExecutableExtension() - return .exe when os is Windows', () => {
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
      expect(getExecutableExtension()).toBe('.exe')
      expect(os.type).toHaveBeenCalled()
   })
   test('getExecutableExtension() - return empty string for non-windows OS', () => {
      jest.spyOn(os, 'type').mockReturnValue('Darwin')
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
         jest.spyOn(os, 'arch').mockReturnValue(osArch as NodeJS.Architecture)
         expect(getKubectlArch()).toBe(kubectlArch)
         expect(os.arch).toHaveBeenCalled()
      }
   )
   test.each([['arm'], ['arm64'], ['amd64']])(
      'getkubectlDownloadURL() - return the URL to download %s kubectl for Linux',
      (arch) => {
         jest.spyOn(os, 'type').mockReturnValue('Linux')
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
         jest.spyOn(os, 'type').mockReturnValue('Darwin')
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
         jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
         const kubectlWindowsUrl = util.format(
            'https://dl.k8s.io/release/v1.15.0/bin/windows/%s/kubectl.exe',
            arch
         )
         expect(getkubectlDownloadURL('v1.15.0', arch)).toBe(kubectlWindowsUrl)
         expect(os.type).toHaveBeenCalled()
      }
   )
   test('getStableKubectlVersion() - download stable version file, read version and return it', async () => {
      jest
         .spyOn(toolCache, 'downloadTool')
         .mockReturnValue(Promise.resolve('pathToTool'))
      jest.spyOn(fs, 'readFileSync').mockReturnValue('v1.20.4')
      expect(await run.getStableKubectlVersion()).toBe('v1.20.4')
      expect(toolCache.downloadTool).toHaveBeenCalled()
      expect(fs.readFileSync).toHaveBeenCalledWith('pathToTool', 'utf8')
   })
   test('getStableKubectlVersion() - return default v1.15.0 if version read is empty', async () => {
      jest
         .spyOn(toolCache, 'downloadTool')
         .mockReturnValue(Promise.resolve('pathToTool'))
      jest.spyOn(fs, 'readFileSync').mockReturnValue('')
      expect(await run.getStableKubectlVersion()).toBe('v1.15.0')
      expect(toolCache.downloadTool).toHaveBeenCalled()
      expect(fs.readFileSync).toHaveBeenCalledWith('pathToTool', 'utf8')
   })
   test('getStableKubectlVersion() - return default v1.15.0 if unable to download file', async () => {
      jest
         .spyOn(toolCache, 'downloadTool')
         .mockRejectedValue('Unable to download.')
      expect(await run.getStableKubectlVersion()).toBe('v1.15.0')
      expect(toolCache.downloadTool).toHaveBeenCalled()
   })
   test('downloadKubectl() - download kubectl, add it to toolCache and return path to it', async () => {
      jest.spyOn(toolCache, 'find').mockReturnValue('')
      jest
         .spyOn(toolCache, 'downloadTool')
         .mockReturnValue(Promise.resolve('pathToTool'))
      jest
         .spyOn(toolCache, 'cacheFile')
         .mockReturnValue(Promise.resolve('pathToCachedTool'))
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
      jest.spyOn(fs, 'chmodSync').mockImplementation(() => {})
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
      jest.spyOn(toolCache, 'find').mockReturnValue('')
      jest
         .spyOn(toolCache, 'downloadTool')
         .mockRejectedValue('Unable to download kubectl.')
      await expect(run.downloadKubectl('v1.15.0')).rejects.toThrow(
         'DownloadKubectlFailed'
      )
      expect(toolCache.find).toHaveBeenCalledWith('kubectl', 'v1.15.0')
      expect(toolCache.downloadTool).toHaveBeenCalled()
   })
   test('downloadKubectl() - throw kubectl not found error when receive 404 response', async () => {
      const kubectlVersion = 'v1.15.0'
      const arch = 'arm128'
      jest.spyOn(os, 'arch').mockReturnValue(arch as any)
      jest.spyOn(toolCache, 'find').mockReturnValue('')
      jest.spyOn(toolCache, 'downloadTool').mockImplementation((_) => {
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
      jest.spyOn(core, 'getInput').mockImplementation(() => 'v1.15.5')
      jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool')
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
      jest.spyOn(fs, 'chmodSync').mockImplementation(() => {})
      jest.spyOn(toolCache, 'downloadTool')
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
   test('run() - download specified version and set output', async () => {
      jest.spyOn(core, 'getInput').mockReturnValue('v1.15.5')
      jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool')
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
      jest.spyOn(fs, 'chmodSync').mockImplementation()
      jest.spyOn(core, 'addPath').mockImplementation()
      jest.spyOn(console, 'log').mockImplementation()
      jest.spyOn(core, 'setOutput').mockImplementation()
      expect(await run.run()).toBeUndefined()
      expect(core.getInput).toHaveBeenCalledWith('version', {required: true})
      expect(core.addPath).toHaveBeenCalledWith('pathToCachedTool')
      expect(core.setOutput).toHaveBeenCalledWith(
         'kubectl-path',
         path.join('pathToCachedTool', 'kubectl.exe')
      )
   })
   test('run() - get latest version, download it and set output', async () => {
      jest.spyOn(core, 'getInput').mockReturnValue('latest')
      jest
         .spyOn(toolCache, 'downloadTool')
         .mockReturnValue(Promise.resolve('pathToTool'))
      jest.spyOn(fs, 'readFileSync').mockReturnValue('v1.20.4')
      jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool')
      jest.spyOn(os, 'type').mockReturnValue('Windows_NT')
      jest.spyOn(fs, 'chmodSync').mockImplementation()
      jest.spyOn(core, 'addPath').mockImplementation()
      jest.spyOn(console, 'log').mockImplementation()
      jest.spyOn(core, 'setOutput').mockImplementation()
      expect(await run.run()).toBeUndefined()
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://storage.googleapis.com/kubernetes-release/release/stable.txt'
      )
      expect(core.getInput).toHaveBeenCalledWith('version', {required: true})
      expect(core.addPath).toHaveBeenCalledWith('pathToCachedTool')
      expect(core.setOutput).toHaveBeenCalledWith(
         'kubectl-path',
         path.join('pathToCachedTool', 'kubectl.exe')
      )
   })
})
