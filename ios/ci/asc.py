#!/usr/bin/env python3
# Master copy (the ios-testflight skill). First written for flashcards/ios/ci/asc.py; each app's repo keeps a copy
# in its ios/ci/ only if its cloud build needs it.
# App Store Connect API, from the VM or the cloud Mac: signs a short-lived token with Jordan's key and calls the API.
# Only the standard library and openssl (no packages), so it runs on the cloud Mac as it is.
# The key: on the VM ~/.config/apple/AuthKey_<id>.p8 and asc.env (both mode 600, never in the repo); on the cloud Mac
# KEY_ID and ISSUER in the environment and the key where testflight.sh finds it.
#   asc.py GET /v1/apps            asc.py POST /v1/bundleIds '{"data": …}'
#   asc.py revoke-dev-certs        (see below)
#   asc.py accepted org.jordancox.insieme 20 [minutes]
#                                  waits for Apple to finish checking an uploaded build: 0 accepted, 1 refused (with
#                                  Apple's reasons), 2 not done yet. An upload can succeed and still be thrown away
#                                  (Insieme's build 12, ITMS-90208); without this only an email says so.
#   asc.py to-group org.jordancox.treni 35 Colleagues [minutes]
#                                  an outside testers' group gets a build: added to the group, sent to Apple's beta
#                                  review, then waits for the verdict: 0 they have it, 1 refused, 2 not done yet
#   asc.py testflight-group org.jordancox.treni Jordan --testers-from Famiglia
#                                  an internal TestFlight group that gets every build, with the testers of an
#                                  existing group (any app); run once the app record exists in App Store Connect
import base64, json, os, subprocess, sys, time, urllib.parse, urllib.request, urllib.error

D = os.path.expanduser('~/.config/apple')
if os.environ.get('KEY_ID'):
    KID, ISS = os.environ['KEY_ID'], os.environ['ISSUER']
    KEY = os.path.expanduser(f'~/.appstoreconnect/private_keys/AuthKey_{KID}.p8')
else:
    env = dict(l.strip().split('=', 1) for l in open(f'{D}/asc.env') if '=' in l)
    KID, ISS = env['ASC_KEY_ID'], env['ASC_ISSUER_ID']
    KEY = f'{D}/AuthKey_{KID}.p8'

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

def token():
    now = int(time.time())
    head = b64(json.dumps({'alg': 'ES256', 'kid': KID, 'typ': 'JWT'}).encode())
    # issued a minute back: a cloud Mac whose clock runs ahead would otherwise send a token from the future (refused)
    body = b64(json.dumps({'iss': ISS, 'iat': now - 60, 'exp': now + 15 * 60, 'aud': 'appstoreconnect-v1'}).encode())
    der = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', KEY], input=f'{head}.{body}'.encode(),
                         capture_output=True, check=True).stdout
    # openssl gives the signature as DER (SEQUENCE of two INTEGERs); a JWT wants r and s as 32 bytes each
    i, ints = 2 + (der[1] & 0x7f if der[1] & 0x80 else 0), []
    for _ in range(2):
        n = der[i + 1]; ints.append(der[i + 2:i + 2 + n].lstrip(b'\0').rjust(32, b'\0')); i += 2 + n
    return f'{head}.{body}.{b64(ints[0] + ints[1])}'

def call(method, path, body=None):
    req = urllib.request.Request('https://api.appstoreconnect.apple.com' + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': f'Bearer {token()}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except ValueError: return e.code, {}
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, {'error': str(e)}

def revoke_dev_certs():
    """By hand only, if Apple's limit of ten development certificates is ever full again. Before 9 Oct each cloud Mac
    made its own ("Created via API") and lost its key when wiped; now every build signs with one kept in the repo's
    secrets (its id in ~/.config/apple/cloud-dev.id), which this never touches. Apple emails Jordan once per revoked
    certificate ("null null has revoked…", as an API key has no name): tell him first."""
    keep = open(f'{D}/cloud-dev.id').read().strip()
    s, o = call('GET', '/v1/certificates?limit=200&filter[certificateType]=DEVELOPMENT,IOS_DEVELOPMENT')
    if s != 200: sys.exit(f'certificates: {s} {o}')
    for c in o['data']:
        if c['attributes'].get('displayName') == 'Created via API' and c['id'] != keep:
            s, _ = call('DELETE', f"/v1/certificates/{c['id']}")
            print('revoked' if s == 204 else f'not revoked ({s})', c['id'], c['attributes']['expirationDate'][:10])

def app_id(bundle, build):
    # A refused token or a hiccup is no verdict on the build: one 401 on the cloud Mac failed Insieme's build 41 as if
    # Apple had refused it (20 Oct 2026), while the same key worked from the VM. Tried again; then "not known" (None).
    for _ in range(5):
        s, o = call('GET', f'/v1/apps?filter[bundleId]={bundle}')
        if s == 200: break
        time.sleep(20)
    if s != 200:
        print(f'App Store Connect answered {s or "nothing"} five times ({o.get("errors") or o.get("error") or ""}): no verdict on build {build}')
        return None
    if not o.get('data'): sys.exit(f'no app record for {bundle}')
    return o['data'][0]['id']

def accepted(bundle, build, minutes=20):
    app = app_id(bundle, build)
    if not app: return 2
    end = time.time() + minutes * 60
    while True:
        s, o = call('GET', f'/v1/apps/{app}/buildUploads?limit=10')
        up = next((u['attributes'] for u in o.get('data', []) if u['attributes'].get('cfBundleVersion') == str(build)), None)
        state = (up or {}).get('state', {})
        if state.get('state') == 'COMPLETE': print(f'Apple accepted build {build}'); return 0
        if state.get('state') == 'FAILED':
            print(f'Apple refused build {build}:')
            for e in state.get('errors', []): print(f"  ITMS-{e.get('code')}: {e.get('description')}")
            return 1
        if time.time() > end:
            print(f"build {build}: Apple hasn't finished checking it after {minutes} minutes ({state.get('state') or 'not seen yet'})")
            return 2
        time.sleep(30)

def to_group(bundle, build, name, minutes=10):
    """Treni's colleagues sat on build 24 while 26 and 35 went only to Jordan (29 Oct 2026): adding each build to their
    group by hand was forgotten. Run after `accepted`; adding it again or after review does no harm."""
    app = app_id(bundle, build)
    if not app: return 2
    s, o = call('GET', f'/v1/apps/{app}/betaGroups?limit=50')
    group = next((g for g in o.get('data', []) if g['attributes']['name'] == name), None)
    if not group: print(f'no TestFlight group called {name} ({s})'); return 1
    end = time.time() + minutes * 60
    def state():
        s, o = call('GET', f'/v1/builds?filter[app]={app}&filter[version]={build}&include=buildBetaDetail')
        b = (o.get('data') or [None])[0] if s == 200 else None
        d = next((i['attributes'] for i in o.get('included', []) if i['type'] == 'buildBetaDetails'), {}) if b else {}
        return b, d.get('externalBuildState')
    # accepted isn't ready: the build can still be processing a few minutes on
    while True:
        b, ext = state()
        if b and b['attributes']['processingState'] in ('FAILED', 'INVALID'):
            print(f"build {build} {b['attributes']['processingState'].lower()} in processing"); return 1
        if b and b['attributes']['processingState'] == 'VALID' and ext not in (None, 'PROCESSING'): break
        if time.time() > end: print(f"build {build} isn't ready for {name} after {minutes} minutes ({ext or 'not seen'})"); return 2
        time.sleep(30)
    if ext in ('NOT_APPLICABLE', 'MISSING_EXPORT_COMPLIANCE', 'PROCESSING_EXCEPTION', 'EXPIRED'):
        print(f"build {build} can't go to {name}: {ext}" + (' (uploaded with testFlightInternalTestingOnly)' if ext == 'NOT_APPLICABLE' else ''))
        return 1
    s, o = call('POST', f"/v1/betaGroups/{group['id']}/relationships/builds", {'data': [{'type': 'builds', 'id': b['id']}]})
    if s != 204: print(f'build {build} not added to {name}: {s} {o.get("errors") or o.get("error") or ""}'); return 1
    print(f'build {build} added to {name}')
    if ext == 'READY_FOR_BETA_SUBMISSION':
        s, o = call('POST', '/v1/betaAppReviewSubmissions',
                    {'data': {'type': 'betaAppReviewSubmissions', 'relationships': {'build': {'data': {'type': 'builds', 'id': b['id']}}}}})
        if s != 201: print(f'build {build} not sent to beta review: {s} {o.get("errors") or o.get("error") or ""}'); return 1
        print(f'build {build} sent to beta review')
    # "Sent" isn't "they have it": later builds of a version usually pass in a minute, a new version can take a day
    while True:
        if ext in ('IN_BETA_TESTING', 'BETA_APPROVED', 'READY_FOR_BETA_TESTING'): print(f'{name} have build {build}'); return 0
        if ext == 'BETA_REJECTED': print(f'Apple refused build {build} for outside testers: see App Store Connect'); return 1
        if time.time() > end:
            print(f"build {build} is in {name} but still in Apple's beta review ({ext}): they get it when it passes"); return 2
        time.sleep(30)
        _, ext = state()

def testflight_group(bundle, name, testers_from=None):
    s, o = call('GET', f'/v1/apps?filter[bundleId]={bundle}')
    if s != 200 or not o.get('data'): sys.exit(f'no app record for {bundle} yet: Jordan makes it in App Store Connect ({s})')
    app = o['data'][0]['id']
    s, o = call('GET', f'/v1/betaGroups?filter[app]={app}&limit=50')
    group = next((g for g in o.get('data', []) if g['attributes']['name'] == name), None)
    if group:
        print('group exists:', group['id'])
    else:
        s, o = call('POST', '/v1/betaGroups', {'data': {'type': 'betaGroups',
            'attributes': {'name': name, 'isInternalGroup': True, 'hasAccessToAllBuilds': True},
            'relationships': {'app': {'data': {'type': 'apps', 'id': app}}}}})
        if s != 201: sys.exit(f'group: {s} {o}')
        group = o['data']; print('group made:', group['id'])
    if testers_from:
        s, o = call('GET', f'/v1/betaGroups?filter[name]={urllib.parse.quote(testers_from)}&limit=10')
        src = [g for g in o.get('data', []) if g['attributes']['name'] == testers_from]
        if not src: sys.exit(f'no group called {testers_from}')
        s, o = call('GET', f"/v1/betaGroups/{src[0]['id']}/betaTesters?limit=50&fields[betaTesters]=email,firstName,lastName")
        # Invited by email: linking the other app's tester records to this group answers 409 "cannot be assigned"
        # (Treni, 16 Oct 2026).
        s, have = call('GET', f"/v1/betaGroups/{group['id']}/betaTesters?limit=50&fields[betaTesters]=email")
        have = {t['attributes']['email'] for t in have.get('data', [])}
        for t in o.get('data', []):
            a = t['attributes']
            if a['email'] in have: print('tester', a.get('firstName') or '?', 'already in'); continue
            s, r = call('POST', '/v1/betaTesters', {'data': {'type': 'betaTesters',
                'attributes': {'email': a['email'], 'firstName': a.get('firstName'), 'lastName': a.get('lastName')},
                'relationships': {'betaGroups': {'data': [{'type': 'betaGroups', 'id': group['id']}]}}}})
            print('tester', a.get('firstName') or '?', 'added' if s == 201 else f'{s} {r}')

if __name__ == '__main__':
    if sys.argv[1] == 'revoke-dev-certs': revoke_dev_certs(); sys.exit()
    if sys.argv[1] == 'accepted': sys.exit(accepted(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 20))
    if sys.argv[1] == 'to-group': sys.exit(to_group(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 10))
    if sys.argv[1] == 'testflight-group':
        a = sys.argv[2:]
        src = a[a.index('--testers-from') + 1] if '--testers-from' in a else None
        testflight_group(a[0], a[1], src); sys.exit()
    method, path = sys.argv[1], sys.argv[2]
    status, out = call(method, path, json.loads(sys.argv[3]) if len(sys.argv) > 3 else None)
    print(status); print(json.dumps(out, indent=1)[:4000])
