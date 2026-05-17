'use client'

type StepIndicatorProps = {
  currentStep: number
  totalSteps: number
  labels: string[]
}

export function StepIndicator({ currentStep, totalSteps, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-start justify-between w-full">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = i + 1
        const isComplete = stepNum < currentStep
        const isCurrent = stepNum === currentStep

        return (
          <div key={stepNum} className="flex flex-col items-center flex-1">
            <div className="flex items-center w-full">
              {/* Left connector line */}
              {i > 0 && (
                <div
                  className={`flex-1 h-px transition-colors ${
                    isComplete ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                  }`}
                />
              )}

              {/* Step circle */}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors ${
                  isComplete
                    ? 'bg-[var(--accent)] text-white'
                    : isCurrent
                      ? 'bg-[var(--accent)] text-white ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]'
                      : 'border-2 border-[var(--border)] text-muted-foreground bg-[var(--surface)]'
                }`}
              >
                {isComplete ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stepNum
                )}
              </div>

              {/* Right connector line */}
              {i < totalSteps - 1 && (
                <div
                  className={`flex-1 h-px transition-colors ${
                    stepNum < currentStep ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                  }`}
                />
              )}
            </div>

            {/* Label */}
            <span
              className={`mt-2 text-[10px] text-center leading-tight ${
                isCurrent ? 'text-[var(--accent)] font-medium' : 'text-muted-foreground'
              }`}
            >
              {labels[i]}
            </span>
          </div>
        )
      })}
    </div>
  )
}
