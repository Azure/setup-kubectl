"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExecutableExtension = exports.getkubectlDownloadURL = exports.getKubectlArch = void 0;
const os = require("os");
const util = require("util");
function getKubectlArch() {
    const arch = os.arch();
    if (arch === 'x64') {
        return 'amd64';
    }
    return arch;
}
exports.getKubectlArch = getKubectlArch;
function getkubectlDownloadURL(version, arch) {
    switch (os.type()) {
        case 'Linux':
            return util.format('https://storage.googleapis.com/kubernetes-release/release/%s/bin/linux/%s/kubectl', version, arch);
        case 'Darwin':
            return util.format('https://storage.googleapis.com/kubernetes-release/release/%s/bin/darwin/%s/kubectl', version, arch);
        case 'Windows_NT':
        default:
            return util.format('https://storage.googleapis.com/kubernetes-release/release/%s/bin/windows/%s/kubectl.exe', version, arch);
    }
}
exports.getkubectlDownloadURL = getkubectlDownloadURL;
function getExecutableExtension() {
    if (os.type().match(/^Win/)) {
        return '.exe';
    }
    return '';
}
exports.getExecutableExtension = getExecutableExtension;
