#!/bin/bash

echo "==================================="
echo "  RAG Transformer"
echo "==================================="
echo ""

cd "$(dirname "$0")"

DEFAULT_MODEL="llama3.2"
PORT=8000

# --- Check Python 3 ---
if ! command -v python3 &>/dev/null; then
  echo "Python 3 is required."
  echo "Download from: https://www.python.org/downloads/"
  osascript -e 'display alert "Python 3 is required" message "Download from python.org" as critical' 2>/dev/null
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
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt -q --disable-pip-version-check 2>/dev/null

# --- Ensure Ollama API is reachable ---
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "Starting Ollama..."
  ollama serve > /dev/null 2>&1 &
  for i in {1..10}; do
    sleep 1
    curl -s http://localhost:11434/api/tags > /dev/null 2>&1 && break
  done
fi

# --- Pull model if not installed ---
if ! ollama list 2>/dev/null | grep -q "$DEFAULT_MODEL"; then
  echo ""
  echo "Downloading AI model '$DEFAULT_MODEL' (~2GB, one-time)..."
  echo "This may take a few minutes on first run."
  echo ""
  ollama pull "$DEFAULT_MODEL"
fi

# --- Check if port is already in use ---
if lsof -i :$PORT -sTCP:LISTEN > /dev/null 2>&1; then
  echo "Port $PORT is already in use."
  echo "Another instance may be running. Opening browser..."
  open "http://localhost:$PORT"
  exit 0
fi

# --- Start server ---
echo ""
echo "Starting RAG Transformer..."
python3 app.py &
SERVER_PID=$!

trap "kill $SERVER_PID 2>/dev/null; echo ''; echo 'Stopped.'; exit 0" EXIT INT TERM

for i in {1..20}; do
  curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1 && break
  sleep 1
done

open "http://localhost:$PORT"
echo ""
echo "RAG Transformer is running at http://localhost:$PORT"
echo "Press Ctrl+C to stop."
echo ""

wait $SERVER_PID
