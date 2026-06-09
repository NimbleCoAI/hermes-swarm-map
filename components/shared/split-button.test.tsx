/**
 * Tests for SplitButton component — focused on dynamic loadingLabel
 * behaviour introduced in fix for issue #58.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SplitButton } from './split-button'

describe('SplitButton', () => {
  it('shows label when not loading', () => {
    render(
      <SplitButton
        label="Quick Restart"
        onClick={() => {}}
        items={[]}
      />
    )
    expect(screen.getByRole('button', { name: 'Quick Restart' })).toBeTruthy()
  })

  it('shows static loadingLabel when loading with no dynamic label', () => {
    render(
      <SplitButton
        label="Quick Restart"
        loadingLabel="Restarting…"
        loading
        onClick={() => {}}
        items={[]}
      />
    )
    // The main button should contain the loading label text
    expect(screen.getByText('Restarting…')).toBeTruthy()
  })

  it('shows Rebuilding… when loadingLabel is Rebuilding…', () => {
    render(
      <SplitButton
        label="Quick Restart"
        loadingLabel="Rebuilding…"
        loading
        onClick={() => {}}
        items={[]}
      />
    )
    expect(screen.getByText('Rebuilding…')).toBeTruthy()
  })

  it('shows Purging… when loadingLabel is Purging…', () => {
    render(
      <SplitButton
        label="Quick Restart"
        loadingLabel="Purging…"
        loading
        onClick={() => {}}
        items={[]}
      />
    )
    expect(screen.getByText('Purging…')).toBeTruthy()
  })
})
