import { NextResponse } from 'next/server'
import { services } from '@/lib/services'
import { readModelConfig, readModelProvider, readFallbackProviders, guessDataDir } from '@/lib/services/harness'
import type { FallbackProvider } from '@/lib/services/harness'
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
  const fallbackProviders = readFallbackProviders(dataDir)

  return NextResponse.json({
    provider,
    primary: models[0] ?? '',
    models,
    fallbackProviders,
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

  let body: {
    provider?: string
    model?: string
    cascade?: string[]
    fallback_providers?: Array<{ provider: string; model: string; base_url?: string }>
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const containerName = harness.serviceName
    ? harness.name === 'personal'
      ? 'hermes-personal'
      : `hermes-${harness.name}`
    : harness.name
  const dataDir = guessDataDir(harness.serviceName ?? harness.name, containerName)
  const configPath = path.join(dataDir, 'config.yaml')

  // When fallback_providers is provided, derive cascade from it for backward compat
  let cascade: string[]
  let provider: string
  let fallbackProvidersToWrite: Array<{ provider: string; model: string; base_url?: string }> | undefined

  if (body.fallback_providers && body.fallback_providers.length > 0) {
    fallbackProvidersToWrite = body.fallback_providers
    // Primary model = first entry, provider from first entry
    provider = body.fallback_providers[0].provider || ''
    cascade = body.fallback_providers.map((fp) => fp.model)
  } else {
    // Legacy path: string-based cascade
    cascade = body.cascade ?? (body.model ? [body.model] : [])
    provider = body.provider || ''
  }

  const primary = cascade[0] || ''

  if (cascade.length === 0) {
    return NextResponse.json({ error: 'At least one model is required' }, { status: 400 })
  }

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

  // Build fallback_providers YAML section (root level)
  const fpLines: string[] = []
  if (fallbackProvidersToWrite && fallbackProvidersToWrite.length > 0) {
    fpLines.push('fallback_providers:')
    for (const fp of fallbackProvidersToWrite) {
      fpLines.push(`  - provider: ${fp.provider}`)
      fpLines.push(`    model: ${fp.model}`)
      if (fp.base_url) {
        fpLines.push(`    base_url: ${fp.base_url}`)
      }
      // Do NOT write api_key from the UI (security)
    }
  }

  let content: string
  try {
    content = fs.readFileSync(configPath, 'utf-8')
  } catch {
    // No config.yaml — create one
    const sections = [modelLines.join('\n')]
    if (fpLines.length > 0) sections.push('', fpLines.join('\n'))
    content = sections.join('\n') + '\n'
    fs.writeFileSync(configPath, content, 'utf-8')
    services.harness.updateConfig(id, { models: cascade })
    const respFp = readFallbackProviders(dataDir)
    return NextResponse.json({ provider, primary, models: cascade, fallbackProviders: respFp })
  }

  // Replace sections in existing config.yaml
  const lines = content.split('\n')
  const updated: string[] = []
  let inModelSection = false
  let modelSectionWritten = false
  let inFpSection = false
  let fpSectionWritten = false

  for (const line of lines) {
    // model: section
    if (/^model:\s*$/.test(line) || /^model:$/.test(line.trim())) {
      inModelSection = true
      inFpSection = false
      if (!modelSectionWritten) {
        updated.push(...modelLines)
        modelSectionWritten = true
      }
      continue
    }
    // fallback_providers: section
    if (/^fallback_providers:\s*$/.test(line) || /^fallback_providers:$/.test(line.trim())) {
      inFpSection = true
      inModelSection = false
      if (!fpSectionWritten && fpLines.length > 0) {
        updated.push(...fpLines)
        fpSectionWritten = true
      }
      continue
    }

    if (inModelSection) {
      if (/^\s+\S/.test(line)) continue
      inModelSection = false
    }
    if (inFpSection) {
      if (/^\s+\S/.test(line)) continue
      inFpSection = false
    }
    updated.push(line)
  }

  // If config had no model section at all, append it
  if (!modelSectionWritten) {
    updated.push('', ...modelLines)
  }

  // If config had no fallback_providers section, append it
  if (!fpSectionWritten && fpLines.length > 0) {
    updated.push('', ...fpLines)
  }

  fs.writeFileSync(configPath, updated.join('\n'), 'utf-8')
  services.harness.updateConfig(id, { models: cascade })

  const respFp = readFallbackProviders(dataDir)
  return NextResponse.json({ provider, primary, models: cascade, fallbackProviders: respFp })
}
