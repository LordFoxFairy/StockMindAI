declare module 'duckduckgo-search' {
  export function search(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
}
