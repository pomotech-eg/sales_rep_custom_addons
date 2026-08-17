import apiClient from '../apiClient';

export const reportSecurityAlert = async (data: {
    alert_type: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    device_identifier?: string;
}) => {
    try {
        const response = await apiClient.post('/api/mobile/location/security_alert', data);
        return response.data;
    } catch (error) {
        console.error('[Location Service] Failed to report security alert:', error);
        throw error;
    }
};
