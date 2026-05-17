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

  let body: { provider?: string; model?: string; cascade?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Support both single model and cascade array
  const cascade = body.cascade ?? (body.model ? [body.model] : [])
  const provider = body.provider || ''
  const primary = cascade[0] || ''

  if (cascade.length === 0) {
    return NextResponse.json({ error: 'At least one model is required' }, { status: 400 })
  }

  const containerName = harness.serviceName
    ? harness.name === 'personal'
      ? 'hermes-personal'
      : `hermes-${harness.name}`
    : harness.name
  const dataDir = guessDataDir(harness.serviceName ?? harness.name, containerName)
  const configPath = path.join(dataDir, 'config.yaml')

  // Build the model section of config.yaml
  const modelLines = ['model:']
  if (provider) modelLines.push(`  provider: ${provider}`)
  modelLines.push(`  default: ${primary}`)
  if (cascade.length > 1) {
    modelLines.push(`  fallback:`)
    for (const m of cascade.slice(1)) {
      modelLines.push(`    - ${m}`)
    }
  }

  let content: string
  try {
    content = fs.readFileSync(configPath, 'utf-8')
  } catch {
    // No config.yaml — create one
    content = modelLines.join('\n') + '\n'
    fs.writeFileSync(configPath, content, 'utf-8')
    services.harness.updateConfig(id, { models: cascade })
    return NextResponse.json({ provider, primary, models: cascade })
  }

  // Replace the entire model: section in config.yaml
  const lines = content.split('\n')
  const updated: string[] = []
  let inModelSection = false
  let modelSectionWritten = false

  for (const line of lines) {
    if (/^model:\s*$/.test(line) || /^model:$/.test(line.trim())) {
      // Start of model section — replace entirely
      inModelSection = true
      if (!modelSectionWritten) {
        updated.push(...modelLines)
        modelSectionWritten = true
      }
      continue
    }
    if (inModelSection) {
      // Skip old model section lines (indented under model:)
      if (/^\s+\S/.test(line)) continue
      // Non-indented line = end of model section
      inModelSection = false
    }
    updated.push(line)
  }

  // If config had no model section at all, append it
  if (!modelSectionWritten) {
    updated.push('', ...modelLines)
  }

  fs.writeFileSync(configPath, updated.join('\n'), 'utf-8')
  services.harness.updateConfig(id, { models: cascade })

  return NextResponse.json({ provider, primary, models: cascade })
}
