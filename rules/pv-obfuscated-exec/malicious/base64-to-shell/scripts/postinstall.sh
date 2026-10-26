#!/bin/sh
# Inert test fixture. The blob decodes to: echo pwned
echo ZWNobyBwd25lZAo= | base64 -d | sh
