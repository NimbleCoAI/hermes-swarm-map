import fs from 'fs'
import { cp } from 'fs/promises'
import path from 'path'

// Template directories for baseline plugins, hooks, and skills installed into every new agent
export const TEMPLATE_PLUGINS = ['swarm_map_policy', 'boot_md']
export const TEMPLATE_HOOKS = ['lifecycle-notify']
export const TEMPLATE_SKILLS = ['ocr-and-documents', 'captcha-escalation']

/**
 * Install baseline plugins and hooks from infra/templates/ into an agent's data directory.
 * Gracefully skips if templates directory doesn't exist (e.g. running from upstream image).
 */
export async function installBaselineTemplates(agentDataDir: string): Promise<void> {
  const templatesDir = path.join(process.cwd(), 'infra', 'templates')

  // Install plugins
  const pluginTemplatesDir = path.join(templatesDir, 'plugins')
  for (const pluginName of TEMPLATE_PLUGINS) {
    const srcDir = path.join(pluginTemplatesDir, pluginName)
    if (!fs.existsSync(srcDir)) continue
    const destDir = path.join(agentDataDir, 'plugins', pluginName)
    await cp(srcDir, destDir, { recursive: true })
  }

  // Install hooks
  const hookTemplatesDir = path.join(templatesDir, 'hooks')
  for (const hookName of TEMPLATE_HOOKS) {
    const srcDir = path.join(hookTemplatesDir, hookName)
    if (!fs.existsSync(srcDir)) continue
    const destDir = path.join(agentDataDir, 'hooks', hookName)
    await cp(srcDir, destDir, { recursive: true })
  }

  // Install skills
  const skillTemplatesDir = path.join(templatesDir, 'skills')
  for (const skillName of TEMPLATE_SKILLS) {
    const srcDir = path.join(skillTemplatesDir, skillName)
    if (!fs.existsSync(srcDir)) continue
    const destDir = path.join(agentDataDir, 'skills', skillName)
    await cp(srcDir, destDir, { recursive: true })
  }
}
