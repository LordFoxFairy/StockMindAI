declare module 'duckduckgo-search' {
  export function text(query: string, options?: Record<string, unknown>): AsyncGenerator<any>;
  export function images(query: string, options?: Record<string, unknown>): AsyncGenerator<any>;
}
