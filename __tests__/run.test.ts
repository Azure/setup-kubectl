import * as run from '../src/run'
import * as os from 'os';
import * as toolCache from '@actions/tool-cache';
import * as fs from 'fs';

describe('Testing all functions in run file.', () => {
    test('getExecutableExtension() - return .exe when os is Windows', () => {
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
    
        expect(run.getExecutableExtension()).toBe('.exe');
        expect(os.type).toBeCalled();         
    });

    test('getExecutableExtension() - return empty string for non-windows OS', () => {
        jest.spyOn(os, 'type').mockReturnValue('Darwin');
    
        expect(run.getExecutableExtension()).toBe('');         
        expect(os.type).toBeCalled();         
    });

    test('getkubectlDownloadURL() - return the URL to download kubectl for Linux', () => {
        jest.spyOn(os, 'type').mockReturnValue('Linux');
        const kubectlLinuxUrl = 'https://storage.googleapis.com/kubernetes-release/release/v1.15.0/bin/linux/amd64/kubectl'
    
        expect(run.getkubectlDownloadURL('v1.15.0')).toBe(kubectlLinuxUrl);
        expect(os.type).toBeCalled();         
    });

    test('getkubectlDownloadURL() - return the URL to download kubectl for Darwin', () => {
        jest.spyOn(os, 'type').mockReturnValue('Darwin');
        const kubectlDarwinUrl = 'https://storage.googleapis.com/kubernetes-release/release/v1.15.0/bin/darwin/amd64/kubectl'
    
        expect(run.getkubectlDownloadURL('v1.15.0')).toBe(kubectlDarwinUrl);
        expect(os.type).toBeCalled();         
    });

    test('getkubectlDownloadURL() - return the URL to download kubectl for Windows', () => {
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
    
        const kubectlWindowsUrl = 'https://storage.googleapis.com/kubernetes-release/release/v1.15.0/bin/windows/amd64/kubectl.exe'
        expect(run.getkubectlDownloadURL('v1.15.0')).toBe(kubectlWindowsUrl);
        expect(os.type).toBeCalled();         
    });

    test('getStableKubectlVersion() - download stable version file, read version and return it', async () => {
        jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve('pathToTool'));
        jest.spyOn(fs, 'readFileSync').mockReturnValue('v1.20.4');
        
        expect(await run.getStableKubectlVersion()).toBe('v1.20.4');
        expect(toolCache.downloadTool).toBeCalled();
        expect(fs.readFileSync).toBeCalledWith('pathToTool', 'utf8');
    });

    test('getStableKubectlVersion() - return default v1.15.0 if version read is empty', async () => {
        jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve('pathToTool'));
        jest.spyOn(fs, 'readFileSync').mockReturnValue('');
        
        expect(await run.getStableKubectlVersion()).toBe('v1.15.0');
        expect(toolCache.downloadTool).toBeCalled();
        expect(fs.readFileSync).toBeCalledWith('pathToTool', 'utf8');
    });

    test('getStableKubectlVersion() - return default v1.15.0 if unable to download file', async () => {
        jest.spyOn(toolCache, 'downloadTool').mockRejectedValue('Unable to download.');
        
        expect(await run.getStableKubectlVersion()).toBe('v1.15.0');
        expect(toolCache.downloadTool).toBeCalled();
    });

    test('downloadKubectl() - download kubectl, add it to toolCache and return path to it', async () => {
        jest.spyOn(toolCache, 'find').mockReturnValue('');
        jest.spyOn(toolCache, 'downloadTool').mockReturnValue(Promise.resolve('pathToTool'));
        jest.spyOn(toolCache, 'cacheFile').mockReturnValue(Promise.resolve('pathToCachedTool'));
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
        jest.spyOn(fs, 'chmodSync').mockImplementation(() => {});
        
        expect(await run.downloadKubectl('v1.15.0')).toBe('pathToCachedTool/kubectl.exe');
        expect(toolCache.find).toBeCalledWith('kubectl', 'v1.15.0');
        expect(toolCache.downloadTool).toBeCalled();
        expect(toolCache.cacheFile).toBeCalled();
        expect(os.type).toBeCalled();
        expect(fs.chmodSync).toBeCalledWith('pathToCachedTool/kubectl.exe', '777');
    });

    test('downloadKubectl() - throw DownloadKubectlFailed error when unable to download kubectl', async () => {
        jest.spyOn(toolCache, 'find').mockReturnValue('');
        jest.spyOn(toolCache, 'downloadTool').mockRejectedValue('Unable to download kubectl.');

        await expect(run.downloadKubectl('v1.15.0')).rejects.toThrow('DownloadKubectlFailed');
        expect(toolCache.find).toBeCalledWith('kubectl', 'v1.15.0');
        expect(toolCache.downloadTool).toBeCalled();
    });

    test('downloadKubectl() - return path to existing cache of kubectl', async () => {
        jest.spyOn(toolCache, 'find').mockReturnValue('pathToCachedTool');
        jest.spyOn(os, 'type').mockReturnValue('Windows_NT');
        jest.spyOn(fs, 'chmodSync').mockImplementation(() => {});
        
        expect(await run.downloadKubectl('v1.15.0')).toBe('pathToCachedTool/kubectl.exe');
        expect(toolCache.find).toBeCalledWith('kubectl', 'v1.15.0');
        expect(os.type).toBeCalled();
        expect(fs.chmodSync).toBeCalledWith('pathToCachedTool/kubectl.exe', '777');
    });
});