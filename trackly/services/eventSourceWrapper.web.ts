import { IEventSource, EventSourceListener, EventSourceOptions } from './eventSourceWrapper.types';

/**
 * WEB IMPLEMENTATION
 * Browsers have native EventSource support.
 */
const createEventSource = (url: string, options?: EventSourceOptions): IEventSource => {
    const es = new window.EventSource(url);
    
    return {
        addEventListener: (type: string, listener: EventSourceListener) => {
            es.addEventListener(type, (event: any) => {
                listener({ data: event.data, type: event.type });
            });
        },
        removeEventListener: (type: string, listener: EventSourceListener) => {
            // Native EventSource removeEventListener requires the same reference
            // For now, sseService mostly uses close()
        },
        close: () => es.close()
    };
};

export default createEventSource;
