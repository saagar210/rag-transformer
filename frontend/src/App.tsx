import { useState, useEffect, useCallback, useRef } from "react"
import DropZone from "./components/DropZone"
import FileList from "./components/FileList"
import ArticleViewer from "./components/ArticleViewer"
import ModelSelector from "./components/ModelSelector"

export interface FileItem {
  id: string
  file: File
  name: string
  status: "queued" | "processing" | "done" | "error"
  originalText: string
  transformedText: string
  error?: string
}

function parseSSELine(
  line: string,
  fileId: string,
  setFiles: React.Dispatch<React.SetStateAction<FileItem[]>>
) {
  if (!line.startsWith("data: ")) return
  try {
    const payload = JSON.parse(line.slice(6))
    if (payload.original) {
      setFiles((p) =>
        p.map((f) => (f.id === fileId ? { ...f, originalText: payload.original } : f))
      )
    } else if (payload.error) {
      setFiles((p) =>
        p.map((f) =>
          f.id === fileId ? { ...f, status: "error", error: payload.error } : f
        )
      )
    } else if (payload.token) {
      setFiles((p) =>
        p.map((f) =>
          f.id === fileId
            ? { ...f, transformedText: f.transformedText + payload.token }
            : f
        )
      )
    } else if (payload.done) {
      setFiles((p) =>
        p.map((f) =>
          f.id === fileId
            ? { ...f, status: "done", transformedText: payload.full_text }
            : f
        )
      )
    }
  } catch {
    // skip malformed JSON
  }
}

async function processFile(
  fileId: string,
  file: File,
  model: string,
  signal: AbortSignal,
  setFiles: React.Dispatch<React.SetStateAction<FileItem[]>>
) {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("model", model)

  const response = await fetch("/api/transform", {
    method: "POST",
    body: formData,
    signal,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Server error" }))
    setFiles((p) =>
      p.map((f) =>
        f.id === fileId
          ? { ...f, status: "error", error: err.detail || "Server error" }
          : f
      )
    )
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      parseSSELine(line, fileId, setFiles)
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    parseSSELine(buffer.trim(), fileId, setFiles)
  }

  // If still processing (no done event), mark done with whatever we have
  setFiles((p) =>
    p.map((f) =>
      f.id === fileId && f.status === "processing" ? { ...f, status: "done" } : f
    )
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState(() =>
    localStorage.getItem("rag-model") || ""
  )
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const processingRef = useRef(false)
  const controllersRef = useRef<Map<string, AbortController>>(new Map())
  const filesRef = useRef(files)
  filesRef.current = files
  const modelRef = useRef(selectedModel)
  modelRef.current = selectedModel

  // Fetch models on mount
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/models", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setOllamaError(data.error)
        } else {
          setOllamaError(null)
        }
        const names = (data.models || []).map((m: { name: string }) => m.name)
        setModels(names)
        setSelectedModel((prev) => {
          if (names.length > 0 && !names.includes(prev)) return names[0]
          return prev
        })
      })
      .catch(() => setOllamaError("Cannot reach Ollama. Make sure it's running."))
    return () => controller.abort()
  }, [])

  // Persist model selection
  useEffect(() => {
    if (selectedModel) localStorage.setItem("rag-model", selectedModel)
  }, [selectedModel])

  // Process next queued file
  const processNext = useCallback(async () => {
    if (processingRef.current) return

    const currentFiles = filesRef.current
    const next = currentFiles.find((f) => f.status === "queued")
    if (!next) return

    processingRef.current = true
    const fileId = next.id
    const file = next.file

    setFiles((p) => p.map((f) => (f.id === fileId ? { ...f, status: "processing" } : f)))
    setSelectedFileId(fileId)

    const controller = new AbortController()
    controllersRef.current.set(fileId, controller)

    try {
      await processFile(fileId, file, modelRef.current, controller.signal, setFiles)
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setFiles((p) =>
          p.map((f) =>
            f.id === fileId
              ? { ...f, status: "error", error: "Processing failed unexpectedly." }
              : f
          )
        )
      }
    }

    controllersRef.current.delete(fileId)
    processingRef.current = false
  }, [])

  // Watch for queue changes — trigger next file
  useEffect(() => {
    if (!processingRef.current && files.some((f) => f.status === "queued")) {
      processNext()
    }
  }, [files, processNext])

  const handleFilesAdded = useCallback((newFiles: File[]) => {
    const items: FileItem[] = newFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      status: "queued" as const,
      originalText: "",
      transformedText: "",
    }))
    setFiles((prev) => [...prev, ...items])
    setSelectedFileId((prev) => prev ?? items[0]?.id ?? null)
  }, [])

  const handleRemove = useCallback((id: string) => {
    // Abort in-flight stream if any
    controllersRef.current.get(id)?.abort()
    controllersRef.current.delete(id)

    setFiles((prev) => {
      const updated = prev.filter((f) => f.id !== id)
      return updated
    })
    setSelectedFileId((prev) => {
      if (prev !== id) return prev
      // Select adjacent file
      const current = filesRef.current
      const idx = current.findIndex((f) => f.id === id)
      const next = current[idx + 1] || current[idx - 1]
      return next?.id ?? null
    })
  }, [])

  const handleCopy = useCallback((id: string) => {
    const file = filesRef.current.find((f) => f.id === id)
    if (file?.transformedText) {
      navigator.clipboard.writeText(file.transformedText)
    }
  }, [])

  const handleCopyAll = useCallback(() => {
    const doneFiles = filesRef.current.filter((f) => f.status === "done")
    const text = doneFiles
      .map((f) => `--- ${f.name} ---\n\n${f.transformedText}`)
      .join("\n\n")
    navigator.clipboard.writeText(text)
  }, [])

  const handleDownload = useCallback((id: string) => {
    const file = filesRef.current.find((f) => f.id === id)
    if (!file?.transformedText) return
    const stem = file.name.replace(/\.[^.]+$/, "")
    const blob = new Blob([file.transformedText], { type: "text/plain" })
    triggerDownload(blob, `${stem}_rag.txt`)
  }, [])

  const handleDownloadAll = useCallback(async () => {
    const doneFiles = filesRef.current.filter((f) => f.status === "done")
    if (doneFiles.length === 0) return
    try {
      const payload = {
        files: doneFiles.map((f) => ({ name: f.name, text: f.transformedText })),
      }
      const response = await fetch("/api/download-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error("Download failed")
      const blob = await response.blob()
      triggerDownload(blob, "rag-transformed.zip")
    } catch (err) {
      console.error("Download all failed:", err)
    }
  }, [])

  const selectedFile = files.find((f) => f.id === selectedFileId) || null

  const doneCount = files.filter((f) => f.status === "done").length
  const processingCount = files.filter((f) => f.status === "processing").length
  const queuedCount = files.filter((f) => f.status === "queued").length

  return (
    <div className="min-h-screen bg-bg text-text font-mono flex flex-col">
      {/* Header */}
      <header className="h-[60px] border-b border-border px-8 flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] tracking-[0.2em] uppercase text-muted">RAG</span>
          <span className="text-base font-medium text-text">Transformer</span>
        </div>
        <ModelSelector
          models={models}
          selected={selectedModel}
          onChange={setSelectedModel}
        />
      </header>

      {/* Ollama error banner */}
      {ollamaError && (
        <div className="px-8 py-2 bg-[#3a1a1a] border-b border-[#5a2a2a] text-error text-xs">
          {ollamaError}
        </div>
      )}

      {/* Main */}
      <div className="flex-1 grid grid-cols-[320px_1fr] h-[calc(100vh-60px)]">
        {/* Left sidebar */}
        <div className="border-r border-border flex flex-col overflow-hidden">
          <div className="p-4 shrink-0">
            <DropZone onFilesAdded={handleFilesAdded} hasFiles={files.length > 0} />
          </div>

          {files.length > 0 && (
            <FileList
              files={files}
              selectedId={selectedFileId}
              onSelect={setSelectedFileId}
              onRemove={handleRemove}
              onCopy={handleCopy}
              onCopyAll={handleCopyAll}
              onDownload={handleDownload}
              onDownloadAll={handleDownloadAll}
            />
          )}
        </div>

        {/* Right pane */}
        <div className="overflow-hidden flex flex-col">
          {selectedFile ? (
            <ArticleViewer
              originalText={selectedFile.originalText}
              transformedText={selectedFile.transformedText}
              isStreaming={selectedFile.status === "processing"}
              status={selectedFile.status}
              error={selectedFile.error}
              fileName={selectedFile.name}
              onCopy={() => handleCopy(selectedFile.id)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-dim text-sm leading-relaxed max-w-sm">
                <p className="mb-4">Drop files on the left to start.</p>
                <p className="mb-4">
                  Supports .docx, .pdf, .md,
                  <br />.txt, and .html files.
                </p>
                <p>
                  Articles will be converted to
                  <br />
                  RAG-optimized plain text format.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      {files.length > 0 && (
        <div className="h-10 border-t border-border px-6 flex items-center text-[10px] text-dim tracking-wide shrink-0">
          {files.length} file{files.length !== 1 ? "s" : ""} · {doneCount} done
          {processingCount > 0 && ` · ${processingCount} processing`}
          {queuedCount > 0 && ` · ${queuedCount} queued`}
        </div>
      )}
    </div>
  )
}
