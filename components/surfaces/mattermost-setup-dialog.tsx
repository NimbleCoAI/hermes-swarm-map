// components/surfaces/mattermost-setup-dialog.tsx
'use client'

import { SurfaceConnectDialog } from './surface-connect-dialog'

type Props = {
  open: boolean
  onClose: () => void
  harnessId: string
  onConnected: () => void
}

/**
 * Surfaces-tab Mattermost connect dialog. Thin wrapper over the shared
 * SurfaceConnectDialog in harness mode — behavior is unchanged.
 */
export function MattermostSetupDialog({ open, onClose, harnessId, onConnected }: Props) {
  return (
    <SurfaceConnectDialog
      platform="mattermost"
      target={{ kind: 'harness', harnessId }}
      open={open}
      onClose={onClose}
      onConnected={onConnected}
    />
  )
}
