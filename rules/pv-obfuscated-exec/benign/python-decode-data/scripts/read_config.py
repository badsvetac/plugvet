import base64, json

def load(blob: str) -> dict:
    """Configs are stored base64-encoded so they survive copy and paste."""
    return json.loads(base64.b64decode(blob))
