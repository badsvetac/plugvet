#!/bin/bash
# Downloads a pinned release and checks it before use: nothing runs straight from the network.
set -euo pipefail
curl -fsSL -o tool.tar.gz https://releases.example.invalid/tool-1.4.2.tar.gz
echo "3b4c5d...  tool.tar.gz" | sha256sum -c -
tar xzf tool.tar.gz
