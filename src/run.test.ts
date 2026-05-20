import {vi, describe, test, expect, beforeEach} from 'vitest'
import * as path from 'path'
import * as util from 'util'
import {Readable} from 'stream'

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
vi.mock('@actions/http-client', () => {
   const get = vi.fn()
   return {
      HttpClient: vi.fn().mockImplementation(function () {
         return {get}
      })
   }
})

const os = await import('os')
const fs = await import('fs')
const toolCache = await import('@actions/tool-cache')
const core = await import('@actions/core')
const httpClient = await import('@actions/http-client')
const run = await import('./run.js')
const {
   DEFAULT_KUBECTL_BASE_URL,
   getkubectlDownloadURL,
   getKubectlArch,
   getExecutableExtension,
   getLatestPatchVersion,
   validateBaseURL,
   validateVersion
} = await import('./helpers.js')

function mockInputs(inputs: Record<string, string>) {
   vi.mocked(core.getInput).mockImplementation(
      (name: string) => inputs[name] ?? ''
   )
}

function fakeHttpResponse(opts: {
   status: number
   body?: string
   location?: string
}) {
   const body = Readable.from([Buffer.from(opts.body ?? '')])
   const message: any = body
   message.statusCode = opts.status
   message.headers = opts.location ? {location: opts.location} : {}
   return {message, readBody: async () => opts.body ?? ''}
}

function mockHttpGet(response: ReturnType<typeof fakeHttpResponse>) {
   ;(httpClient.HttpClient as any).mockImplementation(function () {
      return {get: vi.fn().mockResolvedValue(response)}
   })
}

describe('Testing all functions in run file.', () => {
   beforeEach(() => {
      vi.clearAllMocks()
   })

   test('getExecutableExtension() - return .exe when os is Windows', () => {
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      expect(getExecutableExtension()).toBe('.exe')
   })
   test('getExecutableExtension() - return empty string for non-windows OS', () => {
      vi.mocked(os.type).mockReturnValue('Darwin')
      expect(getExecutableExtension()).toBe('')
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
      }
   )

   test.each([['arm'], ['arm64'], ['amd64']])(
      'getkubectlDownloadURL() - default base URL, Linux %s',
      (arch) => {
         vi.mocked(os.type).mockReturnValue('Linux')
         const expected = util.format(
            'https://dl.k8s.io/release/v1.15.0/bin/linux/%s/kubectl',
            arch
         )
         expect(getkubectlDownloadURL('v1.15.0', arch)).toBe(expected)
      }
   )
   test.each([['arm'], ['arm64'], ['amd64']])(
      'getkubectlDownloadURL() - default base URL, Darwin %s',
      (arch) => {
         vi.mocked(os.type).mockReturnValue('Darwin')
         const expected = util.format(
            'https://dl.k8s.io/release/v1.15.0/bin/darwin/%s/kubectl',
            arch
         )
         expect(getkubectlDownloadURL('v1.15.0', arch)).toBe(expected)
      }
   )
   test.each([['arm'], ['arm64'], ['amd64']])(
      'getkubectlDownloadURL() - default base URL, Windows %s',
      (arch) => {
         vi.mocked(os.type).mockReturnValue('Windows_NT')
         const expected = util.format(
            'https://dl.k8s.io/release/v1.15.0/bin/windows/%s/kubectl.exe',
            arch
         )
         expect(getkubectlDownloadURL('v1.15.0', arch)).toBe(expected)
      }
   )

   test('getkubectlDownloadURL() - custom base URL', () => {
      vi.mocked(os.type).mockReturnValue('Linux')
      expect(
         getkubectlDownloadURL('v1.15.0', 'amd64', 'https://mirror.example.com')
      ).toBe(
         'https://mirror.example.com/release/v1.15.0/bin/linux/amd64/kubectl'
      )
   })
   test('getkubectlDownloadURL() - strips trailing slash from base URL', () => {
      vi.mocked(os.type).mockReturnValue('Darwin')
      expect(
         getkubectlDownloadURL(
            'v1.15.0',
            'arm64',
            'https://mirror.example.com/'
         )
      ).toBe(
         'https://mirror.example.com/release/v1.15.0/bin/darwin/arm64/kubectl'
      )
   })
   test('getkubectlDownloadURL() - base URL with path prefix', () => {
      vi.mocked(os.type).mockReturnValue('Linux')
      expect(
         getkubectlDownloadURL(
            'v1.30.0',
            'amd64',
            'https://mirror.example.com/k8s'
         )
      ).toBe(
         'https://mirror.example.com/k8s/release/v1.30.0/bin/linux/amd64/kubectl'
      )
   })

   test.each([
      ['https://mirror.example.com'],
      ['https://mirror.example.com:8443'], // non-standard port
      ['https://172.32.0.1'] // outside RFC1918 172.16/12 range
   ])('validateBaseURL() - accepts %s', (input) => {
      expect(() => validateBaseURL(input)).not.toThrow()
   })

   test.each([
      ['not a url', /not a valid URL/],
      ['http://mirror.example.com', /must use https/],
      ['https://user:pass@mirror.example.com', /userinfo/],
      ['https://localhost', /loopback\/link-local\/private/],
      ['https://127.0.0.1', /loopback\/link-local\/private/],
      ['https://[::1]', /loopback\/link-local\/private/], // caught a real bug
      ['https://169.254.169.254', /loopback\/link-local\/private/], // IMDS
      ['https://10.0.0.5', /loopback\/link-local\/private/], // RFC1918
      ['https://192.168.1.1', /loopback\/link-local\/private/], // RFC1918
      ['https://172.16.0.1', /loopback\/link-local\/private/], // RFC1918 low edge
      ['https://172.31.255.254', /loopback\/link-local\/private/] // RFC1918 high edge
   ])('validateBaseURL() - rejects %s', (input, expected) => {
      expect(() => validateBaseURL(input)).toThrow(expected)
   })

   test.each([['v1.30.0'], ['1.30.0']])(
      'validateVersion() - accepts %s',
      (input) => {
         expect(() => validateVersion(input)).not.toThrow()
      }
   )

   test.each([
      [''],
      ['v1.30.0\n'], // trailing newline
      ['v1.2.3.4'], // extra segment
      [' v1.30.0'] // leading whitespace
   ])('validateVersion() - rejects %s', (input) => {
      expect(() => validateVersion(input)).toThrow(/Invalid kubectl version/)
   })

   test('getStableKubectlVersion() - default base URL', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.20.4')
      expect(await run.getStableKubectlVersion()).toBe('v1.20.4')
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://dl.k8s.io/release/stable.txt'
      )
   })
   test('getStableKubectlVersion() - honours custom base URL (air-gap fix)', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.20.4')
      expect(
         await run.getStableKubectlVersion('https://mirror.example.com')
      ).toBe('v1.20.4')
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://mirror.example.com/release/stable.txt'
      )
   })
   test('getStableKubectlVersion() - path-prefixed mirror composes correctly', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.20.4')
      await run.getStableKubectlVersion('https://mirror.example.com/k8s/')
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://mirror.example.com/k8s/release/stable.txt'
      )
   })
   test('getStableKubectlVersion() - falls back to v1.15.0 on empty file', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('')
      expect(await run.getStableKubectlVersion()).toBe('v1.15.0')
   })
   test('getStableKubectlVersion() - falls back to v1.15.0 on download failure', async () => {
      vi.mocked(toolCache.downloadTool).mockRejectedValue('Unable to download.')
      expect(await run.getStableKubectlVersion()).toBe('v1.15.0')
   })

   test('downloadKubectl() - download and cache, default base URL', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      expect(await run.downloadKubectl('v1.15.0')).toBe(
         path.join('pathToCachedTool', 'kubectl.exe')
      )
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://dl.k8s.io/release/v1.15.0/bin/windows/amd64/kubectl.exe'
      )
   })
   test('downloadKubectl() - rejects invalid version (path traversal)', async () => {
      await expect(run.downloadKubectl('../etc')).rejects.toThrow(
         /Invalid kubectl version/
      )
   })
   test('downloadKubectl() - throws DownloadKubectlFailed on generic error', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockRejectedValue('boom')
      await expect(run.downloadKubectl('v1.15.0')).rejects.toThrow(
         'DownloadKubectlFailed'
      )
   })
   test('downloadKubectl() - 404 maps to "not found" message', async () => {
      const kubectlVersion = 'v1.15.0'
      const arch = 'arm64'
      vi.mocked(os.arch).mockReturnValue(arch as NodeJS.Architecture)
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockImplementation(() => {
         throw new toolCache.HTTPError(404)
      })
      await expect(run.downloadKubectl(kubectlVersion)).rejects.toThrow(
         util.format(
            "Kubectl '%s' for '%s' arch not found.",
            kubectlVersion,
            arch
         )
      )
   })
   test('downloadKubectl() - returns existing cache without redownloading', async () => {
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      expect(await run.downloadKubectl('v1.15.0')).toBe(
         path.join('pathToCachedTool', 'kubectl.exe')
      )
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - rejects malformed checksum input', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      await expect(
         run.downloadKubectl('v1.15.0', DEFAULT_KUBECTL_BASE_URL, 'not-a-hash')
      ).rejects.toThrow(/Invalid checksum input/)
   })
   test('downloadKubectl() - rejects checksum mismatch', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      const wrong = 'a'.repeat(64)
      await expect(
         run.downloadKubectl('v1.15.0', DEFAULT_KUBECTL_BASE_URL, wrong)
      ).rejects.toThrow(/Checksum mismatch/)
   })
   test('downloadKubectl() - accepts matching checksum', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      // sha256('hi') = 8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      const correct =
         '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4'
      await expect(
         run.downloadKubectl('v1.15.0', DEFAULT_KUBECTL_BASE_URL, correct)
      ).resolves.toBe(path.join('pathToCachedTool', 'kubectl'))
   })

   test.each([[301], [302], [307], [308]])(
      'downloadKubectl() - custom mirror: rejects %i redirect (SSRF guard)',
      async (status) => {
         vi.mocked(toolCache.find).mockReturnValue('')
         vi.mocked(os.type).mockReturnValue('Linux')
         vi.mocked(os.arch).mockReturnValue('x64')
         mockHttpGet(
            fakeHttpResponse({
               status,
               location: 'http://169.254.169.254/latest/meta-data/'
            })
         )
         await expect(
            run.downloadKubectl('v1.15.0', 'https://mirror.example.com')
         ).rejects.toThrow('DownloadKubectlFailed')
         expect(toolCache.downloadTool).not.toHaveBeenCalled()
      }
   )

   test('downloadKubectl() - custom mirror: non-200/non-404 (500) fails', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      mockHttpGet(fakeHttpResponse({status: 500}))
      await expect(
         run.downloadKubectl('v1.15.0', 'https://mirror.example.com')
      ).rejects.toThrow('DownloadKubectlFailed')
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - custom mirror: 404 maps to "not found"', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      const arch = 'amd64'
      vi.mocked(os.arch).mockReturnValue('x64')
      mockHttpGet(fakeHttpResponse({status: 404}))
      await expect(
         run.downloadKubectl('v1.15.0', 'https://mirror.example.com')
      ).rejects.toThrow(
         util.format("Kubectl '%s' for '%s' arch not found.", 'v1.15.0', arch)
      )
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - custom mirror: 200 streams body to temp file and caches', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(os.tmpdir).mockReturnValue('/tmp')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      vi.mocked(fs.writeFileSync).mockImplementation(() => {})
      mockHttpGet(fakeHttpResponse({status: 200, body: 'kubectl-bytes'}))

      await expect(
         run.downloadKubectl('v1.15.0', 'https://mirror.example.com')
      ).resolves.toBe(path.join('pathToCachedTool', 'kubectl'))
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
      expect(toolCache.cacheFile).toHaveBeenCalled()
      expect(fs.writeFileSync).toHaveBeenCalled()
   })

   test('getLatestPatchVersion() - default base URL', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15')
      expect(await getLatestPatchVersion('1', '27')).toBe('v1.27.15')
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://dl.k8s.io/release/stable-1.27.txt'
      )
   })
   test('getLatestPatchVersion() - honours custom base URL', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15')
      expect(
         await getLatestPatchVersion('1', '27', 'https://mirror.example.com')
      ).toBe('v1.27.15')
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://mirror.example.com/release/stable-1.27.txt'
      )
   })
   test('getLatestPatchVersion() - path-prefixed mirror composes correctly', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15')
      await getLatestPatchVersion('1', '27', 'https://mirror.example.com/k8s')
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://mirror.example.com/k8s/release/stable-1.27.txt'
      )
   })
   test('getLatestPatchVersion() - throws on empty file', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('')
      await expect(getLatestPatchVersion('1', '27')).rejects.toThrow(
         'Failed to get latest patch version for 1.27'
      )
   })
   test('getLatestPatchVersion() - throws on download failure', async () => {
      vi.mocked(toolCache.downloadTool).mockRejectedValue(new Error('Network'))
      await expect(getLatestPatchVersion('1', '27')).rejects.toThrow(
         'Failed to get latest patch version for 1.27'
      )
   })

   test('resolveKubectlVersion() - expands major.minor', async () => {
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15')
      expect(await run.resolveKubectlVersion('1.27')).toBe('v1.27.15')
   })
   test('resolveKubectlVersion() - returns full version unchanged', async () => {
      expect(await run.resolveKubectlVersion('v1.27.15')).toBe('v1.27.15')
   })
   test('resolveKubectlVersion() - adds v prefix', async () => {
      expect(await run.resolveKubectlVersion('1.27.15')).toBe('v1.27.15')
   })

   test('run() - reads version, downloadBaseURL, checksum inputs; defaults applied', async () => {
      mockInputs({version: 'v1.15.5'})
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()

      await expect(run.run()).resolves.toBeUndefined()
      expect(core.getInput).toHaveBeenCalledWith('version', {required: true})
      expect(core.getInput).toHaveBeenCalledWith('downloadBaseURL', {
         required: false
      })
      expect(core.getInput).toHaveBeenCalledWith('checksum', {required: false})
      // Default base URL: no audit notice should fire.
      expect(core.notice).not.toHaveBeenCalled()
      expect(core.setOutput).toHaveBeenCalledWith(
         'kubectl-path',
         path.join('pathToCachedTool', 'kubectl.exe')
      )
   })

   test('run() - latest + custom mirror routes stable.txt through the mirror', async () => {
      mockInputs({
         version: 'latest',
         downloadBaseURL: 'https://mirror.example.com'
      })
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.20.4')
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()

      await expect(run.run()).resolves.toBeUndefined()
      // The fix: stable.txt comes from the custom mirror, not dl.k8s.io.
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         'https://mirror.example.com/release/stable.txt'
      )
      // Audit notice fires for any non-default base URL.
      expect(core.notice).toHaveBeenCalledWith(
         expect.stringContaining('https://mirror.example.com')
      )
      // No checksum + custom mirror => loud warning.
      expect(core.warning).toHaveBeenCalledWith(
         expect.stringContaining('checksum')
      )
   })

   test('run() - empty/whitespace downloadBaseURL falls back to default', async () => {
      mockInputs({version: 'v1.15.5', downloadBaseURL: '   '})
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()

      await expect(run.run()).resolves.toBeUndefined()
      // Default fallback => no audit notice.
      expect(core.notice).not.toHaveBeenCalled()
   })

   test('run() - invalid downloadBaseURL (http) fails fast', async () => {
      mockInputs({version: 'v1.15.5', downloadBaseURL: 'http://insecure'})
      await expect(run.run()).rejects.toThrow(/must use https/)
   })

   test('run() - uppercase checksum input is normalized and accepted', async () => {
      // sha256('hi') = 8f43...aa4 — supplied uppercase to prove run() lowercases it
      // before validateChecksum's strict /^[a-f0-9]{64}$/ regex sees it.
      const correctLower =
         '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4'
      mockInputs({
         version: 'v1.15.5',
         checksum: correctLower.toUpperCase()
      })
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()

      await expect(run.run()).resolves.toBeUndefined()
   })
})