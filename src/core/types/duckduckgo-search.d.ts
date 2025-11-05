declare module 'duckduckgo-search' {
  export interface SearchOptions {
    maxResults?: number;
    // adding minimal explicit types for what is actually used
    [key: string]: any;
  }

  // duckduckgo-search export changed
  export function text(query: string, options?: SearchOptions): AsyncGenerator<any>;
  export function images(query: string, options?: SearchOptions): AsyncGenerator<any>;
}