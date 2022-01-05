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
const run = require("./run");
const helpers_1 = require("./helpers");
const os = require("os");
const toolCache = require("@actions/tool-cache");
const fs = require("fs");
const path = require("path");
const core = require("@actions/core");
const util = require("util");
describe('Testing all functions in run file.', () => {
    test('getExecutableExtension() - return .exe when os is Windows', () => {
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
        expect((0, helpers_1.getExecutableExtension)()).toBe('.exe');
        expect(os.type).toBeCalled();
    });
    test('getExecutableExtension() - return empty string for non-windows OS', () => {
        jest.spyOn(os, 'type').mockReturnValue('Darwin');
        expect((0, helpers_1.getExecutableExtension)()).toBe('');
        expect(os.type).toBeCalled();
    });
    test.each([
        ['arm', 'arm'],
        ['arm64', 'arm64'],
        ['x64', 'amd64']
    ])("getKubectlArch() - return on %s os arch %s kubectl arch", (osArch, kubectlArch) => {
        jest.spyOn(os, 'arch').mockReturnValue(osArch);
        expect((0, helpers_1.getKubectlArch)()).toBe(kubectlArch);
        expect(os.arch).toBeCalled();
    });
    test.each([
        ['arm'],
        ['arm64'],
        ['amd64']
    ])('getkubectlDownloadURL() - return the URL to download %s kubectl for Linux', (arch) => {
        jest.spyOn(os, 'type').mockReturnValue('Linux');
        const kubectlLinuxUrl = util.format('https://storage.googleapis.com/kubernetes-release/release/v1.15.0/bin/linux/%s/kubectl', arch);
        expect((0, helpers_1.getkubectlDownloadURL)('v1.15.0', arch)).toBe(kubectlLinuxUrl);
        expect(os.type).toBeCalled();
    });
    test.each([
        ['arm'],
        ['arm64'],
        ['amd64']
    ])('getkubectlDownloadURL() - return the URL to download %s kubectl for Darwin', (arch) => {
        jest.spyOn(os, 'type').mockReturnValue('Darwin');
        const kubectlDarwinUrl = util.format('https://storage.googleapis.com/kubernetes-release/release/v1.15.0/bin/darwin/%s/kubectl', arch);
        expect((0, helpers_1.getkubectlDownloadURL)('v1.15.0', arch)).toBe(kubectlDarwinUrl);
        expect(os.type).toBeCalled();
    });
    test.each([
        ['arm'],
        ['arm64'],
        ['amd64']
    ])('getkubectlDownloadURL() - return the URL to download %s kubectl for Windows', (arch) => {
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
        const kubectlWindowsUrl = util.format('https://storage.googleapis.com/kubernetes-release/release/v1.15.0/bin/windows/%s/kubectl.exe', arch);
        expect((0, helpers_1.getkubectlDownloadURL)('v1.15.0', arch)).toBe(kubectlWindowsUrl);
        expect(os.type).toBeCalled();
    });
    test('getStableKubectlVersion() - download stable version file, read version and return it', () => __awaiter(void 0, void 0, void 0, function* () {
        jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve('pathToTool'));
        jest.spyOn(fs, 'readFileSync').mockReturnValue('v1.20.4');
        expect(yield run.getStableKubectlVersion()).toBe('v1.20.4');
        expect(toolCache.downloadTool).toBeCalled();
        expect(fs.readFileSync).toBeCalledWith('pathToTool', 'utf8');
    }));
    test('getStableKubectlVersion() - return default v1.15.0 if version read is empty', () => __awaiter(void 0, void 0, void 0, function* () {
        jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve('pathToTool'));
        jest.spyOn(fs, 'readFileSync').mockReturnValue('');
        expect(yield run.getStableKubectlVersion()).toBe('v1.15.0');
        expect(toolCache.downloadTool).toBeCalled();
        expect(fs.readFileSync).toBeCalledWith('pathToTool', 'utf8');
    }));
    test('getStableKubectlVersion() - return default v1.15.0 if unable to download file', () => __awaiter(void 0, void 0, void 0, function* () {
        jest.spyOn(toolCache, 'downloadTool').mockRejectedValue('Unable to download.');
        expect(yield run.getStableKubectlVersion()).toBe('v1.15.0');
        expect(toolCache.downloadTool).toBeCalled();
    }));
    test('downloadKubectl() - download kubectl, add it to toolCache and return path to it', () => __awaiter(void 0, void 0, void 0, function* () {
        jest.spyOn(toolCache, 'find').mockReturnValue('');
        jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve('pathToTool'));
        jest.spyOn(toolCache, 'cacheFile').mockReturnValue(Promise.resolve('pathToCachedTool'));
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
        jest.spyOn(fs, 'chmodSync').mockImplementation(() => { });
        expect(yield run.downloadKubectl('v1.15.0')).toBe(path.join('pathToCachedTool', 'kubectl.exe'));
        expect(toolCache.find).toBeCalledWith('kubectl', 'v1.15.0');
        expect(toolCache.downloadTool).toBeCalled();
        expect(toolCache.cacheFile).toBeCalled();
        expect(os.type).toBeCalled();
        expect(fs.chmodSync).toBeCalledWith(path.join('pathToCachedTool', 'kubectl.exe'), '777');
    }));
    test('downloadKubectl() - throw DownloadKubectlFailed error when unable to download kubectl', () => __awaiter(void 0, void 0, void 0, function* () {
        jest.spyOn(toolCache, 'find').mockReturnValue('');
        jest.spyOn(toolCache, 'downloadTool').mockRejectedValue('Unable to download kubectl.');
        yield expect(run.downloadKubectl('v1.15.0')).rejects.toThrow('DownloadKubectlFailed');
        expect(toolCache.find).toBeCalledWith('kubectl', 'v1.15.0');
        expect(toolCache.downloadTool).toBeCalled();
    }));
    test('downloadKubectl() - throw kubectl not found error when receive 404 response', () => __awaiter(void 0, void 0, void 0, function* () {
        const kubectlVersion = 'v1.15.0';
        const arch = 'arm128';
        jest.spyOn(os, 'arch').mockReturnValue(arch);
        jest.spyOn(toolCache, 'find').mockReturnValue('');
        jest.spyOn(toolCache, 'downloadTool').mockImplementation(_ => {
            throw new toolCache.HTTPError(404);
        });
        yield expect(run.downloadKubectl(kubectlVersion)).rejects
            .toThrow(util.format("Kubectl '%s' for '%s' arch not found.", kubectlVersion, arch));
        expect(os.arch).toBeCalled();
        expect(toolCache.find).toBeCalledWith('kubectl', kubectlVersion);
        expect(toolCache.downloadTool).toBeCalled();
    }));
    test('downloadKubectl() - return path to existing cache of kubectl', () => __awaiter(void 0, void 0, void 0, function* () {
        jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool');
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
        jest.spyOn(fs, 'chmodSync').mockImplementation(() => { });
        jest.spyOn(toolCache, 'downloadTool');
        expect(yield run.downloadKubectl('v1.15.0')).toBe(path.join('pathToCachedTool', 'kubectl.exe'));
        expect(toolCache.find).toBeCalledWith('kubectl', 'v1.15.0');
        expect(os.type).toBeCalled();
        expect(fs.chmodSync).toBeCalledWith(path.join('pathToCachedTool', 'kubectl.exe'), '777');
        expect(toolCache.downloadTool).not.toBeCalled();
    }));
    test('run() - download specified version and set output', () => __awaiter(void 0, void 0, void 0, function* () {
        jest.spyOn(core, 'getInput').mockReturnValue('v1.15.5');
        jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool');
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
        jest.spyOn(fs, 'chmodSync').mockImplementation();
        jest.spyOn(core, 'addPath').mockImplementation();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(core, 'setOutput').mockImplementation();
        expect(yield run.run()).toBeUndefined();
        expect(core.getInput).toBeCalledWith('version', { 'required': true });
        expect(core.addPath).toBeCalledWith('pathToCachedTool');
        expect(core.setOutput).toBeCalledWith('kubectl-path', path.join('pathToCachedTool', 'kubectl.exe'));
    }));
    test('run() - get latest version, download it and set output', () => __awaiter(void 0, void 0, void 0, function* () {
        jest.spyOn(core, 'getInput').mockReturnValue('latest');
        jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve('pathToTool'));
        jest.spyOn(fs, 'readFileSync').mockReturnValue('v1.20.4');
        jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool');
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
        jest.spyOn(fs, 'chmodSync').mockImplementation();
        jest.spyOn(core, 'addPath').mockImplementation();
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(core, 'setOutput').mockImplementation();
        expect(yield run.run()).toBeUndefined();
        expect(toolCache.downloadTool).toBeCalledWith('https://storage.googleapis.com/kubernetes-release/release/stable.txt');
        expect(core.getInput).toBeCalledWith('version', { 'required': true });
        expect(core.addPath).toBeCalledWith('pathToCachedTool');
        expect(core.setOutput).toBeCalledWith('kubectl-path', path.join('pathToCachedTool', 'kubectl.exe'));
    }));
});
