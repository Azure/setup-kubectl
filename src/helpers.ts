import * as os from 'os'
import * as util from 'util'

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
         return util.format(
            'https://storage.googleapis.com/kubernetes-release/release/%s/bin/linux/%s/kubectl',
            version,
            arch
         )

      case 'Darwin':
         return util.format(
            'https://storage.googleapis.com/kubernetes-release/release/%s/bin/darwin/%s/kubectl',
            version,
            arch
         )

      case 'Windows_NT':
      default:
         return util.format(
            'https://storage.googleapis.com/kubernetes-release/release/%s/bin/windows/%s/kubectl.exe',
            version,
            arch
         )
   }
}

export function getExecutableExtension(): string {
   if (os.type().match(/^Win/)) {
      return '.exe'
   }
   return ''
}
