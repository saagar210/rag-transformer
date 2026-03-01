import { useState, useCallback, useEffect, useRef } from "react"

interface Props {
  originalText: string
  transformedText: string
  isStreaming: boolean
  status: "queued" | "processing" | "done" | "error"
  error?: string
  fileName: string
  onCopy: () => void
}

export default function ArticleViewer({
  originalText,
  transformedText,
  isStreaming,
  status,
  error,
  fileName,
  onCopy,
}: Props) {
  const [copied, setCopied] = useState(false)
  const transformedRef = useRef<HTMLDivElement>(null)

  const handleCopy = useCallback(() => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [onCopy])

  // Auto-scroll transformed pane during streaming
  useEffect(() => {
    if (isStreaming && transformedRef.current) {
      transformedRef.current.scrollTop = transformedRef.current.scrollHeight
    }
  }, [transformedText, isStreaming])

  return (
    <div className="flex flex-col h-full">
      {/* File name */}
      <div className="py-3 px-6 border-b border-border">
        <span className="text-sm text-text">{fileName}</span>
      </div>

      {/* Error state */}
      {status === "error" && (
        <div className="m-6 p-4 bg-[#3a1a1a] border border-[#5a2a2a] rounded-sm">
          <p className="text-error text-xs">{error || "An error occurred"}</p>
        </div>
      )}

      {/* Original section */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="py-3 px-6 border-b border-border flex justify-between items-center shrink-0">
          <span className="text-[10px] tracking-[0.18em] uppercase text-muted">
            Original
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {originalText ? (
            <pre className="text-[13px] leading-[1.7] text-[#c8c4b9] whitespace-pre-wrap break-words font-mono">
              {originalText}
            </pre>
          ) : status === "processing" ? (
            <p className="text-dim text-xs">Extracting text...</p>
          ) : (
            <p className="text-dim text-xs">No text extracted</p>
          )}
        </div>
      </div>

      {/* Transformed section */}
      <div className="flex flex-col flex-1 min-h-0 border-t border-border">
        <div className="py-3 px-6 border-b border-border flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[10px] tracking-[0.18em] uppercase text-muted">
              Transformed
            </span>
            {isStreaming && (
              <span className="flex items-center gap-1.5 text-[10px] text-muted">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent pulse-dot" />
                Transforming...
              </span>
            )}
          </div>
          {(status === "done" || transformedText) && (
            <button
              className={`text-[10px] tracking-[0.1em] uppercase px-3 py-1 border rounded-sm transition-all ${
                copied
                  ? "bg-[#1a3a1a] border-[#2d6a2d] text-success"
                  : "border-border text-muted hover:text-text hover:border-muted"
              }`}
              onClick={handleCopy}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          )}
        </div>
        <div ref={transformedRef} className="flex-1 overflow-y-auto p-6 min-h-0">
          {transformedText ? (
            <pre className="text-[13px] leading-[1.7] text-[#c8c4b9] whitespace-pre-wrap break-words font-mono">
              {transformedText}
              {isStreaming && <span className="cursor" />}
            </pre>
          ) : status === "processing" ? (
            <p className="text-dim text-xs flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted pulse-dot" />
              Waiting for model...
            </p>
          ) : status === "queued" ? (
            <p className="text-dim text-xs">Queued for processing</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
