import json
import io
import zipfile
from html.parser import HTMLParser
from pathlib import Path

import fitz  # pymupdf
import uvicorn
from docx import Document
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import StreamingResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from ollama import AsyncClient

SYSTEM_PROMPT = """You are a technical writer converting articles into RAG-optimized format.

RAG systems retrieve individual chunks to answer questions.
Good RAG content is structured so every section stands alone.

OUTPUT FORMAT — follow exactly:

[Title as a clear question or statement]

Overview
1-2 sentences. What this covers and when to use it.

[Descriptive section heading]
[Body text or numbered steps]
1. Step one.
2. Step two.

[Additional sections as needed]

Expected Outcome
What success looks like.

[Escalation — only if applicable]
If [condition], [action].

RULES:
- Plain text only — no markdown formatting
- No vague language: never "may", "usually", "try", "might"
- Name things explicitly — no vague pronouns
- Each section fully self-contained
- Preserve all factual content from the source

Return only the article. No commentary."""

SUPPORTED_EXTENSIONS = {".docx", ".pdf", ".html", ".htm", ".txt", ".md", ".rst"}

app = FastAPI()

# --- Document Parsers ---


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = False
        if tag in ("p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr"):
            self._parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self._parts.append(data)

    def get_text(self) -> str:
        return "".join(self._parts).strip()


def extract_text(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()

    if ext == ".docx":
        doc = Document(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())

    if ext == ".pdf":
        pdf = fitz.open(stream=content, filetype="pdf")
        pages = [page.get_text() for page in pdf]
        pdf.close()
        return "\n".join(pages).strip()

    if ext in (".html", ".htm"):
        parser = _TextExtractor()
        parser.feed(content.decode("utf-8", errors="replace"))
        return parser.get_text()

    if ext in (".txt", ".md", ".rst"):
        return content.decode("utf-8", errors="replace").strip()

    raise HTTPException(
        status_code=422,
        detail=f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
    )


# --- API Endpoints ---


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/models")
async def list_models():
    try:
        client = AsyncClient()
        response = await client.list()
        models = [{"name": m.model, "size": m.size} for m in response.models]
        return {"models": models}
    except Exception:
        return {"models": [], "error": "Cannot reach Ollama. Make sure it's running."}


@app.post("/api/transform")
async def transform(file: UploadFile = File(...), model: str = Form(...)):
    content = await file.read()
    filename = file.filename or "unknown.txt"

    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    text = extract_text(filename, content)

    if not text.strip():
        async def error_stream():
            yield f"data: {json.dumps({'error': 'No text could be extracted from this file.'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    async def generate():
        yield f"data: {json.dumps({'original': text})}\n\n"

        full_text = ""
        try:
            client = AsyncClient()
            stream = await client.chat(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Transform this article into RAG-optimized format:\n\n{text}"},
                ],
                stream=True,
            )
            async for chunk in stream:
                token = chunk["message"]["content"]
                full_text += token
                yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True, 'full_text': full_text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/download-all")
async def download_all(payload: dict):
    files = payload.get("files", [])
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            name = Path(f["name"]).stem + "_rag.txt"
            zf.writestr(name, f["text"])
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=rag-transformed.zip"},
    )


# --- Static File Serving ---

dist_dir = Path(__file__).parent / "dist"

if (dist_dir / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets")


@app.get("/{path:path}")
async def serve_spa(path: str):
    # Try to serve the exact file first
    file_path = dist_dir / path
    if path and file_path.is_file():
        return FileResponse(str(file_path))
    # Fall back to index.html for SPA routing
    index = dist_dir / "index.html"
    if index.is_file():
        return FileResponse(str(index))
    return Response(content="Frontend not built. Run: cd frontend && npm run build", status_code=404)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
