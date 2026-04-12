# Repository Guidelines

## Project Structure & Module Organization
- `artie/`: Python backend (FastAPI APIs, model manager, plugins, schemas, auth, DB).
- `artie/tests/`: pytest suite (`test_*.py`) plus test assets.
- `web_app/`: React + TypeScript + Vite frontend source (`src/`).
- `artie/web_app/`: built frontend artifacts served by backend (generated from `web_app/dist`).
- `main.py`: local entry point (`python main.py ...`).
- `requirements*.txt`, `setup.py`: Python dependencies and packaging metadata.
- `docker/`, `scripts/`: container/runtime and helper docs/scripts.

## Build, Test, and Development Commands
- Backend setup: `pip install -r requirements.txt`
- Start backend: `python main.py start --device cuda --port 8080`
- Run tests: `pytest artie/tests -q`
- Run targeted tests (recommended first): `pytest artie/tests -k interactive_seg -q`
- Frontend setup: `cd web_app && npm install`
- Frontend dev server: `npm run dev` (Vite on `localhost:5173`)
- Frontend build: `npm run build`
- Frontend lint: `npm run lint`

When releasing frontend changes to backend static files, build in `web_app/` and sync `dist/` into `artie/web_app/`.

## Coding Style & Naming Conventions
- Python: 4-space indentation, `snake_case` for functions/variables, `PascalCase` for classes, add type hints where practical.
- TypeScript/React: 2-space indentation, `PascalCase` for components/files (e.g. `InteractiveSegTab.tsx`), `camelCase` for hooks/state/actions.
- Keep functions focused; prefer explicit names over abbreviations.
- Reuse existing logging style (`loguru`) and avoid ad-hoc print debugging in committed code.

## Testing Guidelines
- Framework: `pytest`.
- Test files: `artie/tests/test_*.py`; test names should start with `test_`.
- Many tests are model/device dependent (CPU/CUDA/MPS) and may download weights; run targeted subsets locally before full runs.
- For frontend changes, run at least `npm run build` to catch type/build regressions.

## Commit & Pull Request Guidelines
- Use short, imperative commit messages; optional scope prefixes are encouraged (e.g. `frontend:`, `backend:`, `plugins:`).
- Keep commits focused (one logical change per commit when possible).
- PRs should include:
  - Problem statement and root cause.
  - Summary of key code changes.
  - Verification steps/commands run.
  - Screenshots or short recordings for UI behavior changes.

## Security & Configuration Tips
- Do not commit secrets/tokens or machine-local paths.
- Keep runtime/model cache outside the repo (default user cache directory).
- HuggingFace gated-model token is read from local files in this order:
  - `D:\Programs\IOPaint\secrets.json` (project-local, preferred)
  - `C:\Users\<username>\.artie\secrets.json` (user fallback)
  - File format: `{"hf_token": "hf_xxx"}`
- For frontend local config, use `web_app/.env.local` (e.g. `VITE_BACKEND=http://127.0.0.1:8080`).
