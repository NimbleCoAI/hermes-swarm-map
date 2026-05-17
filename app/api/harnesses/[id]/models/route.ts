import { NextResponse } from 'next/server'
import { services } from '@/lib/services'
import { readModelConfig, readModelProvider, guessDataDir } from '@/lib/services/harness'
import fs from 'fs'
import path from 'path'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const harness = services.harness.get(id)
  if (!harness) {
    return NextResponse.json({ error: 'Harness not found' }, { status: 404 })
  }

  const containerName = harness.serviceName
    ? harness.name === 'personal'
      ? 'hermes-personal'
      : `hermes-${harness.name}`
    : harness.name
  const dataDir = guessDataDir(harness.serviceName ?? harness.name, containerName)

  const models = readModelConfig(dataDir)
  const provider = readModelProvider(dataDir)

  return NextResponse.json({
    provider,
    primary: models[0] ?? '',
    models,
    dataDir,
  })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const harness = services.harness.get(id)
  if (!harness) {
    return NextResponse.json({ error: 'Harness not found' }, { status: 404 })
  }

  let body: { provider?: string; model?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { provider, model } = body
  if (!provider || !model) {
    return NextResponse.json({ error: 'provider and model are required' }, { status: 400 })
  }

  const containerName = harness.serviceName
    ? harness.name === 'personal'
      ? 'hermes-personal'
      : `hermes-${harness.name}`
    : harness.name
  const dataDir = guessDataDir(harness.serviceName ?? harness.name, containerName)
  const configPath = path.join(dataDir, 'config.yaml')

  let content: string
  try {
    content = fs.readFileSync(configPath, 'utf-8')
  } catch {
    // config.yaml doesn't exist — create a minimal one
    content = `model:\n  provider: ${provider}\n  default: ${model}\n`
    fs.writeFileSync(configPath, content, 'utf-8')
    // Also update the in-memory overlay
    services.harness.updateConfig(id, { models: [model] })
    return NextResponse.json({ provider, primary: model, models: [model] })
  }

  // Rewrite model section lines in config.yaml
  const lines = content.split('\n')
  let inModelSection = false
  let providerWritten = false
  let defaultWritten = false
  const updated: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^model:/.test(line)) {
      inModelSection = true
      updated.push(line)
      continue
    }
    if (/^\w/.test(line) && !trimmed.startsWith('#') && !/^model:/.test(line)) {
      // Exiting model section — inject any missing fields before this line
      if (inModelSection) {
        if (!providerWritten) updated.push(`  provider: ${provider}`)
        if (!defaultWritten) updated.push(`  default: ${model}`)
        inModelSection = false
      }
      updated.push(line)
      continue
    }

    if (inModelSection) {
      if (trimmed.startsWith('provider:')) {
        updated.push(`  provider: ${provider}`)
        providerWritten = true
        continue
      }
      if (trimmed.startsWith('default:')) {
        updated.push(`  default: ${model}`)
        defaultWritten = true
        continue
      }
    }

    updated.push(line)
  }

  // If we ended while still in model section
  if (inModelSection) {
    if (!providerWritten) updated.push(`  provider: ${provider}`)
    if (!defaultWritten) updated.push(`  default: ${model}`)
  }

  const newContent = updated.join('\n')
  fs.writeFileSync(configPath, newContent, 'utf-8')

  // Update overlay so the harness list reflects the new model
  services.harness.updateConfig(id, { models: [model] })

  return NextResponse.json({ provider, primary: model, models: [model] })
}
