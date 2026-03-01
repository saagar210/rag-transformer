import { useState, useRef, useCallback } from "react"

const SUPPORTED = new Set([".docx", ".pdf", ".html", ".htm", ".txt", ".md", ".rst"])

function getExt(name: string) {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i).toLowerCase() : ""
}

interface Props {
  onFilesAdded: (files: File[]) => void
  hasFiles: boolean
}

export default function DropZone({ onFilesAdded, hasFiles }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCountRef = useRef(0)

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return
      const valid = Array.from(fileList).filter((f) => SUPPORTED.has(getExt(f.name)))
      if (valid.length > 0) onFilesAdded(valid)
    },
    [onFilesAdded]
  )

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current++
    setDragOver(true)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current--
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0
      setDragOver(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragCountRef.current = 0
      setDragOver(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        inputRef.current?.click()
      }
    },
    []
  )

  const sharedProps = {
    role: "button" as const,
    tabIndex: 0,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onKeyDown,
    onClick: () => inputRef.current?.click(),
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept=".docx,.pdf,.html,.htm,.txt,.md,.rst"
      className="hidden"
      onChange={(e) => {
        handleFiles(e.target.files)
        e.target.value = ""
      }}
    />
  )

  if (hasFiles) {
    return (
      <div
        {...sharedProps}
        className={`border border-dashed rounded-sm p-3 text-center cursor-pointer transition-colors focus:outline-none focus:border-muted ${
          dragOver
            ? "border-accent bg-surface"
            : "border-border hover:border-muted"
        }`}
      >
        <p className="text-xs text-dim">
          {dragOver ? "Release to add files" : "Drop more files or click to browse"}
        </p>
        {fileInput}
      </div>
    )
  }

  return (
    <div
      {...sharedProps}
      className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors focus:outline-none focus:border-muted ${
        dragOver
          ? "border-accent bg-surface"
          : "border-border hover:border-muted"
      }`}
    >
      <div className="text-dim text-xs tracking-wide space-y-3">
        <p className="text-border text-2xl">╌╌╌╌╌╌╌</p>
        <p>{dragOver ? "Release to add files" : "Drop files here"}</p>
        <p>or click to browse</p>
        <p className="text-border text-2xl">╌╌╌╌╌╌╌</p>
        <p className="text-[10px] text-dim mt-4">.docx .pdf .md .txt .html</p>
      </div>
      {fileInput}
    </div>
  )
}
