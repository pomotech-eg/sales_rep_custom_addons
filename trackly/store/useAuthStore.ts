import { create } from 'zustand';
import { getSession, setSession, clearSession, logDatabaseStats } from '../services/db';
import { setApiBaseUrl } from '../services/apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

const logAsyncStorage = async (label: string) => {
    try {
        const keys = await AsyncStorage.getAllKeys();
        const items = await AsyncStorage.multiGet(keys);
        console.log(`--- AsyncStorage Content (${label}) ---`);
        items.forEach(([key, value]) => {
            console.log(`${key}: ${value}`);
        });
        console.log('---------------------------------------');
    } catch (error) {
        console.error('Error logging AsyncStorage:', error);
    }
};

interface User {
    user_id: number;
    name: string;
    email: string;
    company: string;
    subscription_valid: boolean;
    role?: string;
    // Access Rights
    access_sales_report?: boolean;
    access_customer_debt_report?: boolean;
    access_collection_report?: boolean;
    access_journal_report?: boolean;
    access_requests?: boolean;
    access_cash_balance?: boolean;
    access_storage?: boolean;
    access_returns?: boolean;
    access_confirm_quotation?: boolean;
    access_delivery?: boolean;
    access_payment?: boolean;
    access_discount?: boolean;
    access_inventory_adjustment?: boolean;
    access_general_return?: boolean;
    access_cancel_quotation?: boolean;
    access_visit_order?: boolean;
    access_visit_payment?: boolean;
    // Add other user fields as needed
}

interface AuthState {
    user: User | null;
    token: string | null;
    serverUrl: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    subscriptionError: boolean;
    setSubscriptionError: (error: boolean) => void;
    login: (userData: any, token: string, expiration: string, serverUrl: string) => Promise<void>;
    logout: (force?: boolean) => Promise<void>;
    expireSession: () => void;
    checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: null,
    serverUrl: null,
    isAuthenticated: false,
    isLoading: true,
    subscriptionError: false,

    setSubscriptionError: (error) => set({ subscriptionError: error }),

    login: async (userData, token, expiration, serverUrl) => {
        // Subscription Check
        if (userData.subscription_valid === false) {
            throw new Error("Subscription expired. Please contact support.");
        }

        // Stop any previous user's tracking before wiping local data
        try {
            const { TraccarService } = require('../services/traccar');
            await TraccarService.stopTracking();
        } catch (trackErr) {
            console.warn("Failed to stop tracking before login:", trackErr);
        }

        // await logAsyncStorage('Login Start');
        // await logDatabaseStats('Login Start');
        await clearSession(true); // Clear all local data before new session
        await setSession(userData, token, expiration, serverUrl);

        // Reset sync state to ensure the syncing screen shows until the sync completes
        const { resetSyncState } = require('./useOfflineStore').useOfflineStore.getState();
        resetSyncState();

        // Save Traccar details if present in login response
        if (userData.use_traccar) {
            const { upsertTraccarDevice } = require('../services/database/repositories');
            try {
                await upsertTraccarDevice({
                    local_id: userData.traccar_identifier,
                    interval: userData.traccar_interval,
                    distance: userData.traccar_distance,
                    traccar_url: userData.traccar_url
                });
                console.log("Traccar device saved from login response");

                const { TraccarService } = require('../services/traccar');
                await TraccarService.restartTracking();
            } catch (e) {
                console.error("Failed to save or start Traccar device from login:", e);
            }
        }

        set({
            user: userData,
            token,
            serverUrl,
            isAuthenticated: true,
            isLoading: false
        });

        // Log session login event to Odoo
        try {
            const { getDeviceModel, getMacAddress, getDeviceIdentifier, getCurrentLocation } = require('../utils/device');
            const { logSessionLogin } = require('../services/api');
            const loc = await getCurrentLocation();
            const device_model = getDeviceModel();
            const mac_address = await getMacAddress();
            const device_identifier = await getDeviceIdentifier();
            await logSessionLogin({
                latitude: loc.latitude,
                longitude: loc.longitude,
                device_model,
                mac_address,
                device_identifier
            });
            console.log("Session login logged to Odoo successfully");
        } catch (apiErr) {
            console.error("Failed to log session login to Odoo:", apiErr);
        }
    },

    logout: async (force = false) => {
        // Block logout if unsynced data or an active visit exists
        if (!force) {
            try {
                const { getDB } = require('../services/db');
                const db = await getDB();
                
                // 1. Check for active visits directly in SQLite
                const activeVisit = (await db.getFirstAsync(
                    "SELECT COUNT(*) as count FROM sales_rep_visit WHERE state = 'in_progress'"
                )) as { count: number } | null;
                if (activeVisit && activeVisit.count > 0) {
                    throw new Error("Cannot logout: You have an active visit. Please end the visit before logging out.");
                }

                // 2. Check for unsynced data directly in SQLite
                const visits = (await db.getFirstAsync('SELECT COUNT(*) as count FROM sales_rep_visit WHERE is_synced = 0')) as { count: number } | null;
                const collections = (await db.getFirstAsync('SELECT COUNT(*) as count FROM sales_rep_collection WHERE is_synced = 0')) as { count: number } | null;
                const locations = (await db.getFirstAsync('SELECT COUNT(*) as count FROM location WHERE is_synced = 0')) as { count: number } | null;
                const customers = (await db.getFirstAsync('SELECT COUNT(*) as count FROM sales_route_customer WHERE is_synced = 0')) as { count: number } | null;
                const orders = (await db.getFirstAsync('SELECT COUNT(*) as count FROM sales_order WHERE is_synced = 0')) as { count: number } | null;
                const actions = (await db.getFirstAsync("SELECT COUNT(*) as count FROM pending_action WHERE (is_synced = 0 OR status = 'pending') AND action_type NOT IN ('upload_attachment', 'delete_attachment')")) as { count: number } | null;
                const partners = (await db.getFirstAsync('SELECT COUNT(*) as count FROM res_partner WHERE is_synced = 0')) as { count: number } | null;
                const adjustments = (await db.getFirstAsync('SELECT COUNT(*) as count FROM sales_rep_inventory_adjustment WHERE is_synced = 0')) as { count: number } | null;

                const unsyncedCount = (visits?.count || 0) + 
                                      (collections?.count || 0) + 
                                      (locations?.count || 0) + 
                                      (customers?.count || 0) + 
                                      (orders?.count || 0) + 
                                      (actions?.count || 0) + 
                                      (partners?.count || 0) + 
                                      (adjustments?.count || 0);

                if (unsyncedCount > 0) {
                    throw new Error(`Cannot logout: ${unsyncedCount} item(s) not yet synced. Please connect to the internet and sync first.`);
                }
            } catch (dbError: any) {
                // console.error("Logout check failed:", dbError);
                if (dbError.message && dbError.message.includes("Cannot logout")) {
                    throw dbError;
                }
            }
        }

        // Log session logout event to Odoo before clearing session
        try {
            const { getDeviceModel, getMacAddress, getDeviceIdentifier, getCurrentLocation } = require('../utils/device');
            const { logSessionLogout } = require('../services/api');
            const loc = await getCurrentLocation();
            const device_model = getDeviceModel();
            const mac_address = await getMacAddress();
            const device_identifier = await getDeviceIdentifier();
            await logSessionLogout({
                latitude: loc.latitude,
                longitude: loc.longitude,
                device_model,
                mac_address,
                device_identifier,
                forced: force
            });
            console.log("Session logout logged to Odoo successfully");
        } catch (apiErr) {
            console.error("Failed to log session logout to Odoo:", apiErr);
        }

        const { resetSyncState } = require('./useOfflineStore').useOfflineStore.getState();
        resetSyncState();

        try {
            const { TraccarService } = require('../services/traccar');
            await TraccarService.stopTracking();
        } catch (trackErr) {
            console.warn("Failed to stop tracking on logout:", trackErr);
        }

        await AsyncStorage.removeItem('odoo_session_id');
        await clearSession(true);
        // await logAsyncStorage('Logout Complete');
        // await logDatabaseStats('Logout Complete');
        setApiBaseUrl(process.env.EXPO_PUBLIC_BASE_URL);
        set({
            user: null,
            token: null,
            serverUrl: null,
            isAuthenticated: false,
            isLoading: false
        });
    },

    expireSession: () => {
        // Just clear state to force re-login, but don't wipe DB
        const { resetSyncState } = require('./useOfflineStore').useOfflineStore.getState();
        resetSyncState();
        AsyncStorage.removeItem('odoo_session_id').catch(err => {
            console.error('Failed to remove session id on expire:', err);
        });

        try {
            const { TraccarService } = require('../services/traccar');
            TraccarService.stopTracking().catch((trackErr: unknown) => {
                console.warn("Failed to stop tracking on session expire:", trackErr);
            });
        } catch (trackErr) {
            console.warn("Failed to stop tracking on session expire:", trackErr);
        }

        set({
            isAuthenticated: false,
            token: null
            // We keep user data potentially to pre-fill login? 
            // Or better to clear it to be safe.
        });
    },

    checkSession: async () => {
        set({ isLoading: true });
        try {
            const session = await getSession();
            if (session) {
                const serverUrl = (session as any).server_url;
                if (serverUrl) {
                    setApiBaseUrl(serverUrl);
                }

                set({
                    user: (session as any).raw_data,
                    token: (session as any).access_token,
                    serverUrl: serverUrl,
                    isAuthenticated: true,
                    isLoading: false
                });
            } else {
                set({
                    user: null,
                    token: null,
                    serverUrl: null,
                    isAuthenticated: false,
                    isLoading: false
                });
            }
        } catch (error) {
            console.error('Check Session Error:', error);
            set({
                user: null,
                token: null,
                serverUrl: null,
                isAuthenticated: false,
                isLoading: false
            });
        }
    }
}));
