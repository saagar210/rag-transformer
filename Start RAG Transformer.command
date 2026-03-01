#!/bin/bash

echo "==================================="
echo "  RAG Transformer"
echo "==================================="
echo ""

cd "$(dirname "$0")"

DEFAULT_MODEL="llama3.2"
PORT=8000
OLLAMA_PID=""

# --- Check Python 3 ---
if ! command -v python3 &>/dev/null; then
  echo "Python 3 is required."
  echo "Download from: https://www.python.org/downloads/"
  osascript -e 'display alert "Python 3 is required" message "Download from python.org" as critical' 2>/dev/null
  exit 1
fi

# --- Check minimum Python version (3.10+) ---
PY_OK=$(python3 -c "import sys; print(int(sys.version_info >= (3, 10)))" 2>/dev/null)
if [ "$PY_OK" != "1" ]; then
  echo "Python 3.10 or newer is required."
  echo "Download from: https://www.python.org/downloads/"
  osascript -e 'display alert "Python 3.10+ is required" message "Download from python.org" as critical' 2>/dev/null
  exit 1
fi

# --- Check Ollama ---
if ! command -v ollama &>/dev/null; then
  echo "Ollama is required."
  echo "Download from: https://ollama.com"
  osascript -e 'display alert "Ollama is required" message "Download from ollama.com" as critical' 2>/dev/null
  exit 1
fi

# --- Virtual environment (one-time) ---
if [ ! -d ".venv" ]; then
  echo "Setting up Python environment (one-time)..."
  if ! python3 -m venv .venv; then
    rm -rf .venv
    echo "ERROR: Failed to create virtual environment."
    osascript -e 'display alert "Setup failed" message "Could not create Python virtual environment." as critical' 2>/dev/null
    exit 1
  fi
fi
source .venv/bin/activate

# --- Install dependencies (skip if requirements haven't changed) ---
REQS_HASH=$(md5 -q requirements.txt 2>/dev/null || md5sum requirements.txt 2>/dev/null | cut -d' ' -f1)
HASH_FILE=".venv/.reqs_hash"
if [ "$(cat "$HASH_FILE" 2>/dev/null)" != "$REQS_HASH" ]; then
  echo "Installing dependencies..."
  if ! pip install -r requirements.txt -q --disable-pip-version-check; then
    echo "ERROR: Failed to install dependencies. Check your internet connection."
    osascript -e 'display alert "Dependency install failed" message "Check your internet connection and try again." as critical' 2>/dev/null
    exit 1
  fi
  echo "$REQS_HASH" > "$HASH_FILE"
fi

# --- Ensure Ollama API is reachable ---
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "Starting Ollama..."
  ollama serve > /dev/null 2>&1 &
  OLLAMA_PID=$!
  OLLAMA_READY=0
  for i in {1..10}; do
    sleep 1
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
      OLLAMA_READY=1
      break
    fi
  done
  if [ $OLLAMA_READY -eq 0 ]; then
    echo "ERROR: Ollama did not start within 10 seconds."
    echo "Try launching the Ollama app from your Applications folder."
    osascript -e 'display alert "Ollama failed to start" message "Try launching Ollama manually from your Applications folder." as critical' 2>/dev/null
    exit 1
  fi
fi

# --- Pull model if not installed ---
if ! ollama list 2>/dev/null | grep -qE "^${DEFAULT_MODEL}\s"; then
  echo ""
  echo "Downloading AI model '$DEFAULT_MODEL' (~2GB, one-time)..."
  echo "This may take a few minutes on first run."
  echo ""
  ollama pull "$DEFAULT_MODEL"
fi

# --- Check if port is already in use ---
if lsof -i :$PORT -sTCP:LISTEN > /dev/null 2>&1; then
  if curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    echo "RAG Transformer is already running. Opening browser..."
    open "http://localhost:$PORT"
  else
    echo "ERROR: Port $PORT is in use by another application."
    osascript -e "display alert \"Port $PORT is busy\" message \"Another app is using port $PORT. Close it and try again.\" as critical" 2>/dev/null
  fi
  exit 0
fi

# --- Set up cleanup trap BEFORE starting server ---
cleanup() {
  kill $SERVER_PID 2>/dev/null
  [ -n "$OLLAMA_PID" ] && kill $OLLAMA_PID 2>/dev/null
  echo ""
  echo "Stopped."
  exit 0
}
trap cleanup EXIT INT TERM

# --- Start server ---
echo ""
echo "Starting RAG Transformer..."
.venv/bin/python app.py &
SERVER_PID=$!

# Wait for server to be ready
SERVER_READY=0
for i in {1..20}; do
  if curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  # Check if server process died early
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ $SERVER_READY -eq 0 ]; then
  echo "ERROR: Server failed to start. Check the output above for errors."
  exit 1
fi

open "http://localhost:$PORT"
echo ""
echo "RAG Transformer is running at http://localhost:$PORT"
echo "Press Ctrl+C to stop."
echo ""

wait $SERVER_PID
