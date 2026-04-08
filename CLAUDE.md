# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Artie is an AI-powered image editing system built on FastAPI (Python backend) + React/TypeScript (frontend). It supports inpainting, text-to-image generation, outpainting, background removal, super-resolution, and face restoration — all running locally.

## Commands

### Backend

```bash
# Start the server — zero-config, all models auto-download, all plugins auto-enable
./.venv/Scripts/python.exe main.py start --device cuda --port 8080

# Key CLI flags:
#   --max-cached-models N     LRU model cache size (default: 3)
#   --max-vram-usage-gb X     VRAM cap in GB
#   --disable-auth            Skip JWT auth (anonymous mode, good for local dev)
#   --auth-secret-key KEY     JWT signing secret
#   --db-path PATH            Custom SQLite path (default: ~/.artie/artie.db)
#   --local-files-only        No HuggingFace downloads (offline mode)
#   --no-half                 Use fp32 instead of fp16 (if outputs are black/green)
#   --cpu-offload             Offload model weights to CPU RAM to save VRAM

# NOTE: --model and --enable-* plugin flags have been removed.
# Models are bound to tabs; plugins are always enabled.

# Syntax check Python files (no deps needed):
./.venv/Scripts/python.exe -m py_compile artie/api.py artie/schema.py

# Download a model manually:
./.venv/Scripts/python.exe main.py download --model runwayml/stable-diffusion-inpainting
```

### Frontend

```bash
cd web_app

npm install          # install dependencies
npm run dev          # dev server at http://localhost:5173 (proxies to backend)
npm run build        # production build → ../artie/web_app/  (served by FastAPI)
npm run lint         # ESLint
```

The Vite dev server (`VITE_BACKEND` env var) proxies API calls to the Python backend. In production, FastAPI serves the built static files from `artie/web_app/`.

## Architecture

### Backend

```
artie/
  cli.py            — Typer CLI; `start` command creates ApiConfig and launches Api
  api.py            — FastAPI app (class Api); all routes registered in __init__
  schema.py         — All Pydantic v2 models (ApiConfig, InpaintRequest, Txt2ImgRequest,
                       UserCreate/Response, ProjectResponse, ImageResponse, etc.)
  model_manager.py  — ModelManager + ModelCache (LRU); wraps model loading/switching
  auth.py           — JWT auth: init_auth(), get_current_user(), get_optional_user()
  db/
    database.py     — SQLAlchemy engine; init_db(path), get_db() FastAPI dependency
    models.py       — ORM: User, Project, Image
    crud.py         — CRUD helpers for all three tables
  model/
    base.py         — InpaintModel (abstract) → DiffusionInpaintModel base classes
    sd.py           — SD 1.5 inpaint models
    sdxl.py         — SDXL inpaint model (StableDiffusionXLInpaintPipeline, 9-ch UNet)
    sdxl_base.py    — SDXL base model for txt2img (StableDiffusionXLPipeline, 4-ch UNet)
    lama.py, mat.py, etc. — non-diffusion erase models
    controlnet.py   — ControlNet wrapper
    brushnet/       — BrushNet wrappers
    power_paint/    — PowerPaint v2
  plugins/
    base_plugin.py  — BasePlugin interface (gen_image / gen_mask)
    remove_bg.py    — RemoveBG (rembg / briaai)
    realesrgan.py   — RealESRGAN upscaler
    gfpgan_plugin.py — GFPGAN face restoration
    interactive_seg.py — SAM / SAM2 interactive segmentation
```

**Model class hierarchy:** `InpaintModel → DiffusionInpaintModel → SD / SDXL / SDXLBase`

**Three-model architecture:** Each tab is bound to a specific model, switched automatically via `POST /api/v1/switch-tab`:
| Tab | Model | Class |
|-----|-------|-------|
| Generate (txt2img) | `stabilityai/stable-diffusion-xl-base-1.0` | `SDXLBase` (4-ch UNet) |
| Inpaint (erase) | `lama` | `LaMa` |
| Outpaint | `diffusers/stable-diffusion-xl-1.0-inpainting-0.1` | `SDXL` (9-ch UNet) |

**SDXL vs SDXLBase:** These are distinct classes for a reason. SDXL inpaint models have a 9-channel UNet (4 latent + 4 masked image + 1 mask), while base SDXL models have a 4-channel UNet. `StableDiffusionXLPipeline` (txt2img) requires 4 channels; `StableDiffusionXLInpaintPipeline` requires 9. Mixing them causes tensor dimension mismatches. `model_manager.py` routes `DIFFUSERS_SDXL` → `SDXLBase`, `DIFFUSERS_SDXL_INPAINT` → `SDXL`.

**Auto-download:** `ensure_all_models_downloaded()` in `download.py` checks `REQUIRED_MODELS` (defined in `const.py`) at startup and downloads any missing ones. Currently: `lama`, SDXL inpaint, SDXL base.

**Plugin system:** All plugins are auto-enabled at startup (hardcoded in `cli.py`). `build_plugins()` in `api.py` instantiates them and stores in a dict keyed by `PluginName`. Invoked via `/api/v1/run_plugin_gen_image` or `run_plugin_gen_mask`. Plugins that support multiple model variants expose `switch_model()`.

**`--disable-auth` behavior:** Creates (or reuses) a DB user with username `__anonymous__`. All resources (projects, images) are still scoped to this user's ID so the data model stays consistent.

**ModelCache key format:** composite of model name + active wrapper config, e.g. `"sd1.5+controlnet_canny"`. Cache invalidation happens explicitly when wrapper config changes.

**Request flow:** `api_inpaint` / `api_txt2img` → `ModelManager.__call__` / `.txt2img()` → current model's `.forward()` / `.txt2img()`. If a user JWT is present, the result is saved to `~/.artie/users/{user_id}/{type}/` and a DB record created.

**Tab-model switching:** Frontend calls `POST /api/v1/switch-tab` (via `switchTab()` in `api.ts`) when the user changes tabs. `setActiveTab` in Zustand triggers this automatically for model-bound tabs (generate, inpaint, outpaint). The `TAB_MODEL_MAP` in `api.py` maps tab names to model names.

### Frontend

```
web_app/src/
  App.tsx             — Root: init → auth gate (AuthPage) → Home (Header + MainLayout + FileSelect)
  AuthPage.tsx        — Standalone full-page login/register (shown before app entry)
  lib/
    types.ts          — All TypeScript types/enums (WorkspaceTab, ModelInfo, UserInfo, etc.)
    states.ts         — Single Zustand store (immer + persist); contains ALL app state:
                         editor state, settings, server config, auth, user data, tab routing
    api.ts            — All fetch/axios calls; auth token injected via setAuthToken()
    utils.ts, const.ts
  components/
    MainLayout.tsx    — Left vertical tab bar + content routing by activeTab
    Header.tsx        — Top bar: file upload, rerun, user menu, settings
    Editor.tsx        — Canvas: drawing mask strokes, zoom/pan (react-zoom-pan-pinch)
    SidePanel/        — Right panel: diffusion options, ControlNet, BrushNet, etc.
    tabs/
      GenerateTab.tsx       — Text-to-image UI
      InpaintTab.tsx        — Canvas + SidePanel + Plugins
      OutpaintTab.tsx       — Canvas with extender auto-enabled
      RemoveBGTab.tsx       — Standalone upload → rembg pipeline
      SuperResTab.tsx       — Standalone upload → RealESRGAN pipeline
      FaceRestoreTab.tsx    — Standalone upload → GFPGAN/RestoreFormer
      InteractiveSegTab.tsx — SAM interactive selection
      MyWorkspaceTab.tsx    — Project/image gallery (auth handled at App level)
    ui/               — shadcn/ui components (Radix + Tailwind)
```

**State design:** A single `useStore` hook (Zustand) holds everything. `activeTab: WorkspaceTab` drives which tab panel renders. `workspaceMode: WorkspaceMode` is kept in sync for legacy compatibility. Auth token is persisted in Zustand's `partialize` (along with `settings` and `fileManagerState`).

**Auth flow:** `App.tsx` fetches `serverConfig` on mount, then calls `restoreSession()`. If `serverConfig.enableAuth` is true and user is not authenticated, `AuthPage` is rendered (full-page gate). When `--disable-auth` is used, `enableAuth` is false and the auth page is skipped entirely.

**Tab visibility:** `MainLayout` derives visible tabs from `model.support_txt2img`, `model.support_outpainting`, and which plugins are listed in `serverConfig.plugins`.

### Key Data Flows

- **Image persistence:** Authenticated inpaint/txt2img results auto-save to `~/.artie/users/{id}/{type}/` via `Api._save_to_user_workspace()`.
- **Real-time progress:** Socket.IO (`/ws`) emits `diffusion_progress` (step N) and `diffusion_finish`; frontend listens via `DiffusionProgress.tsx`.
- **Model switching:** `ModelManager.switch(name)` leaves the old model in LRU cache; `ModelCache._evict_if_needed` evicts by VRAM pressure or count.
- **txt2img:** Uses `SDXLBase` with `StableDiffusionXLPipeline` (separate from the inpaint model). This is a distinct model load, not a reuse of inpaint pipeline components.

## Important Constraints

- **Pydantic v2** is used throughout. Use `model_validate`, `model_dump`, and `model_config = {"from_attributes": True}` on ORM-backed schemas.
- **SQLAlchemy sync** (not async) — `get_db()` yields a plain `Session`. Do not introduce async DB calls.
- **`set_scheduler` and `enable_disable_lcm_lora`** use duck typing (no type annotation on `config`) to accept both `InpaintRequest` and `Txt2ImgRequest`.
- Frontend `@` path alias resolves to `web_app/src/` (configured in `vite.config.ts`). Tab components under `tabs/` must use `../ui/` for shadcn imports.
- The built frontend goes to `artie/web_app/` (not `web_app/dist/`). FastAPI mounts it via `StaticFiles`.
- **UI language is Chinese.** All user-facing text (tab labels, tooltips, auth page, workspace labels, toast messages) is in Chinese. Keep this consistent when adding new UI.
- **Do NOT use `passlib`** for password hashing. Use `bcrypt` directly. passlib's bcrypt backend crashes with bcrypt >= 4.x (`detect_wrap_bug` ValueError). This is a known upstream issue with no fix.
- **SDXL inpaint vs base models must not be mixed.** Inpaint models (9-ch UNet) must use `StableDiffusionXLInpaintPipeline`; base models (4-ch UNet) must use `StableDiffusionXLPipeline`. Using the wrong pipeline causes tensor dimension mismatches at inference time.
- **`--model` CLI flag no longer exists.** Models are bound to tabs via `TAB_MODEL_MAP` in `api.py` and `REQUIRED_MODELS` in `const.py`. Do not re-add per-model CLI selection.
