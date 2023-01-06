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
         return `https://dl.k8s.io/release/${version}/bin/linux/${arch}/kubectl`

      case 'Darwin':
         return `https://dl.k8s.io/release/${version}/bin/darwin/${arch}/kubectl`

      case 'Windows_NT':
      default:
         return `https://dl.k8s.io/release/${version}/bin/windows/${arch}/kubectl.exe`
   }
}

export function getExecutableExtension(): string {
   if (os.type().match(/^Win/)) {
      return '.exe'
   }
   return ''
}
