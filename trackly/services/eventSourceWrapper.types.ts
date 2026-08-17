export interface EventSourceOptions {
    headers?: Record<string, string>;
    pollingInterval?: number;
}

export type EventSourceListener = (event: { data: string; type: string }) => void;

export interface IEventSource {
    addEventListener(type: string, listener: EventSourceListener): void;
    removeEventListener(type: string, listener: EventSourceListener): void;
    close(): void;
}
