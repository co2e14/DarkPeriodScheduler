.PHONY: install backend frontend test typecheck build serve

install:            ## install backend (uv) and frontend (npm) dependencies
	cd backend && uv sync
	cd frontend && npm install

backend:            ## API on :8000 with auto-reload
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:           ## Vite dev server on :5173 (proxies /api to :8000)
	cd frontend && npm run dev

test:               ## backend test suite
	cd backend && uv run pytest

typecheck:
	cd frontend && npm run typecheck

build:              ## production frontend build into frontend/dist
	cd frontend && npm run build

serve: build        ## single process: FastAPI serves API + built UI on :8000
	cd backend && uv run uvicorn app.main:app --port 8000
