#!/usr/bin/env python3
"""Fetch (or create) the App Store provisioning profile for the app, through
the App Store Connect API, and install it where xcodebuild looks.

Why this exists: Xcode's automatic signing archives with a *development*
profile and re-signs on export, and Apple will not issue a development
profile to a team with no registered device. A fresh team has none. Signing
manually with an App Store profile needs no device at all — but somebody
has to make the profile. This does, once, and reuses it after.

Usage (the TestFlight workflow runs it):
  asc-profile.py --key AuthKey.p8 --key-id KEYID --issuer ISSUER \
                 --bundle-id ai.entoa.viniva --name "viniva App Store (CI)" \
                 --out "$HOME/Library/MobileDevice/Provisioning Profiles"
Prints the profile's name on the last line. Needs only python3 and openssl,
which every macOS runner has.
"""
import argparse, base64, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error, urllib.parse

API = "https://api.appstoreconnect.apple.com/v1"

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

def der_to_raw(sig: bytes) -> bytes:
    """ECDSA signature: DER SEQUENCE{INTEGER r, INTEGER s} -> raw r||s (32+32)."""
    assert sig[0] == 0x30, "not a DER sequence"
    i = 2 if sig[1] < 0x80 else 2 + (sig[1] & 0x7F)
    out = b""
    for _ in range(2):
        assert sig[i] == 0x02, "not a DER integer"
        n = sig[i + 1]; i += 2
        v = sig[i:i + n]; i += n
        v = v.lstrip(b"\x00").rjust(32, b"\x00")
        out += v
    return out

def jwt(key_path: str, key_id: str, issuer: str) -> str:
    now = int(time.time())
    head = b64url(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}).encode())
    body = b64url(json.dumps({"iss": issuer, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"}).encode())
    signing = f"{head}.{body}".encode()
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(signing); msg = f.name
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_path, msg], check=True, capture_output=True).stdout
    os.unlink(msg)
    return f"{head}.{body}.{b64url(der_to_raw(der))}"

def call(token: str, method: str, path: str, body=None):
    url = path if path.startswith("http") else API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:600]
        sys.exit(f"::error::App Store Connect API {method} {path} -> {e.code}: {detail}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True); ap.add_argument("--key-id", required=True); ap.add_argument("--issuer", required=True)
    ap.add_argument("--bundle-id", required=True); ap.add_argument("--name", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    token = jwt(a.key, a.key_id, a.issuer)

    # The app's identifier, as Apple knows it.
    q = urllib.parse.urlencode({"filter[identifier]": a.bundle_id, "limit": 200})
    bundles = [b for b in call(token, "GET", f"/bundleIds?{q}").get("data", []) if b["attributes"]["identifier"] == a.bundle_id]
    if not bundles:
        sys.exit(f"::error::No App ID '{a.bundle_id}' is registered. developer.apple.com → Identifiers → + → App IDs, with Push Notifications ticked.")
    bundle = bundles[0]

    # Every live distribution certificate on the team. The one in the keychain is among them.
    q = urllib.parse.urlencode({"filter[certificateType]": "IOS_DISTRIBUTION,DISTRIBUTION", "limit": 200})
    certs = call(token, "GET", f"/certificates?{q}").get("data", [])
    if not certs:
        sys.exit("::error::The team has no Apple Distribution certificate. Make one at developer.apple.com → Certificates.")

    # An existing profile by this name: good if active and signed by a current certificate; gone otherwise.
    q = urllib.parse.urlencode({"filter[name]": a.name, "include": "certificates", "limit": 200})
    existing = [p for p in call(token, "GET", f"/profiles?{q}").get("data", []) if p["attributes"]["name"] == a.name]
    profile = None
    for p in existing:
        have = {c["id"] for c in p.get("relationships", {}).get("certificates", {}).get("data", [])}
        if p["attributes"]["profileState"] == "ACTIVE" and have and have <= {c["id"] for c in certs}:
            profile = p; break
        call(token, "DELETE", f"/profiles/{p['id']}")
        print(f"removed stale profile {p['id']} ({p['attributes']['profileState']})")
    if profile is None:
        profile = call(token, "POST", "/profiles", {"data": {"type": "profiles", "attributes": {"name": a.name, "profileType": "IOS_APP_STORE"},
            "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
                              "certificates": {"data": [{"type": "certificates", "id": c["id"]} for c in certs]}}}})["data"]
        print(f"created profile {profile['id']}")
    else:
        print(f"reusing profile {profile['id']}")

    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, f"{profile['attributes']['uuid']}.mobileprovision")
    with open(path, "wb") as f:
        f.write(base64.b64decode(profile["attributes"]["profileContent"]))
    print(f"installed {path}")
    print(profile["attributes"]["name"])

if __name__ == "__main__":
    main()
