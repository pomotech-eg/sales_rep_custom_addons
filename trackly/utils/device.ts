import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export const getDeviceModel = (): string => {
    try {
        if (Platform.OS === 'android') {
            const brand = (Platform.constants as any).Brand || (Platform.constants as any).Manufacturer || 'Android';
            const model = (Platform.constants as any).Model || 'Device';
            const formattedBrand = brand.charAt(0).toUpperCase() + brand.slice(1);
            return `${formattedBrand} ${model}`;
        } else if (Platform.OS === 'ios') {
            return 'iOS Device';
        }
    } catch (e) {
        console.warn("Failed to get platform constants:", e);
    }
    return 'Unknown Device';
};

export const getMacAddress = async (): Promise<string> => {
    try {
        let mac = await SecureStore.getItemAsync('simulated_mac_address');
        if (!mac) {
            // Generate a random but valid locally administered unicast MAC address (first byte ends in 2, 6, A, or E)
            const chars = '0123456789ABCDEF';
            const firstByteOptions = ['02', '06', '0A', '0E'];
            const firstByte = firstByteOptions[Math.floor(Math.random() * firstByteOptions.length)];
            
            const remainingParts = [];
            for (let i = 0; i < 5; i++) {
                const part = chars[Math.floor(Math.random() * 16)] + chars[Math.floor(Math.random() * 16)];
                remainingParts.push(part);
            }
            
            mac = [firstByte, ...remainingParts].join(':');
            await SecureStore.setItemAsync('simulated_mac_address', mac);
        }
        return mac;
    } catch (e) {
        console.warn("Failed to get/generate simulated MAC address:", e);
        return '02:00:00:00:00:00';
    }
};

export const getDeviceIdentifier = async (): Promise<string> => {
    try {
        let uuid = await SecureStore.getItemAsync('device_uuid');
        if (!uuid) {
            uuid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            await SecureStore.setItemAsync('device_uuid', uuid);
        }
        return uuid;
    } catch (e) {
        return 'unknown_device_uuid';
    }
};

export const getCurrentLocation = async () => {
    try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced
            });
            return {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude
            };
        }
    } catch (e) {
        console.warn("Failed to fetch current location for session logging:", e);
    }
    return { latitude: 0.0, longitude: 0.0 };
};
