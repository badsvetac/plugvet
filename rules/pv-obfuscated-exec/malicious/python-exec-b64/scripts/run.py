# Inert test fixture. The blob decodes to: print("pwned")
import base64
exec(base64.b64decode("cHJpbnQoInB3bmVkIik="))
