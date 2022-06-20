import os
import sys
import json
import requests
import time

version_to_check = sys.argv[1]
installed_version_info = None
PASSED = False

try:
    print('kubectl version --client -o json')
    installed_version_info = json.load(
        os.popen('kubectl version --client -o json'))
    print(
        f'installed version: {installed_version_info["clientVersion"]["gitVersion"]}')
except Exception as ex:
    sys.exit('kubectl not installed')

try:
    if version_to_check[0] == '!':
        print(f'checking NOT version: {version_to_check[1:]}')
        PASSED = True if installed_version_info['clientVersion']['gitVersion'] != version_to_check[1:] else False
    elif version_to_check == 'latest':
        response = None
        time_to_sleep = 2
        for _ in range(10):
            response = requests.get(
                'https://storage.googleapis.com/kubernetes-release/release/stable.txt')
            if response.status_code == 200:
                break
            print('Failed to obtain latest version info, retrying.')
            time.sleep(time_to_sleep)
            time_to_sleep *= 2
        version_to_check = response.content.decode('utf-8')
        print(f'version_to_check: {version_to_check}')
        PASSED = True if installed_version_info['clientVersion']['gitVersion'] == version_to_check else False
except:
    pass

if not PASSED:
    sys.exit('Setting up of '+version_to_check+' kubectl failed')
print('Test passed')
sys.exit(0)
