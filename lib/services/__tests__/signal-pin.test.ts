import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SignalPinService } from '../signal-pin'
import { KeysService } from '../keys'
import { Storage } from '../storage'
import { AuditService } from '../audit'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock global fetch for signal-cli JSON-RPC calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('SignalPinService', () => {
  let tmpDir: string
  let keys: KeysService
  let pinService: SignalPinService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-pin-'))
    const storage = new Storage(tmpDir)
    const audit = new AuditService(storage)
    keys = new KeysService(storage, audit)
    pinService = new SignalPinService(keys, 'http://localhost:8080')
    mockFetch.mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('setPin', () => {
    it('calls signal-cli setPin RPC and stores PIN in key store', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      const result = await pinService.setPin('+15551234567', '12345678', 'h_personal')

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledOnce()
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.method).toBe('setPin')
      expect(body.params.registrationLockPin).toBe('12345678')

      // PIN should be stored in key store
      const allKeys = keys.list([])
      const pinKey = allKeys.find(k => k.provider === 'signal-pin')
      expect(pinKey).toBeDefined()
      expect(pinKey!.name).toBe('Signal PIN (+15551234567)')
      expect(pinKey!.assignedTo).toEqual(['h_personal'])
    })

    it('updates existing PIN key if one exists for the same phone', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      await pinService.setPin('+15551234567', '11111111', 'h_personal')
      await pinService.setPin('+15551234567', '22222222', 'h_personal')

      const allKeys = keys.list([])
      const pinKeys = allKeys.filter(k => k.provider === 'signal-pin')
      expect(pinKeys).toHaveLength(1)
    })

    it('returns error when RPC fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'RPC error' } }),
      })

      const result = await pinService.setPin('+15551234567', '12345678', 'h_personal')
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('removePin', () => {
    it('calls signal-cli removePin RPC and removes PIN from key store', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      await pinService.setPin('+15551234567', '12345678', 'h_personal')
      const result = await pinService.removePin('+15551234567')

      expect(result.success).toBe(true)
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
      const body = JSON.parse(lastCall[1].body)
      expect(body.method).toBe('removePin')

      const allKeys = keys.list([])
      expect(allKeys.find(k => k.provider === 'signal-pin')).toBeUndefined()
    })
  })

  describe('getPin', () => {
    it('returns decrypted PIN for a phone number', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      await pinService.setPin('+15551234567', '12345678', 'h_personal')
      const result = pinService.getPin('+15551234567')

      expect(result).not.toBeNull()
      expect(result!.pin).toBe('12345678')
      expect(result!.phone).toBe('+15551234567')
      expect(result!.health).toBe('good')
    })

    it('returns null for unknown phone', () => {
      expect(pinService.getPin('+19999999999')).toBeNull()
    })
  })

  describe('getPinStatus', () => {
    it('returns locked for accounts with PIN', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', result: null, id: 1 }),
      })

      await pinService.setPin('+15551234567', '12345678', 'h_personal')
      const status = pinService.getPinStatus('+15551234567')
      expect(status).toBe('locked')
    })

    it('returns not-set for accounts without PIN', () => {
      const status = pinService.getPinStatus('+19999999999')
      expect(status).toBe('not-set')
    })
  })

  describe('generatePin', () => {
    it('generates an 8-digit numeric PIN', () => {
      const pin = SignalPinService.generatePin()
      expect(pin).toMatch(/^\d{8}$/)
    })

    it('generates different PINs on successive calls', () => {
      const pins = new Set(Array.from({ length: 10 }, () => SignalPinService.generatePin()))
      expect(pins.size).toBeGreaterThan(1)
    })
  })
})
