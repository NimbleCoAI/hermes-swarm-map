// components/surfaces/slack-setup-dialog.tsx
'use client'

import { SurfaceConnectDialog } from './surface-connect-dialog'

type Props = {
  open: boolean
  onClose: () => void
  harnessId: string
  onConnected: () => void
}

/**
 * Surfaces-tab Slack connect dialog. Thin wrapper over the shared
 * SurfaceConnectDialog in harness mode — same pattern as Telegram/Discord.
 */
export function SlackSetupDialog({ open, onClose, harnessId, onConnected }: Props) {
  return (
    <SurfaceConnectDialog
      platform="slack"
      target={{ kind: 'harness', harnessId }}
      open={open}
      onClose={onClose}
      onConnected={onConnected}
    />
  )
}
