'use client'

import { useState, useEffect, useCallback } from 'react'

export function useApi<T>(url: string, refreshInterval?: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    refetch()
    if (refreshInterval) {
      const id = setInterval(refetch, refreshInterval)
      return () => clearInterval(id)
    }
  }, [refetch, refreshInterval])

  return { data, error, loading, refetch }
}
