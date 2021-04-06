import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import * as fs from 'fs';

import * as toolCache from '@actions/tool-cache';
import * as core from '@actions/core';

const kubectlToolName = 'kubectl';
const stableKubectlVersion = 'v1.15.0';
const stableVersionUrl = 'https://storage.googleapis.com/kubernetes-release/release/stable.txt';

export function getExecutableExtension(): string {
    if (os.type().match(/^Win/)) {
        return '.exe';
    }
    return '';
}

export function getKubectlArch(): string {
    let arch = os.arch();
    if (arch === 'x64') {
        return 'amd64';
    }
    return arch;
}

export function getkubectlDownloadURL(version: string, arch: string): string {
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

export async function getStableKubectlVersion(): Promise<string> {
    return toolCache.downloadTool(stableVersionUrl).then((downloadPath) => {
        let version = fs.readFileSync(downloadPath, 'utf8').toString().trim();
        if (!version) {
            version = stableKubectlVersion;
        }
        return version;
    }, (error) => {
        core.debug(error);
        core.warning('GetStableVersionFailed');
        return stableKubectlVersion;
    });
}

export async function downloadKubectl(version: string): Promise<string> {
    let cachedToolpath = toolCache.find(kubectlToolName, version);
    let kubectlDownloadPath = '';
    let arch = getKubectlArch();
    if (!cachedToolpath) {
        try {
            kubectlDownloadPath = await toolCache.downloadTool(getkubectlDownloadURL(version, arch));
        } catch (exception) {
            if (exception instanceof toolCache.HTTPError && exception.httpStatusCode === 404) {
                throw new Error(util.format("Kubectl '%s' for '%s' arch not found.", version, arch));
            } else {
                throw new Error('DownloadKubectlFailed');
            }
        }

        cachedToolpath = await toolCache.cacheFile(kubectlDownloadPath, kubectlToolName + getExecutableExtension(), kubectlToolName, version);
    }

    const kubectlPath = path.join(cachedToolpath, kubectlToolName + getExecutableExtension());
    fs.chmodSync(kubectlPath, '777');
    return kubectlPath;
}

export async function run() {
    let version = core.getInput('version', { 'required': true });
    if (version.toLocaleLowerCase() === 'latest') {
        version = await getStableKubectlVersion();
    }
    let cachedPath = await downloadKubectl(version);

    core.addPath(path.dirname(cachedPath));
            
    console.log(`Kubectl tool version: '${version}' has been cached at ${cachedPath}`);
    core.setOutput('kubectl-path', cachedPath);
}

run().catch(core.setFailed);
