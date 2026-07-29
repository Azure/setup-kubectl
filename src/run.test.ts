import {vi, describe, test, expect, beforeEach, type Mock} from 'vitest'
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
vi.mock('dns', async (importOriginal) => {
   const actual = await importOriginal<typeof import('dns')>()
   return {
      ...actual,
      promises: {...actual.promises, lookup: vi.fn()}
   }
})

const os = await import('os')
const fs = await import('fs')
const dns = await import('dns')
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
   isDefaultBaseURL,
   secureDownload,
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
   headers?: Record<string, string>
}) {
   const body = Readable.from([Buffer.from(opts.body ?? '')])
   const message: any = body
   message.statusCode = opts.status
   message.headers = {
      ...(opts.location ? {location: opts.location} : {}),
      ...(opts.headers ?? {})
   }
   return {message, readBody: async () => opts.body ?? ''}
}

function mockHttpGet(response: ReturnType<typeof fakeHttpResponse>) {
   const get = vi.fn().mockResolvedValue(response)
   ;(httpClient.HttpClient as any).mockImplementation(function () {
      return {get}
   })
   return get
}

// Default DNS lookup result for hostnames in custom-mirror tests: a public IP
// outside every blocked range. Override in individual tests to exercise the
// DNS-resolved SSRF guard.
function mockDnsLookup(addresses: {address: string; family: 4 | 6}[]) {
   vi.mocked(dns.promises.lookup as unknown as Mock).mockResolvedValue(
      addresses
   )
}

// Custom mirrors require a checksum (fail-closed). Tests that fail BEFORE
// verifyChecksum runs only need any 64-char hex to bypass the gate; tests that
// run end-to-end use SHA256_OF_HI together with `fs.readFileSync` mocked to
// return Buffer.from('hi').
const ANY_CHECKSUM = 'a'.repeat(64)
const SHA256_OF_HI =
   '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4'

describe('Testing all functions in run file.', () => {
   beforeEach(() => {
      vi.clearAllMocks()
      // Safe default: any hostname under test (e.g. mirror.example.com) resolves
      // to a public IP. Tests that exercise the DNS-resolved SSRF guard override this.
      mockDnsLookup([{address: '93.184.216.34', family: 4}])
      // Defaults so secureDownload's stream-to-disk path doesn't crash on the
      // auto-mocked fs (openSync default is undefined, writeSync would NPE).
      vi.mocked(fs.openSync).mockReturnValue(3 as never)
      vi.mocked(fs.writeSync).mockReturnValue(0 as never)
      vi.mocked(fs.closeSync).mockImplementation(() => {})
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
      ['https://172.32.0.1'], // outside RFC1918 172.16/12 range
      ['https://fcd.example.com'], // DNS label starting with fc/fd is NOT IPv6 ULA
      ['https://fe89.example.com'] // DNS label starting with fe8-feb is NOT IPv6 link-local
   ])('validateBaseURL() - accepts %s', (input) => {
      expect(() => validateBaseURL(input)).not.toThrow()
   })

   test.each([
      ['https://dl.k8s.io/', true],
      ['https://mirror.example.com', false],
      ['not a url', false]
   ])('isDefaultBaseURL(%s) === %s', (input, expected) => {
      expect(isDefaultBaseURL(input as string)).toBe(expected)
   })

   test.each([
      ['not a url', /not a valid URL/],
      ['http://mirror.example.com', /must use https/],
      ['https://user:pass@mirror.example.com', /userinfo/],
      ['https://127.0.0.1', /loopback\/link-local\/private/],
      ['https://[::1]', /loopback\/link-local\/private/], // caught a real bug
      ['https://169.254.169.254', /loopback\/link-local\/private/], // IMDS
      ['https://10.0.0.5', /loopback\/link-local\/private/], // RFC1918
      ['https://192.168.1.1', /loopback\/link-local\/private/], // RFC1918
      ['https://172.16.0.1', /loopback\/link-local\/private/], // RFC1918 low edge
      ['https://172.31.255.254', /loopback\/link-local\/private/], // RFC1918 high edge
      ['https://[fd00::1]', /loopback\/link-local\/private/], // IPv6 ULA
      ['https://[fc00::1]', /loopback\/link-local\/private/], // IPv6 ULA
      ['https://[fe80::1]', /loopback\/link-local\/private/], // IPv6 link-local
      ['https://0.0.0.0', /loopback\/link-local\/private/], // unspecified v4
      ['https://[::]', /loopback\/link-local\/private/], // unspecified v6
      // IPv4-mapped IPv6 bypass attempts must be unwrapped and re-checked.
      ['https://[::ffff:127.0.0.1]', /loopback\/link-local\/private/], // v4-mapped loopback
      ['https://[::ffff:169.254.169.254]', /loopback\/link-local\/private/], // v4-mapped IMDS
      ['https://[::ffff:10.0.0.5]', /loopback\/link-local\/private/], // v4-mapped RFC1918
      ['https://[::ffff:7f00:1]', /loopback\/link-local\/private/] // v4-mapped loopback (pure-hex form)
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
      const get = mockHttpGet(fakeHttpResponse({status: 200, body: 'v1.20.4'}))
      vi.mocked(os.tmpdir).mockReturnValue('/tmp')
      vi.mocked(fs.writeFileSync).mockImplementation(() => {})
      vi.mocked(fs.readFileSync).mockReturnValue('v1.20.4')
      expect(
         await run.getStableKubectlVersion('https://mirror.example.com')
      ).toBe('v1.20.4')
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
      expect(get).toHaveBeenCalledWith(
         'https://mirror.example.com/release/stable.txt',
         undefined
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
   test('getStableKubectlVersion() - custom mirror failure is fatal (no silent fallback)', async () => {
      // secureDownload rejects; default-URL fallback to v1.15.0 must NOT apply
      // to a custom mirror, otherwise the real misconfiguration is hidden.
      mockHttpGet(fakeHttpResponse({status: 500}))
      await expect(
         run.getStableKubectlVersion('https://mirror.example.com')
      ).rejects.toThrow(/Failed to fetch stable\.txt/)
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

   test('downloadKubectl() - custom mirror: rejects 3xx redirect to non-https / blocked host (SSRF guard)', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      mockHttpGet(
         fakeHttpResponse({
            status: 302,
            location: 'http://169.254.169.254/latest/meta-data/'
         })
      )
      // Redirect target fails baseURL re-validation (http://, and literal link-local IP),
      // so the underlying validation error must surface (not a generic "DownloadKubectlFailed").
      await expect(
         run.downloadKubectl(
            'v1.15.0',
            'https://mirror.example.com',
            ANY_CHECKSUM
         )
      ).rejects.toThrow(/must use https|loopback\/link-local\/private/)
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - custom mirror: rejects when hostname resolves to blocked IP (DNS-resolved SSRF guard)', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      // Attacker-controlled DNS: a public-looking hostname pointed at IMDS.
      mockDnsLookup([{address: '169.254.169.254', family: 4}])
      const get = mockHttpGet(fakeHttpResponse({status: 200, body: 'x'}))

      await expect(
         run.downloadKubectl(
            'v1.15.0',
            'https://attacker.example.com',
            ANY_CHECKSUM
         )
      ).rejects.toThrow(/resolved to a blocked address.*169\.254\.169\.254/)
      // Must reject BEFORE issuing the HTTP request.
      expect(get).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - custom mirror: rejects when ANY resolved address is blocked', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      // Mixed result: a public IP AND a private one. Must still reject.
      mockDnsLookup([
         {address: '93.184.216.34', family: 4},
         {address: '10.0.0.5', family: 4}
      ])
      const get = mockHttpGet(fakeHttpResponse({status: 200, body: 'x'}))

      await expect(
         run.downloadKubectl(
            'v1.15.0',
            'https://mixed.example.com',
            ANY_CHECKSUM
         )
      ).rejects.toThrow(/resolved to a blocked address.*10\.0\.0\.5/)
      expect(get).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - custom mirror: rejects when redirect hop resolves to blocked IP', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')

      // Hop 1: mirror.example.com (public) -> 302 to evil.example.com.
      // Hop 2: evil.example.com resolves to a private IP.
      const lookup = vi.mocked(dns.promises.lookup as unknown as Mock)
      lookup
         .mockResolvedValueOnce([{address: '93.184.216.34', family: 4}])
         .mockResolvedValueOnce([{address: '10.0.0.5', family: 4}])

      const get = vi
         .fn()
         .mockResolvedValueOnce(
            fakeHttpResponse({
               status: 302,
               location: 'https://evil.example.com/kubectl'
            })
         )
         .mockResolvedValueOnce(fakeHttpResponse({status: 200, body: 'x'}))
      ;(httpClient.HttpClient as unknown as Mock).mockImplementation(
         function () {
            return {get}
         }
      )

      await expect(
         run.downloadKubectl(
            'v1.15.0',
            'https://mirror.example.com',
            ANY_CHECKSUM
         )
      ).rejects.toThrow(/resolved to a blocked address.*10\.0\.0\.5/)
      // First request reaches the mirror; second (to evil.example.com) must be blocked
      // by the DNS guard before the HTTP call goes out.
      expect(get).toHaveBeenCalledTimes(1)
   })

   test('downloadKubectl() - custom mirror: non-200/non-404 (500) fails', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      mockHttpGet(fakeHttpResponse({status: 500}))
      // 500 surfaces as the underlying HTTPError so users get a useful failure mode.
      await expect(
         run.downloadKubectl(
            'v1.15.0',
            'https://mirror.example.com',
            ANY_CHECKSUM
         )
      ).rejects.toThrow(/500/)
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - custom mirror: 404 maps to "not found"', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      const arch = 'amd64'
      vi.mocked(os.arch).mockReturnValue('x64')
      mockHttpGet(fakeHttpResponse({status: 404}))
      await expect(
         run.downloadKubectl(
            'v1.15.0',
            'https://mirror.example.com',
            ANY_CHECKSUM
         )
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
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      mockHttpGet(fakeHttpResponse({status: 200, body: 'kubectl-bytes'}))

      await expect(
         run.downloadKubectl(
            'v1.15.0',
            'https://mirror.example.com',
            SHA256_OF_HI
         )
      ).resolves.toBe(path.join('pathToCachedTool', 'kubectl'))
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
      expect(toolCache.cacheFile).toHaveBeenCalled()
      // Assert the body actually streamed to a temp file (openSync + writeSync,
      // not buffered via writeFileSync).
      const openPath = String(vi.mocked(fs.openSync).mock.calls[0][0])
      expect(openPath).toMatch(/[/\\]kubectl-[0-9a-f-]+$/)
      const writeChunk = vi.mocked(fs.writeSync).mock.calls[0][1] as Buffer
      expect(writeChunk.toString()).toBe('kubectl-bytes')
      expect(fs.writeFileSync).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - custom mirror: rejects oversized Content-Length up front', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      mockHttpGet(
         fakeHttpResponse({
            status: 200,
            body: 'unused',
            headers: {'content-length': String(1024 * 1024 * 1024)} // 1 GiB
         })
      )
      await expect(
         run.downloadKubectl(
            'v1.15.0',
            'https://mirror.example.com',
            ANY_CHECKSUM
         )
      ).rejects.toThrow(/Content-Length/)
      expect(toolCache.cacheFile).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - cache key is scoped per non-default baseURL', async () => {
      // Default URL must use the bare version as the cache key (existing user caches stay valid).
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      await run.downloadKubectl('v1.15.0', DEFAULT_KUBECTL_BASE_URL)
      expect(toolCache.find).toHaveBeenLastCalledWith('kubectl', 'v1.15.0')

      // Custom mirror must derive a distinct, deterministic suffixed key.
      await run.downloadKubectl(
         'v1.15.0',
         'https://mirror.example.com',
         SHA256_OF_HI
      )
      const customKey = vi.mocked(toolCache.find).mock.lastCall?.[1]
      expect(customKey).toMatch(/^v1\.15\.0-[0-9a-f]{12}$/)
      expect(customKey).not.toBe('v1.15.0')

      // A different mirror must produce a different key (otherwise cache poisoning is back).
      await run.downloadKubectl(
         'v1.15.0',
         'https://other-mirror.example.com',
         SHA256_OF_HI
      )
      const otherKey = vi.mocked(toolCache.find).mock.lastCall?.[1]
      expect(otherKey).not.toBe(customKey)
   })

   test('downloadKubectl() - custom mirror: temp file is unlinked after caching', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(os.tmpdir).mockReturnValue('/tmp')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      vi.mocked(fs.unlinkSync).mockImplementation(() => {})
      mockHttpGet(fakeHttpResponse({status: 200, body: 'kubectl-bytes'}))

      await run.downloadKubectl(
         'v1.15.0',
         'https://mirror.example.com',
         SHA256_OF_HI
      )

      // The same temp path opened by secureDownload must be unlinked afterwards.
      const openPath = String(vi.mocked(fs.openSync).mock.calls[0][0])
      expect(openPath).toMatch(/[/\\]kubectl-[0-9a-f-]+$/)
      expect(fs.unlinkSync).toHaveBeenCalledWith(openPath)
   })

   test('downloadKubectl() - custom mirror: temp file is unlinked even on checksum mismatch', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(os.tmpdir).mockReturnValue('/tmp')
      vi.mocked(fs.writeFileSync).mockImplementation(() => {})
      vi.mocked(fs.unlinkSync).mockImplementation(() => {})
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      mockHttpGet(fakeHttpResponse({status: 200, body: 'hi'}))

      const wrong = 'a'.repeat(64)
      await expect(
         run.downloadKubectl('v1.15.0', 'https://mirror.example.com', wrong)
      ).rejects.toThrow(/Checksum mismatch/)
      expect(fs.unlinkSync).toHaveBeenCalled()
   })

   test('downloadKubectl() - custom mirror: forwards Authorization header when authToken provided', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(os.tmpdir).mockReturnValue('/tmp')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      const get = mockHttpGet(
         fakeHttpResponse({status: 200, body: 'kubectl-bytes'})
      )

      await run.downloadKubectl(
         'v1.15.0',
         'https://mirror.example.com',
         SHA256_OF_HI,
         's3cr3t-token'
      )

      expect(get).toHaveBeenCalledWith(
         expect.any(String),
         expect.objectContaining({Authorization: 'Bearer s3cr3t-token'})
      )
   })

   test('downloadKubectl() - custom mirror: strips Authorization on cross-origin redirect', async () => {
      vi.mocked(toolCache.find).mockReturnValue('')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(os.tmpdir).mockReturnValue('/tmp')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)

      // Sequential responses: mirror.example.com -> 302 -> cdn.example.com -> 200.
      const get = vi
         .fn()
         .mockResolvedValueOnce(
            fakeHttpResponse({
               status: 302,
               location: 'https://cdn.example.com/v1.15.0/kubectl'
            })
         )
         .mockResolvedValueOnce(
            fakeHttpResponse({status: 200, body: 'kubectl-bytes'})
         )
      ;(httpClient.HttpClient as unknown as Mock).mockImplementation(
         function () {
            return {get}
         }
      )

      await run.downloadKubectl(
         'v1.15.0',
         'https://mirror.example.com',
         SHA256_OF_HI,
         's3cr3t-token'
      )

      // First hop: header present (same origin).
      expect(get.mock.calls[0][1]).toEqual({
         Authorization: 'Bearer s3cr3t-token'
      })
      // Second hop: cross-origin, header must be undefined (NOT just missing-Authorization).
      expect(get.mock.calls[1][0]).toBe(
         'https://cdn.example.com/v1.15.0/kubectl'
      )
      expect(get.mock.calls[1][1]).toBeUndefined()
   })

   test('run() - downloadAuthToken with default baseURL is rejected', async () => {
      mockInputs({
         version: 'v1.15.5',
         downloadAuthToken: 'leaky-token'
      })
      vi.mocked(core.setSecret).mockImplementation(() => {})

      await expect(run.run()).rejects.toThrow(
         /downloadAuthToken.*default.*Refusing/
      )
      expect(core.setSecret).toHaveBeenCalledWith('leaky-token')
   })

   test('run() - downloadAuthToken is registered as a secret before use', async () => {
      mockInputs({
         version: 'v1.15.5',
         downloadBaseURL: 'https://mirror.example.com',
         downloadAuthToken: 'super-secret',
         // Custom mirror now requires a checksum (fail-closed).
         checksum:
            '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4'
      })
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(fs.chmodSync).mockImplementation(() => {})
      vi.mocked(core.setSecret).mockImplementation(() => {})
      vi.mocked(core.addPath).mockImplementation(() => {})
      vi.mocked(core.setOutput).mockImplementation(() => {})

      await run.run()
      expect(core.setSecret).toHaveBeenCalledWith('super-secret')
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
      const get = mockHttpGet(fakeHttpResponse({status: 200, body: 'v1.27.15'}))
      vi.mocked(os.tmpdir).mockReturnValue('/tmp')
      vi.mocked(fs.writeFileSync).mockImplementation(() => {})
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15')
      expect(
         await getLatestPatchVersion('1', '27', 'https://mirror.example.com')
      ).toBe('v1.27.15')
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
      expect(get).toHaveBeenCalledWith(
         'https://mirror.example.com/release/stable-1.27.txt',
         undefined
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
      // sha256('hi') = 8f43...aa4 — fs.readFileSync mock returns Buffer.from('hi')
      // both for the stable.txt body and for the post-cache binary verify.
      const correctSha =
         '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4'
      mockInputs({
         version: 'latest',
         downloadBaseURL: 'https://mirror.example.com',
         checksum: correctSha
      })
      const get = mockHttpGet(fakeHttpResponse({status: 200, body: 'v1.20.4'}))
      vi.mocked(os.tmpdir).mockReturnValue('/tmp')
      vi.mocked(fs.writeFileSync).mockImplementation(() => {})
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('hi') as never)
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Windows_NT')
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()

      await expect(run.run()).resolves.toBeUndefined()
      // The fix: stable.txt comes from the custom mirror via secureDownload,
      // not toolCache.downloadTool (which would follow redirects).
      expect(get).toHaveBeenCalledWith(
         'https://mirror.example.com/release/stable.txt',
         undefined
      )
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
      // Audit notice fires for any non-default base URL.
      expect(core.notice).toHaveBeenCalledWith(
         expect.stringContaining('https://mirror.example.com')
      )
      // Checksum supplied => no warning.
      expect(core.warning).not.toHaveBeenCalled()
   })

   test('run() - custom mirror without checksum is rejected (fail closed)', async () => {
      mockInputs({
         version: 'v1.15.5',
         downloadBaseURL: 'https://mirror.example.com'
      })
      await expect(run.run()).rejects.toThrow(
         /Refusing to download.*without a `checksum`/
      )
      // Hard fail must not even attempt a network request.
      expect(toolCache.downloadTool).not.toHaveBeenCalled()
      expect(httpClient.HttpClient).not.toHaveBeenCalled()
   })

   test('run() - empty/whitespace downloadBaseURL falls back to default', async () => {
      mockInputs({version: 'v1.15.5', downloadBaseURL: '   '})
      vi.mocked(toolCache.find).mockReturnValue('') // force a real download path
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToTool')
      vi.mocked(toolCache.cacheFile).mockResolvedValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()

      await expect(run.run()).resolves.toBeUndefined()
      // Whitespace must collapse to the default URL, which uses toolCache (not secureDownload).
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         expect.stringContaining('https://dl.k8s.io/')
      )
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

   test('downloadKubectl() - direct call with custom mirror and no checksum is rejected (fail closed)', async () => {
      // Belt-and-suspenders: run() guards this too, but downloadKubectl is
      // exported and reachable. Ensure the gate fires here as well, before
      // any network/cache work happens.
      vi.mocked(toolCache.find).mockReturnValue('')
      await expect(
         run.downloadKubectl('v1.15.0', 'https://mirror.example.com', '')
      ).rejects.toThrow(/Refusing to download.*without a `checksum`/)
      expect(toolCache.find).not.toHaveBeenCalled()
      expect(httpClient.HttpClient).not.toHaveBeenCalled()
   })

   test('downloadKubectl() - rejects malformed downloadBaseURL with a clear message', async () => {
      // The SAME validateBaseURL error surfaces from run() AND from a direct
      // downloadKubectl call — no generic URL parse leak.
      await expect(
         run.downloadKubectl('v1.15.0', 'not a url', ANY_CHECKSUM)
      ).rejects.toThrow(/Invalid downloadBaseURL/)
   })

   test('secureDownload() - undefined HTTP status surfaces a clear error (not HTTPError(undefined))', async () => {
      // If the network/TLS layer fails such that no statusCode is set, we must
      // throw a descriptive error — not toolCache.HTTPError(undefined), which
      // produces "Unexpected HTTP response: undefined".
      mockHttpGet(fakeHttpResponse({status: undefined as unknown as number}))
      await expect(
         secureDownload('https://mirror.example.com/kubectl')
      ).rejects.toThrow(/no HTTP status returned/)
   })

   test('run() - whitespace + mixed case "Latest" is treated as latest', async () => {
      mockInputs({version: '  Latest  '})
      vi.mocked(toolCache.find).mockReturnValue('pathToCachedTool')
      vi.mocked(os.type).mockReturnValue('Linux')
      vi.mocked(os.arch).mockReturnValue('x64')
      vi.mocked(fs.chmodSync).mockImplementation()
      vi.mocked(core.addPath).mockImplementation()
      vi.mocked(core.setOutput).mockImplementation()
      // stable.txt download via toolCache (default base URL).
      vi.mocked(toolCache.downloadTool).mockResolvedValue('pathToStableTxt')
      vi.mocked(fs.readFileSync).mockReturnValue('v1.27.15' as never)

      await expect(run.run()).resolves.toBeUndefined()
      // Must have routed through getStableKubectlVersion (toolCache.downloadTool
      // for stable.txt), not treated " Latest " as a literal version.
      expect(toolCache.downloadTool).toHaveBeenCalledWith(
         expect.stringContaining('stable.txt')
      )
      // And the resolved version must be cached/looked up under v1.27.15.
      expect(toolCache.find).toHaveBeenCalledWith('kubectl', 'v1.27.15')
   })
})
