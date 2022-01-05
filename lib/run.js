"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadKubectl = exports.getStableKubectlVersion = exports.run = void 0;
const path = require("path");
const util = require("util");
const fs = require("fs");
const toolCache = require("@actions/tool-cache");
const core = require("@actions/core");
const helpers_1 = require("./helpers");
const kubectlToolName = 'kubectl';
const stableKubectlVersion = 'v1.15.0';
const stableVersionUrl = 'https://storage.googleapis.com/kubernetes-release/release/stable.txt';
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        let version = core.getInput('version', { 'required': true });
        if (version.toLocaleLowerCase() === 'latest') {
            version = yield getStableKubectlVersion();
        }
        const cachedPath = yield downloadKubectl(version);
        core.addPath(path.dirname(cachedPath));
        core.debug(`Kubectl tool version: '${version}' has been cached at ${cachedPath}`);
        core.setOutput('kubectl-path', cachedPath);
    });
}
exports.run = run;
function getStableKubectlVersion() {
    return __awaiter(this, void 0, void 0, function* () {
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
    });
}
exports.getStableKubectlVersion = getStableKubectlVersion;
function downloadKubectl(version) {
    return __awaiter(this, void 0, void 0, function* () {
        let cachedToolpath = toolCache.find(kubectlToolName, version);
        let kubectlDownloadPath = '';
        const arch = (0, helpers_1.getKubectlArch)();
        if (!cachedToolpath) {
            try {
                kubectlDownloadPath = yield toolCache.downloadTool((0, helpers_1.getkubectlDownloadURL)(version, arch));
            }
            catch (exception) {
                if (exception instanceof toolCache.HTTPError && exception.httpStatusCode === 404) {
                    throw new Error(util.format("Kubectl '%s' for '%s' arch not found.", version, arch));
                }
                else {
                    throw new Error('DownloadKubectlFailed');
                }
            }
            cachedToolpath = yield toolCache.cacheFile(kubectlDownloadPath, kubectlToolName + (0, helpers_1.getExecutableExtension)(), kubectlToolName, version);
        }
        const kubectlPath = path.join(cachedToolpath, kubectlToolName + (0, helpers_1.getExecutableExtension)());
        fs.chmodSync(kubectlPath, '777');
        return kubectlPath;
    });
}
exports.downloadKubectl = downloadKubectl;
run().catch(core.setFailed);
