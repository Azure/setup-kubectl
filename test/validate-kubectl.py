import os, sys, json, requests, time

version_to_check = sys.argv[1]
version_info = None
PASSED = False

try:
    print('kubectl version --client -o json')
    version_info = json.load(os.popen('kubectl version --client -o json'))
except Exception as ex:
  sys.exit('kubectl not installed')

try:
    if version_to_check == 'latest':
        response = None
        time_to_sleep = 2
        for _ in range(10):
            response = requests.get('https://storage.googleapis.com/kubernetes-release/release/stable.txt')
            if response.status_code == 200:
                break
            print('Failed to obtain latest version info, retrying.')
            time.sleep(time_to_sleep)
            time_to_sleep *= 2
        version_to_check = response.content.decode('utf-8')
    PASSED = True if version_info['clientVersion']['gitVersion'] == version_to_check else False
except:
    pass

if not PASSED:
    sys.exit('Setting up of '+version_to_check+' kubectl failed')
print('Test passed')