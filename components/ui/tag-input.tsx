'use client'

import { useState, KeyboardEvent } from 'react'
import { X } from 'lucide-react'

type Props = {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  validate?: (value: string) => boolean
}

export function TagInput({ values, onChange, placeholder = 'Add...', validate }: Props) {
  const [input, setInput] = useState('')

  function addTag() {
    const trimmed = input.trim()
    if (!trimmed) return
    if (validate && !validate(trimmed)) return
    if (values.includes(trimmed)) return
    onChange([...values, trimmed])
    setInput('')
  }

  function removeTag(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    }
    if (e.key === 'Backspace' && !input && values.length > 0) {
      removeTag(values.length - 1)
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-[var(--border)] bg-[var(--surface)] min-h-[38px]">
      {values.map((tag, i) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs font-mono"
        >
          {tag}
          <button
            onClick={() => removeTag(i)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={values.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent text-sm outline-none"
      />
    </div>
  )
}
