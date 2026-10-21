#!/usr/bin/env python3
# Generates a Web Push (VAPID) key pair with the system openssl - no Node/npm needed on the Chromebook.
# Prints {"publicKey": ..., "privateKey": ...} as base64url, the format web-push and the browser expect.
import base64, json, re, subprocess

def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

pem = subprocess.run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout"], capture_output=True, check=True).stdout
text = subprocess.run(["openssl", "ec", "-text", "-noout"], input=pem, capture_output=True, check=True).stdout.decode()
def block(label):
    m = re.search(label + r":\s*\n((?:\s+[0-9a-f:]+\n)+)", text)
    return bytes.fromhex(re.sub(r"[\s:]", "", m.group(1)))
priv, pub = block("priv"), block("pub")
priv = priv[-32:].rjust(32, b"\0")
assert len(pub) == 65 and pub[0] == 4
print(json.dumps({"publicKey": b64url(pub), "privateKey": b64url(priv)}))
