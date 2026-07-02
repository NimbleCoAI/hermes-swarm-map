import { Storage } from './storage'
import { DockerService } from './docker'
import { AuditService } from './audit'
import { HarnessService } from './harness'
import { KeysService } from './keys'
import { ToolsService } from './tools'
import { MemoryService } from './memory'
import { ConfigService } from './config'
import { SignalPinService } from './signal-pin'
import { SurfaceAdminService } from './surface-admins'
import path from 'path'
import os from 'os'

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR.replace('~', os.homedir())
  : path.join(os.homedir(), '.hermes-swarm-map')

const storage = new Storage(DATA_DIR)
const docker = new DockerService()
const audit = new AuditService(storage)

const config = new ConfigService(storage)

const harness = new HarnessService(storage, docker, audit, config)
const tools = new ToolsService(storage)

const keysService = new KeysService(storage, audit, DATA_DIR)

// Wire ToolsService into HarnessService for auto-discovery of tools
harness.setToolsService(tools)

export const services = {
  storage,
  docker,
  audit,
  config,
  harness,
  keys: keysService,
  tools,
  memory: new MemoryService(storage),
  signalPin: new SignalPinService(keysService, process.env.SIGNAL_API_URL || 'http://localhost:8080'),
  surfaceAdmins: new SurfaceAdminService(storage, audit),
}
