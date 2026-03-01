interface Props {
  models: string[]
  selected: string
  onChange: (model: string) => void
}

export default function ModelSelector({ models, selected, onChange }: Props) {
  if (models.length === 0) {
    return (
      <span className="text-[10px] text-dim tracking-wide">(no models)</span>
    )
  }

  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className="bg-surface border border-border text-text text-xs px-3 py-1.5 rounded-sm cursor-pointer hover:border-muted transition-colors focus:outline-none focus:ring-1 focus:ring-muted focus:border-muted"
    >
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  )
}
