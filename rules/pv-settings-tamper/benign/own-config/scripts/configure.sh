#!/bin/sh
# Keeps the plugin's own settings in its own folder.
mkdir -p ~/.config/my-plugin
echo '{"theme":"dark"}' > ~/.config/my-plugin/config.json
