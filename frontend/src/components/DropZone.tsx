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

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return
      const valid = Array.from(fileList).filter((f) => SUPPORTED.has(getExt(f.name)))
      if (valid.length > 0) onFilesAdded(valid)
    },
    [onFilesAdded]
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  if (hasFiles) {
    return (
      <div
        className={`border border-dashed rounded-sm p-3 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-accent bg-surface"
            : "border-border hover:border-muted"
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <p className="text-xs text-dim">
          {dragOver ? "Release to add files" : "Drop more files or click to browse"}
        </p>
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
      </div>
    )
  }

  return (
    <div
      className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors ${
        dragOver
          ? "border-accent bg-surface"
          : "border-border hover:border-muted"
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <div className="text-dim text-xs tracking-wide space-y-3">
        <p className="text-border text-2xl">╌╌╌╌╌╌╌</p>
        <p>{dragOver ? "Release to add files" : "Drop files here"}</p>
        <p>or click to browse</p>
        <p className="text-border text-2xl">╌╌╌╌╌╌╌</p>
        <p className="text-[10px] text-dim mt-4">.docx .pdf .md .txt .html</p>
      </div>
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
    </div>
  )
}
