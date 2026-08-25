import os

from .app import app


if __name__ == "__main__":
    debug = os.environ.get("WAVEBANK_DEBUG", "0") == "1"
    app.run(
        host=os.environ.get("WAVEBANK_HOST", "127.0.0.1"),
        port=int(os.environ.get("WAVEBANK_PORT", "5000")),
        debug=debug,
    )
