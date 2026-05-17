import fs from 'fs'
import path from 'path'

export class Storage {
  constructor(private baseDir: string) {}

  getBaseDir(): string {
    return this.baseDir
  }

  private resolve(filename: string): string {
    return path.join(this.baseDir, filename)
  }

  read<T>(filename: string, defaultValue: T): T {
    const filePath = this.resolve(filename)
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(raw) as T
    } catch {
      return defaultValue
    }
  }

  write<T>(filename: string, data: T): void {
    const filePath = this.resolve(filename)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  appendLine<T>(filename: string, entry: T): void {
    const filePath = this.resolve(filename)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8')
  }

  readLines<T>(filename: string): T[] {
    const filePath = this.resolve(filename)
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      return raw
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as T)
    } catch {
      return []
    }
  }
}
