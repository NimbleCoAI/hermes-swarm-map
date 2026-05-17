import { Storage } from './storage'
import { DockerService } from './docker'
import { AuditService } from './audit'
import { HarnessService } from './harness'
import { KeysService } from './keys'
import { ToolsService } from './tools'
import { MemoryService } from './memory'
import { ConfigService } from './config'
import path from 'path'
import os from 'os'

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR.replace('~', os.homedir())
  : path.join(os.homedir(), '.hermes-swarm-map')

const storage = new Storage(DATA_DIR)
const docker = new DockerService()
const audit = new AuditService(storage)

const config = new ConfigService(storage)

export const services = {
  storage,
  docker,
  audit,
  config,
  harness: new HarnessService(storage, docker, audit, config),
  keys: new KeysService(storage, audit, DATA_DIR),
  tools: new ToolsService(storage),
  memory: new MemoryService(storage),
}
