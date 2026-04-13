# Changelog

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
