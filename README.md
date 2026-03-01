# RAG Transformer

A Mac desktop tool that converts documents into RAG-optimized format using a local AI model. Drop files in, get clean, structured text out. No Docker, no API keys, no terminal knowledge required.

Supports: `.docx`, `.pdf`, `.md`, `.txt`, `.html`

## Quick Start

### Prerequisites

Install [Ollama](https://ollama.com) — standard Mac installer, one-time.

### Option A: Git Clone

```
git clone https://github.com/saagar210/rag-transformer.git
cd rag-transformer
```

Double-click `Start RAG Transformer.command`.

### Option B: Download ZIP

1. Click the green **Code** button on GitHub → **Download ZIP**
2. Unzip the folder
3. Double-click `Start RAG Transformer.command`

### First Run on macOS

If macOS says the file "can't be opened because it is from an unidentified developer":

1. Right-click the `.command` file
2. Click **Open**
3. Click **Open** again in the dialog

This only happens once.

## How to Use

1. Double-click the launcher — it handles everything (Python setup, model download, server start)
2. Your browser opens automatically
3. Drop files into the left panel
4. Files process sequentially through the AI model
5. Copy or download the transformed results

## Changing the AI Model

Use the dropdown in the top-right corner of the app. The selection is saved between sessions.

To change the default model that gets downloaded on first run, edit `DEFAULT_MODEL` in `Start RAG Transformer.command`.

## Supported File Types

| Type | Extension | Notes |
|------|-----------|-------|
| Word | `.docx` | Paragraph text extracted |
| PDF | `.pdf` | All pages extracted |
| Markdown | `.md` | Raw text |
| Plain text | `.txt` | Raw text |
| HTML | `.html` | Tags stripped, text kept |

**Box Notes:** Export as `.docx` or PDF first, then drop the exported file.

## Troubleshooting

**"Ollama is required" alert**
Install Ollama from [ollama.com](https://ollama.com).

**"Python 3 is required" alert**
Install Python from [python.org](https://www.python.org/downloads/).

**Model download seems stuck**
The first run downloads ~2GB. On slow connections this can take 10+ minutes. The terminal window shows progress.

**Port 8000 already in use**
Another instance may be running. The launcher will detect this and open the existing instance.

**Browser shows blank page**
Wait a few seconds for the server to start. Refresh the page.

## For Developers

To modify the frontend:

```
cd frontend
npm install
npm run dev
```

This starts Vite dev server on port 5173 with hot reload. API calls proxy to `localhost:8000`.

To rebuild for production:

```
cd frontend
npm run build
```

This outputs to `dist/` which is served by the Python backend.
