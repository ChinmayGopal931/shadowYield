// Polyfills for browser environment
// These MUST be set up before any other imports

import { Buffer } from 'buffer'

// Make Buffer available globally BEFORE anything else
if (typeof window !== 'undefined') {
  // Ensure process is defined with browser flag (needed by readable-stream and other Node.js libs)
  // This must happen BEFORE Buffer is assigned to prevent initialization errors
  if (typeof window.process === 'undefined') {
    window.process = {
      env: {},
      browser: true,
      version: '',
      nextTick: (fn: () => void) => setTimeout(fn, 0),
    } as unknown as NodeJS.Process
  } else {
    const proc = window.process as NodeJS.Process & { browser?: boolean; nextTick?: (fn: () => void) => void }
    if (typeof proc.browser === 'undefined') {
      proc.browser = true
    }
    if (typeof proc.nextTick === 'undefined') {
      proc.nextTick = (fn: () => void) => setTimeout(fn, 0)
    }
  }

  // Now set Buffer globally
  window.Buffer = Buffer

  // Ensure global is defined (needed by some wallet adapters)
  if (typeof window.global === 'undefined') {
    window.global = window
  }

  // Ensure crypto is available (needed for wallet-standard)
  if (typeof window.crypto === 'undefined') {
    console.warn('crypto not available')
  }
}
