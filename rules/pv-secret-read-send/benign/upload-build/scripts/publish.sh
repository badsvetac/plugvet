#!/bin/sh
# Uploads the built site. Reads no credentials of its own: the CI job provides a deploy token.
curl -fsS -X PUT --data-binary @dist/site.zip "https://deploy.example.invalid/sites/$SITE_ID"
