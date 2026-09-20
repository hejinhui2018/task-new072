import type { CheckId } from '../contract/types'

export const STEP_ORDER: CheckId[] = ['mount', 'slots', 'attributes', 'properties', 'events', 'parts']

export function nextStep(current: CheckId): CheckId | null {
  const i = STEP_ORDER.indexOf(current)
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : null
}
