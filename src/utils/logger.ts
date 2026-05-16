export const logger = {
  info: (message: string, data?: any) => {
    console.log(`[OpenSkip] ${message}`, data || '')
  },
  warn: (message: string, data?: any) => {
    console.warn(`[OpenSkip] ${message}`, data || '')
  },
  error: (message: string, error?: any) => {
    console.error(`[OpenSkip] ${message}`, error || '')
  },
}
