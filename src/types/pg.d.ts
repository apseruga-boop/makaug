declare module 'pg' {
  export interface QueryResult<T = unknown> {
    rows: T[];
    rowCount: number | null;
  }

  export interface PoolClient {
    query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    release(): void;
  }

  export class Pool {
    constructor(config?: Record<string, unknown>);
    query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    on(event: 'error', listener: (error: Error) => void): this;
    end(): Promise<void>;
  }
}
