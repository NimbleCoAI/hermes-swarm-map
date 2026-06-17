// components/surfaces/signal-setup-dialog.tsx
'use client'

import { SurfaceConnectDialog } from './surface-connect-dialog'

type Props = {
  open: boolean
  onClose: () => void
  harnessId: string
  harnessName?: string
  onConnected: () => void
}

/**
 * Surfaces-tab Signal connect dialog. Thin wrapper over the shared
 * SurfaceConnectDialog in harness mode — behavior is unchanged.
 */
export function SignalSetupDialog({ open, onClose, harnessId, harnessName, onConnected }: Props) {
  return (
    <SurfaceConnectDialog
      platform="signal"
      target={{ kind: 'harness', harnessId }}
      open={open}
      onClose={onClose}
      harnessName={harnessName}
      onConnected={onConnected}
    />
  )
}
