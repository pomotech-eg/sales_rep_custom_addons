import axios, { AxiosInstance } from 'axios';
// Enforce single trailing slash or none for axios
const getBaseUrl = () => {
    // Use native process.env (Expo 49+ supports this natively for EXPO_PUBLIC_*)
    let url = process.env.EXPO_PUBLIC_BASE_URL || '';

    // Remove any quotes and trailing slashes
    url = url.replace(/['"]+/g, '').replace(/\/+$/, '');

    console.log('Base URL:', url);

    return url;
};

// This is a leaf node to prevent circular dependencies
export const apiClient: AxiosInstance = axios.create({
    baseURL: getBaseUrl(),
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 10000,
});

export const setApiBaseUrl = (url: string) => {
    apiClient.defaults.baseURL = url.replace(/\/+$/, '');
    // console.log('API Client Base URL set to:', apiClient.defaults.baseURL);
};

export default apiClient;
