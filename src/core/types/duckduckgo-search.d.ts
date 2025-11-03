declare module 'duckduckgo-search' {
  export interface SearchOptions {
    maxResults?: number;
    // adding minimal explicit types for what is actually used
    [key: string]: any;
  }

  export function search(query: string, options?: SearchOptions): Promise<any>;
}