import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * A platform-agnostic storage utility.
 * Falls back to localStorage on Web when SecureStore is unavailable or failing.
 */
export const storage = {
    getItem: async (key: string): Promise<string | null> => {
        try {
            if (Platform.OS === 'web') {
                return localStorage.getItem(key);
            }
            return await SecureStore.getItemAsync(key);
        } catch (error) {
            console.warn(`Storage error (getItem ${key}):`, error);
            if (Platform.OS === 'web') return null;
            // Fallback for native if SecureStore fails
            return null;
        }
    },

    setItem: async (key: string, value: string): Promise<void> => {
        try {
            if (Platform.OS === 'web') {
                localStorage.setItem(key, value);
                return;
            }
            await SecureStore.setItemAsync(key, value);
        } catch (error) {
            console.warn(`Storage error (setItem ${key}):`, error);
        }
    },

    deleteItem: async (key: string): Promise<void> => {
        try {
            if (Platform.OS === 'web') {
                localStorage.removeItem(key);
                return;
            }
            await SecureStore.deleteItemAsync(key);
        } catch (error) {
            console.warn(`Storage error (deleteItem ${key}):`, error);
        }
    }
};
