from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import uvicorn
from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402

if __name__ == "__main__":
    import os

    host = os.environ.get("HOST", settings.backend_host)
    port = int(os.environ.get("PORT", settings.backend_port))
    uvicorn.run(app, host=host, port=port)
