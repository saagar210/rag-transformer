import io
import json
import logging
import re
import zipfile
from contextlib import asynccontextmanager
from html.parser import HTMLParser
from pathlib import Path
from typing import List

import fitz  # pymupdf
import uvicorn
from docx import Document
from docx.oxml.ns import qn
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import StreamingResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from ollama import AsyncClient
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

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
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
MODEL_PATTERN = re.compile(r"^[\w.:\-]{1,128}$")

# --- Ollama client lifecycle ---

ollama_client: AsyncClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ollama_client
    ollama_client = AsyncClient()
    yield
    ollama_client = None


app = FastAPI(lifespan=lifespan)

# --- Document Parsers ---


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip_depth > 0:
            self._skip_depth -= 1
        if tag in ("p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr"):
            self._parts.append("\n")

    def handle_data(self, data):
        if self._skip_depth == 0:
            self._parts.append(data)

    def get_text(self) -> str:
        return "".join(self._parts).strip()


def _extract_docx(content: bytes) -> str:
    doc = Document(io.BytesIO(content))
    parts: list[str] = []
    for block in doc.element.body:
        tag = block.tag.split("}")[-1]
        if tag == "p":
            text = "".join(
                node.text or ""
                for node in block.iter()
                if node.tag in (qn("w:t"), qn("w:delText"))
            )
            if text.strip():
                parts.append(text)
        elif tag == "tbl":
            for row in block.iter(qn("w:tr")):
                cells = [
                    "".join(n.text or "" for n in cell.iter(qn("w:t")))
                    for cell in row.iter(qn("w:tc"))
                ]
                row_text = " | ".join(c.strip() for c in cells if c.strip())
                if row_text:
                    parts.append(row_text)
    return "\n".join(parts)


def extract_text(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()

    if ext == ".docx":
        return _extract_docx(content)

    if ext == ".pdf":
        with fitz.open(stream=content, filetype="pdf") as pdf:
            pages = [page.get_text() for page in pdf]
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
        response = await ollama_client.list()
        models = [{"name": m.model, "size": m.size} for m in response.models]
        return {"models": models}
    except Exception:
        return {"models": [], "error": "Cannot reach Ollama. Make sure it's running."}


@app.post("/api/transform")
async def transform(file: UploadFile = File(...), model: str = Form(...)):
    if not MODEL_PATTERN.match(model):
        raise HTTPException(status_code=422, detail="Invalid model name")

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

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
            stream = await ollama_client.chat(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Transform this article into RAG-optimized format:\n\n{text}"},
                ],
                stream=True,
            )
            async for chunk in stream:
                token = chunk.message.content
                full_text += token
                yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True, 'full_text': full_text})}\n\n"
        except Exception:
            logger.exception("Ollama stream error")
            yield f"data: {json.dumps({'error': 'AI generation failed. Check that Ollama is running and the model is available.'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


class FileEntry(BaseModel):
    name: str = Field(max_length=255)
    text: str = Field(max_length=5 * 1024 * 1024)


class DownloadPayload(BaseModel):
    files: List[FileEntry] = Field(min_length=1, max_length=100)


@app.post("/api/download-all")
async def download_all(payload: DownloadPayload):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in payload.files:
            safe_stem = re.sub(r"[^\w\-.]", "_", Path(f.name).stem)
            zf.writestr(f"{safe_stem}_rag.txt", f.text)
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=rag-transformed.zip"},
    )


# --- Static File Serving ---

dist_dir = Path(__file__).parent / "dist"
dist_dir_resolved = dist_dir.resolve()

if (dist_dir / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets")


@app.get("/{path:path}")
async def serve_spa(path: str):
    file_path = (dist_dir / path).resolve()
    # Prevent path traversal
    try:
        file_path.relative_to(dist_dir_resolved)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")

    if path and file_path.is_file():
        return FileResponse(str(file_path))
    index = dist_dir / "index.html"
    if index.is_file():
        return FileResponse(str(index))
    return Response(content="Frontend not built. Run: cd frontend && npm run build", status_code=404)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
