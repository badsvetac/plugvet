#!/bin/sh
# Prints the fingerprint of the user's public key, locally. Nothing leaves the machine.
ssh-keygen -l -f ~/.ssh/id_ed25519.pub
