# Changelog

## [5.2.0] - 2026-10-05

### Added

- #268 [Add custom download URL, checksum verification, and download authentication inputs](https://github.com/Azure/setup-kubectl/pull/268)

### Fixed

- #251 [Add Node.js types for TypeScript 6 compatibility](https://github.com/Azure/setup-kubectl/pull/251)

### Changed

- #267 [Pin the release workflow to a commit SHA](https://github.com/Azure/setup-kubectl/pull/267)
- #252 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/252)
- #253 [Update CI action dependencies](https://github.com/Azure/setup-kubectl/pull/253)
- #254 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/254)
- #255 [Update CodeQL action](https://github.com/Azure/setup-kubectl/pull/255)
- #257 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/257)
- #258 [Update CodeQL action](https://github.com/Azure/setup-kubectl/pull/258)
- #262 [Update Node.js type definitions](https://github.com/Azure/setup-kubectl/pull/262)
- #263 [Update CodeQL action](https://github.com/Azure/setup-kubectl/pull/263)
- #265 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/265)
- #266 [Update CI action dependencies](https://github.com/Azure/setup-kubectl/pull/266)
- #269 [Update Vitest](https://github.com/Azure/setup-kubectl/pull/269)
- #270 [Update Node.js type definitions](https://github.com/Azure/setup-kubectl/pull/270)
- #271 [Update CI action dependencies](https://github.com/Azure/setup-kubectl/pull/271)
- #272 [Update esbuild](https://github.com/Azure/setup-kubectl/pull/272)
- #273 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/273)
- #274 [Update Node.js type definitions](https://github.com/Azure/setup-kubectl/pull/274)
- #275 [Update checkout action](https://github.com/Azure/setup-kubectl/pull/275)
- #281 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/281)
- #282 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/282)
- #284 [Update Prettier](https://github.com/Azure/setup-kubectl/pull/284)
- #285 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/285)
- #287 [Update CI action dependencies](https://github.com/Azure/setup-kubectl/pull/287)
- #293 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/293)
- #294 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/294)
- #295 [Update CI action dependencies](https://github.com/Azure/setup-kubectl/pull/295)
- #299 [Update action dependencies](https://github.com/Azure/setup-kubectl/pull/299)

### Security

- #256 [Update postcss](https://github.com/Azure/setup-kubectl/pull/256)
- #276 [Update undici](https://github.com/Azure/setup-kubectl/pull/276)
- #289 [Update undici](https://github.com/Azure/setup-kubectl/pull/289)
- #290 [Update postcss](https://github.com/Azure/setup-kubectl/pull/290)

## [5.1.0] - 2026-04-11

### Changed

- #243 [Migrate to ESM with esbuild and vitest](https://github.com/Azure/setup-kubectl/pull/243)
   - Replaced `@vercel/ncc` with `esbuild` for ESM bundling
   - Replaced `jest`/`ts-jest` with `vitest` for testing
   - Upgraded `@actions/core` to `^3.0.0`, `@actions/exec` to `^3.0.0`, `@actions/tool-cache` to `^4.0.0`
   - Updated `tsconfig.json` to `NodeNext` module resolution
- Add `npm run build` step to CI unit-tests workflow

### Security

- #242 [Bump picomatch](https://github.com/Azure/setup-kubectl/pull/242)
- #244 [Bump handlebars from 4.7.8 to 4.7.9](https://github.com/Azure/setup-kubectl/pull/244)
- #247 [Bump vite from 8.0.3 to 8.0.5](https://github.com/Azure/setup-kubectl/pull/247)
- #245 [Bump github/codeql-action in CI workflows](https://github.com/Azure/setup-kubectl/pull/245)

## [5.0.0] - 2026-03-25

### Changed

- #233 [Update Node.js runtime from node20 to node24](https://github.com/Azure/setup-kubectl/pull/233)
- #228 [Replace cdn.dl.k8s.io with dl.k8s.io](https://github.com/Azure/setup-kubectl/pull/228)
- #219 [Remove download redirects, use cdn.dl.k8s.io domain](https://github.com/Azure/setup-kubectl/pull/219)
- #190 [Update stableVersionUrl to dl.k8s.io](https://github.com/Azure/setup-kubectl/pull/190)
- #235 [Bump undici from 6.23.0 to 6.24.1](https://github.com/Azure/setup-kubectl/pull/235)
- #226 [Bump undici and @actions/http-client](https://github.com/Azure/setup-kubectl/pull/226)
- #230 [Bump minimatch](https://github.com/Azure/setup-kubectl/pull/230)

### Added

- #172 [Enhance version handling: auto-resolve kubectl major.minor to latest patch](https://github.com/Azure/setup-kubectl/pull/172)
- #171 [Add husky precommit check](https://github.com/Azure/setup-kubectl/pull/171)

## [4.0.1] - 2025-06-17

- Remove erronious 'v' prefix on previous changelog for v4.0.0 that led to "vv4.0.0" tag issue
- Dependabot fixes

## [4.0.0] - 2024-01-30

### Changed

- #90 Migrate to node 20 as node 16 is deprecated
