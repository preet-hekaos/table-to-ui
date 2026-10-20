/* eslint-disable @typescript-eslint/no-empty-object-type */
import 'vitest'

interface AxeMatchers {
  toHaveNoViolations(): void
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
