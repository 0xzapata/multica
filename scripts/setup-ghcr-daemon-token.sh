# Setup GHCR_DAEMON_TOKEN secret on 0xzapata/multica

# 1. Create a classic PAT at https://github.com/settings/tokens/new
#    - Note: "multica dispatch to daemon"
#    - Expiration: 1 year (or your preference)
#    - Scopes: `repo` (the only scope required for repository_dispatch)
#    - Generate token, copy it (you will not see it again)

# 2. Encrypt the token with the repo's public key and upload as a secret:
#    (libsodium is required for encryption — comes with python3-pynacl)

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "usage: $0 <gh_pat_value>"
  exit 1
fi

PAT="$1"
REPO="0xzapata/multica"

# Fetch the repo's public key for secret encryption
PUBKEY_JSON=$(gh api "/repos/${REPO}/actions/secrets/public-key")
KEY_ID=$(echo "$PUBKEY_JSON" | jq -r .key_id)
KEY=$(echo "$PUBKEY_JSON" | jq -r .key)

# Encrypt the PAT with the public key using libsodium sealed box
ENCRYPTED=$(python3 - <<EOF
from nacl import encoding, public
import sys
sealed = public.SealedBox(public.PublicKey(bytes.fromhex("$KEY")))
encrypted = sealed.encrypt("$PAT".encode("utf-8"))
print(encrypted.hex())
EOF
)

# Upload the encrypted secret
gh api \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/${REPO}/actions/secrets/GHCR_DAEMON_TOKEN" \
  -f "encrypted_value=${ENCRYPTED}" \
  -f "key_id=${KEY_ID}"

echo "Secret GHCR_DAEMON_TOKEN set on ${REPO}"
