import { RISK_COLORS } from '@/lib/constants'

export function RiskBar({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="inline-flex gap-0.5" title={`Risk: ${level}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="block h-3 w-4 rounded-[2px]"
          style={{
            backgroundColor: i <= level ? RISK_COLORS[i - 1] : 'var(--border)',
          }}
        />
      ))}
    </div>
  )
}
