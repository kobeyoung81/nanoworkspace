// The channel logger the file browser writes its decisions to.
//
// It is off unless the browser asks for it (`localStorage['nanosec.debug']`), the
// same switch the shell uses; keeping the switch rather than the shell's logger
// module is what lets this code live in its own build.
const ENABLED_KEY = 'nanosec.debug'

function enabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== null
  } catch {
    return false
  }
}

export type ChannelLogger = {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createChannelLogger(channel: string): ChannelLogger {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]) => {
    if (!enabled()) {
      return
    }
    console[level](`[${channel}]`, ...args)
  }
  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  }
}
