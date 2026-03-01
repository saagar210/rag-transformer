from unittest.mock import AsyncMock, MagicMock

from tests.conftest import parse_sse


class TestTransformStreaming:
    def test_streams_original_and_tokens(self, client, mock_ollama):
        async def fake_chat_gen():
            for word in ["Hello", " world"]:
                chunk = MagicMock()
                chunk.message.content = word
                yield chunk

        mock_ollama.chat = AsyncMock(return_value=fake_chat_gen())

        r = client.post(
            "/api/transform",
            data={"model": "llama3.2"},
            files={"file": ("doc.txt", b"Source text", "text/plain")},
        )
        assert r.status_code == 200
        events = parse_sse(r.text)

        originals = [e for e in events if "original" in e]
        assert len(originals) == 1
        assert originals[0]["original"] == "Source text"

        tokens = [e for e in events if "token" in e]
        assert any(t["token"] == "Hello" for t in tokens)

        done_events = [e for e in events if e.get("done")]
        assert len(done_events) == 1
        assert "full_text" in done_events[0]

    def test_empty_file_sends_error_event(self, client):
        r = client.post(
            "/api/transform",
            data={"model": "llama3.2"},
            files={"file": ("empty.txt", b"", "text/plain")},
        )
        assert r.status_code == 200
        events = parse_sse(r.text)
        assert any("error" in e for e in events)

    def test_ollama_failure_sends_error_event(self, client, mock_ollama):
        async def failing_chat_gen():
            raise Exception("model not found")
            yield  # make it an async generator

        mock_ollama.chat = AsyncMock(return_value=failing_chat_gen())

        r = client.post(
            "/api/transform",
            data={"model": "llama3.2"},
            files={"file": ("doc.txt", b"Some text", "text/plain")},
        )
        events = parse_sse(r.text)
        assert any("error" in e for e in events)
