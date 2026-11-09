import os
import tempfile

# app.main builds a module-level app on import; keep it away from the real database.
os.environ.setdefault("DPS_DB_PATH", os.path.join(tempfile.mkdtemp(), "import.db"))
