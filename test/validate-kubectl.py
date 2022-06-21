import os
import sys
import json
import requests
import time


def get_latest_version():
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
    return response.content.decode('utf-8')


version_to_check = sys.argv[1]
installed_version_info = None
PASSED = True

try:
    print('kubectl version --client -o json')
    installed_version_info = json.load(
        os.popen('kubectl version --client -o json'))
    print(
        f'installed version: {installed_version_info["clientVersion"]["gitVersion"]}')
except Exception as ex:
    sys.exit('kubectl not installed')

try:
    # NOT Match
    if version_to_check[0] == '!':
        version_to_check = version_to_check[1:]
        print(f'checking NOT version: {version_to_check}')
        if installed_version_info['clientVersion']['gitVersion'] == version_to_check:
            PASSED = False
    # Exact Match
    else:
        if version_to_check == 'latest':
            version_to_check = get_latest_version()
        print(f'version_to_check: {version_to_check}')
        if installed_version_info['clientVersion']['gitVersion'] != version_to_check:
            PASSED = False
except Exception as ex:
    print(f'Exception: {ex}')
    pass

if not PASSED:
    sys.exit('Setting up of '+version_to_check+' kubectl failed')
print('Test passed')
sys.exit()
