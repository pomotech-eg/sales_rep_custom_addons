import RNEventSource from 'react-native-sse';
import { IEventSource, EventSourceListener, EventSourceOptions } from './eventSourceWrapper.types';

/**
 * MOBILE IMPLEMENTATION
 * Uses react-native-sse.
 */
const createEventSource = (url: string, options?: EventSourceOptions): IEventSource => {
    const es = new RNEventSource(url, options);

    return {
        addEventListener: (type: string, listener: EventSourceListener) => {
            es.addEventListener(type as any, listener as any);
        },
        removeEventListener: (type: string, listener: EventSourceListener) => {
            es.removeEventListener(type as any, listener as any);
        },
        close: () => es.close()
    };
};

export default createEventSource;
