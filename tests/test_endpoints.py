import io
import zipfile
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.conftest import parse_sse


class TestHealth:
    def test_returns_ok(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


class TestModels:
    def test_returns_empty_list_by_default(self, client):
        r = client.get("/api/models")
        assert r.status_code == 200
        assert r.json()["models"] == []

    def test_returns_model_names(self, client, mock_ollama):
        m = MagicMock()
        m.model = "llama3.2"
        m.size = 2_000_000_000
        resp = MagicMock()
        resp.models = [m]
        mock_ollama.list = AsyncMock(return_value=resp)

        r = client.get("/api/models")
        assert r.json()["models"][0]["name"] == "llama3.2"

    def test_returns_error_key_when_ollama_unreachable(self, client, mock_ollama):
        mock_ollama.list = AsyncMock(side_effect=Exception("connection refused"))
        r = client.get("/api/models")
        assert r.status_code == 200
        assert "error" in r.json()


class TestDownloadAll:
    def test_returns_zip(self, client):
        r = client.post("/api/download-all", json={
            "files": [{"name": "doc.md", "text": "Hello RAG"}]
        })
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/zip"
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        assert "doc_rag.txt" in zf.namelist()
        assert zf.read("doc_rag.txt") == b"Hello RAG"

    def test_sanitizes_filename(self, client):
        r = client.post("/api/download-all", json={
            "files": [{"name": "../etc/passwd", "text": "x"}]
        })
        assert r.status_code == 200
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        # Path traversal components stripped — no ".." or "/" in any zip entry name
        assert not any(".." in n for n in names)
        assert not any("/" in n for n in names)
        # The safe stem (passwd) is preserved — the _path_ traversal is what's sanitized
        assert any(n.endswith("_rag.txt") for n in names)

    def test_rejects_empty_files_list(self, client):
        r = client.post("/api/download-all", json={"files": []})
        assert r.status_code == 422


class TestTransformValidation:
    def test_rejects_invalid_model_name(self, client):
        r = client.post(
            "/api/transform",
            data={"model": "../../evil"},
            files={"file": ("test.txt", b"text", "text/plain")},
        )
        assert r.status_code == 422

    def test_rejects_unsupported_extension(self, client):
        r = client.post(
            "/api/transform",
            data={"model": "llama3.2"},
            files={"file": ("test.exe", b"data", "application/octet-stream")},
        )
        assert r.status_code == 422

    def test_rejects_file_over_50mb(self, client):
        big = b"x" * (50 * 1024 * 1024 + 1)
        r = client.post(
            "/api/transform",
            data={"model": "llama3.2"},
            files={"file": ("big.txt", big, "text/plain")},
        )
        assert r.status_code == 413


class TestSpaServing:
    def test_missing_dist_returns_404_message(self, client, tmp_path, monkeypatch):
        import app as app_module
        monkeypatch.setattr(app_module, "dist_dir", tmp_path)
        monkeypatch.setattr(app_module, "dist_dir_resolved", tmp_path.resolve())
        r = client.get("/nonexistent")
        assert r.status_code == 404

    def test_path_traversal_rejected(self, client, tmp_path, monkeypatch):
        import app as app_module
        monkeypatch.setattr(app_module, "dist_dir", tmp_path)
        monkeypatch.setattr(app_module, "dist_dir_resolved", tmp_path.resolve())
        r = client.get("/../../etc/passwd")
        assert r.status_code in (400, 404)
