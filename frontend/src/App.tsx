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

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([])
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState(() =>
    localStorage.getItem("rag-model") || ""
  )
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const processingRef = useRef(false)

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
        if (names.length > 0 && !names.includes(selectedModel)) {
          setSelectedModel(names[0])
        }
      })
      .catch(() => setOllamaError("Cannot reach Ollama. Make sure it's running."))
    return () => controller.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist model selection
  useEffect(() => {
    if (selectedModel) localStorage.setItem("rag-model", selectedModel)
  }, [selectedModel])

  // Process next queued file
  const processNext = useCallback(async () => {
    if (processingRef.current) return

    setFiles((prev) => {
      const next = prev.find((f) => f.status === "queued")
      if (!next) return prev
      processingRef.current = true

      // Start processing async
      const fileId = next.id
      const file = next.file

      ;(async () => {
        setFiles((p) => p.map((f) => (f.id === fileId ? { ...f, status: "processing" } : f)))
        setSelectedFileId(fileId)

        const formData = new FormData()
        formData.append("file", file)
        formData.append("model", selectedModel)

        try {
          const response = await fetch("/api/transform", {
            method: "POST",
            body: formData,
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
            processingRef.current = false
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
              if (!line.startsWith("data: ")) continue
              try {
                const payload = JSON.parse(line.slice(6))
                if (payload.original) {
                  setFiles((p) =>
                    p.map((f) =>
                      f.id === fileId ? { ...f, originalText: payload.original } : f
                    )
                  )
                } else if (payload.error) {
                  setFiles((p) =>
                    p.map((f) =>
                      f.id === fileId
                        ? { ...f, status: "error", error: payload.error }
                        : f
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
          }

          // If still processing (no done event), mark done with whatever we have
          setFiles((p) =>
            p.map((f) =>
              f.id === fileId && f.status === "processing"
                ? { ...f, status: "done" }
                : f
            )
          )
        } catch (err) {
          setFiles((p) =>
            p.map((f) =>
              f.id === fileId
                ? { ...f, status: "error", error: String(err) }
                : f
            )
          )
        }

        processingRef.current = false
      })()

      return prev.map((f) => (f.id === fileId ? { ...f, status: "processing" } : f))
    })
  }, [selectedModel])

  // Watch for queue changes
  useEffect(() => {
    if (!processingRef.current && files.some((f) => f.status === "queued")) {
      processNext()
    }
  }, [files, processNext])

  const handleFilesAdded = useCallback(
    (newFiles: File[]) => {
      const items: FileItem[] = newFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        status: "queued" as const,
        originalText: "",
        transformedText: "",
      }))
      setFiles((prev) => [...prev, ...items])
      if (!selectedFileId && items.length > 0) {
        setSelectedFileId(items[0].id)
      }
    },
    [selectedFileId]
  )

  const handleRemove = useCallback(
    (id: string) => {
      setFiles((prev) => prev.filter((f) => f.id !== id))
      if (selectedFileId === id) {
        setSelectedFileId(null)
      }
    },
    [selectedFileId]
  )

  const handleCopy = useCallback(
    (id: string) => {
      const file = files.find((f) => f.id === id)
      if (file?.transformedText) {
        navigator.clipboard.writeText(file.transformedText)
      }
    },
    [files]
  )

  const handleCopyAll = useCallback(() => {
    const doneFiles = files.filter((f) => f.status === "done")
    const text = doneFiles
      .map((f) => `--- ${f.name} ---\n\n${f.transformedText}`)
      .join("\n\n")
    navigator.clipboard.writeText(text)
  }, [files])

  const handleDownload = useCallback(
    (id: string) => {
      const file = files.find((f) => f.id === id)
      if (!file?.transformedText) return
      const stem = file.name.replace(/\.[^.]+$/, "")
      const blob = new Blob([file.transformedText], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${stem}_rag.txt`
      a.click()
      URL.revokeObjectURL(url)
    },
    [files]
  )

  const handleDownloadAll = useCallback(async () => {
    const doneFiles = files.filter((f) => f.status === "done")
    const payload = {
      files: doneFiles.map((f) => ({ name: f.name, text: f.transformedText })),
    }
    const response = await fetch("/api/download-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "rag-transformed.zip"
    a.click()
    URL.revokeObjectURL(url)
  }, [files])

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
