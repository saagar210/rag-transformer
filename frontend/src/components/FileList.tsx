import { useState, useCallback, useRef, useEffect } from "react"
import type { FileItem } from "../App"

interface Props {
  files: FileItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onCopy: (id: string) => void
  onCopyAll: () => void
  onDownload: (id: string) => void
  onDownloadAll: () => void
}

function StatusIcon({ status }: { status: FileItem["status"] }) {
  switch (status) {
    case "queued":
      return <span className="text-dim">○</span>
    case "processing":
      return <span className="text-muted spin-slow inline-block">↻</span>
    case "done":
      return <span className="text-success">✓</span>
    case "error":
      return <span className="text-error">✗</span>
  }
}

export default function FileList({
  files,
  selectedId,
  onSelect,
  onRemove,
  onCopy,
  onCopyAll,
  onDownload,
  onDownloadAll,
}: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      if (copyAllTimerRef.current) clearTimeout(copyAllTimerRef.current)
    }
  }, [])

  const handleCopy = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      onCopy(id)
      setCopiedId(id)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000)
    },
    [onCopy]
  )

  const handleCopyAll = useCallback(() => {
    onCopyAll()
    setCopiedAll(true)
    if (copyAllTimerRef.current) clearTimeout(copyAllTimerRef.current)
    copyAllTimerRef.current = setTimeout(() => setCopiedAll(false), 2000)
  }, [onCopyAll])

  const doneFiles = files.filter((f) => f.status === "done")

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-4 py-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted">
          Files
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {files.map((file) => (
          <div
            key={file.id}
            className={`h-11 px-4 flex items-center gap-3 cursor-pointer transition-all duration-150 group ${
              selectedId === file.id
                ? "border-l-2 border-accent bg-surface"
                : "border-l-2 border-transparent hover:bg-surface"
            }`}
            onClick={() => onSelect(file.id)}
          >
            <StatusIcon status={file.status} />
            <span className="flex-1 text-xs truncate text-text">
              {file.name}
            </span>

            {/* Per-file actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {file.status === "done" && (
                <>
                  <button
                    aria-label={`Copy ${file.name}`}
                    className={`text-[10px] px-2 py-0.5 rounded-sm transition-all ${
                      copiedId === file.id
                        ? "bg-[#1a3a1a] border border-[#2d6a2d] text-success"
                        : "border border-border text-muted hover:text-text hover:border-muted"
                    }`}
                    onClick={(e) => handleCopy(file.id, e)}
                  >
                    {copiedId === file.id ? "✓" : "Copy"}
                  </button>
                  <button
                    aria-label={`Download ${file.name}`}
                    className="text-[10px] px-2 py-0.5 border border-border text-muted rounded-sm hover:text-text hover:border-muted transition-all"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDownload(file.id)
                    }}
                  >
                    ↓
                  </button>
                </>
              )}
              {file.status !== "processing" && (
                <button
                  aria-label={`Remove ${file.name}`}
                  className="text-[10px] px-2 py-0.5 border border-border text-muted rounded-sm hover:text-error hover:border-error transition-all"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(file.id)
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom actions */}
      {doneFiles.length > 0 && (
        <div className="border-t border-border px-4 py-3 flex gap-2 shrink-0">
          <button
            className={`text-[10px] tracking-[0.1em] uppercase px-3 py-1 border rounded-sm transition-all ${
              copiedAll
                ? "bg-[#1a3a1a] border-[#2d6a2d] text-success"
                : "border-border text-muted hover:text-text hover:border-muted"
            }`}
            onClick={handleCopyAll}
          >
            {copiedAll ? "✓ Copied" : "Copy All"}
          </button>
          <button
            className="text-[10px] tracking-[0.1em] uppercase px-3 py-1 border border-border text-muted rounded-sm hover:text-text hover:border-muted transition-all"
            onClick={onDownloadAll}
          >
            Download All
          </button>
        </div>
      )}
    </div>
  )
}
