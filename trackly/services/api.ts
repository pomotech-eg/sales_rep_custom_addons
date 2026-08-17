import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/useAuthStore';
import { apiClient } from './apiClient';

// Logic for interceptors and API methods remains here
// But the core instance is shared from apiClient.ts to prevent circular imports

// Request Interceptor
apiClient.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
        // Log request details
        console.log(`[Request] ${config.method?.toUpperCase()} ${config.url}`);

        // Add Odoo session_id cookie if present
        const sessionId = await AsyncStorage.getItem('odoo_session_id');
        if (sessionId) {
            config.headers.Cookie = `session_id=${sessionId}`;
        }

        // Add Authorization Token
        const token = useAuthStore.getState().token;
        if (token) {
            // console.log('Adding Authorization header with token:', token);
            config.headers.Authorization = `Bearer ${token}`;
            // Or 'access_token' depending on Odoo auth expectation, usually it's custom or Bearer
            // Given the controller returns 'access_token', Bearer is standard.
            // However, typical Odoo external API might just use it.
            // Let's assume Bearer for now or check if there's a specific header needed.
            config.headers['access_token'] = token; // Adding both to be safe or checking main.py?
        }

        return config;
    },
    (error: AxiosError) => {
        return Promise.reject(error);
    }
);

// Response Interceptor
apiClient.interceptors.response.use(
    (response: AxiosResponse) => {
        console.log(`[Response] ${response.status} ${response.config.url}`);
        return response;
    },
    (error: AxiosError) => {
        if (error.response?.status === 401) {
            console.warn('[API] 401 Unauthorized - Expiring Session');
            useAuthStore.getState().expireSession();
        }
        const errorDetails = handleError(error);
        // Only log non-network errors to avoid terminal spam during auto-sync
        if (errorDetails.status !== 0) {
            console.error(`[API Error] ${error.message}`, error.code, error.response?.status);
            if (error.response?.data) {
                const data = error.response.data;
                if (typeof data === 'string' && data.includes('<!DOCTYPE html>')) {
                    console.error('[API Error Data] Received HTML response (possibly 404/500 page)');
                } else {
                    console.error('[API Error Data]', JSON.stringify(data, null, 2));
                }
            }
        }
        return Promise.reject(errorDetails);
    }
);

const handleError = (error: AxiosError) => {
    if (error.response) {
        // Server responded with a status other than 2xx
        // For Odoo JSON-RPC, sometimes errors are inside valid 200 responses too, 
        // but axios catches HTTP errors.
        return {
            message: (error.response.data as any)?.message || 'Something went wrong',
            status: error.response.status,
            data: error.response.data
        };
    } else if (error.request) {
        // Request was made but no response received
        return { message: 'Network error. Please check your connection or server URL.', status: 0 };
    } else {
        // Something happened in setting up the request
        return { message: error.message, status: -1 };
    }
};

export const syncData = async (payload: any) => {
    return apiClient.post('/api/mobile/sync', payload);
};

export const endVisitApi = async (visitData: any) => {
    return apiClient.post('/api/mobile/visits/end', visitData);
};

export const startVisitApi = async (visitData: any) => {
    return apiClient.post('/api/mobile/visits/start', visitData);
};

export const sendSalesOrder = async (orderData: any) => {
    return apiClient.post('/api/mobile/orders', orderData);
};

export const logSessionLogin = async (payload: { latitude: number, longitude: number, device_model: string, mac_address: string, device_identifier: string }) => {
    return apiClient.post('/api/mobile/session/login', payload);
};

export const logSessionLogout = async (payload: { latitude: number, longitude: number, device_model: string, mac_address: string, device_identifier: string, forced?: boolean }) => {
    return apiClient.post('/api/mobile/session/logout', payload);
};

export default apiClient;
