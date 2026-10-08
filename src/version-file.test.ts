import {test, expect} from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {spawnSync} from 'node:child_process'
import {parseToolVersionsFile} from './helpers.js'

test('version-file reads a real regular file', () => {
   const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubectl-version-'))
   try {
      const file = path.join(dir, '.tool-versions')
      fs.writeFileSync(file, 'kubectl 1.27.15\n')
      expect(parseToolVersionsFile(file)).toBe('1.27.15')
   } finally {
      fs.rmSync(dir, {recursive: true, force: true})
   }
})

test.skipIf(process.platform === 'win32')(
   'version-file rejects a FIFO swapped in after lstat without blocking',
   () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubectl-fifo-'))
      try {
         const file = path.join(dir, '.tool-versions')
         fs.writeFileSync(file, 'kubectl 1.27.15\n')
         // Isolate a potentially blocking open in a child with a hard timeout.
         // Replace only lstat: open, fstat and the FIFO are real OS operations.
         const script = `
            const fs = require('node:fs');
            const {execFileSync} = require('node:child_process');
            const {syncBuiltinESMExports} = require('node:module');
            const file = ${JSON.stringify(file)};
            const lstat = fs.lstatSync;
            fs.lstatSync = function(p, options) {
               const stats = lstat(p, options);
               if (p === file) {
                  fs.unlinkSync(file);
                  execFileSync('mkfifo', [file]);
               }
               return stats;
            };
            syncBuiltinESMExports();
            import(${JSON.stringify(new URL('./helpers.ts', import.meta.url).href)})
               .then(({parseToolVersionsFile}) => {
                  try {
                     parseToolVersionsFile(file);
                     process.exitCode = 1;
                  } catch (error) {
                     console.log(error.message);
                     process.exitCode = /must be a regular file/.test(error.message) ? 0 : 1;
                  }
               }).catch(error => { console.error(error); process.exitCode = 1; });
         `
         const result = spawnSync(
            process.execPath,
            ['--experimental-strip-types', '-e', script],
            {encoding: 'utf8', timeout: 5000}
         )
         expect(result.error, result.stderr).toBeUndefined()
         expect(result.status, result.stderr).toBe(0)
         expect(result.stdout).toContain('must be a regular file')
      } finally {
         fs.rmSync(dir, {recursive: true, force: true})
      }
   },
   10000
)
