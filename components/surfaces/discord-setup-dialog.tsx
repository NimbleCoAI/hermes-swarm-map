// components/surfaces/discord-setup-dialog.tsx
'use client'

import { SurfaceConnectDialog } from './surface-connect-dialog'

type Props = {
  open: boolean
  onClose: () => void
  harnessId: string
  onConnected: () => void
}

/**
 * Surfaces-tab Discord connect dialog. Thin wrapper over the shared
 * SurfaceConnectDialog in harness mode — same pattern as Telegram/Mattermost.
 */
export function DiscordSetupDialog({ open, onClose, harnessId, onConnected }: Props) {
  return (
    <SurfaceConnectDialog
      platform="discord"
      target={{ kind: 'harness', harnessId }}
      open={open}
      onClose={onClose}
      onConnected={onConnected}
    />
  )
}
