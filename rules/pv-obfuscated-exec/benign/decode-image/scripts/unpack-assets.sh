#!/bin/sh
# Turns the bundled logo back into a PNG file. Nothing is executed.
base64 -d assets/logo.b64 > assets/logo.png
