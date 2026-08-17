import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from 'expo-background-task';
import * as Battery from "expo-battery";
import * as Notifications from "expo-notifications";
import {
    getTraccarDevice,
    insertLocation,
    getUnsyncedLocations,
    deleteLocation,
    getSalesRepresentative
} from "./database/repositories";
import { getSession } from "./database";
import i18n from "../i18n";
import AsyncStorage from '@react-native-async-storage/async-storage';

import axios from "axios";
import { Platform } from "react-native";
import { reportSecurityAlert } from "./api/locationService";

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

const LOCATION_TASK_NAME = "background-location-task";
const SYNC_TASK_NAME = "traccar-sync-task";
const MOCK_REPORT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between Odoo alerts

export class TraccarService {
    private static isInitialized = false;
    private static isInitializing = false;
    private static locationSubscription: Location.LocationSubscription | null = null;
    private static lastLocationKey: string = "";
    private static lastUpdateCall: number = 0;
    private static lastMockReportAt: number = 0;
    private static lastDevReportAt: number = 0;
    private static activeDeviceLocalId: string = "";

    private static resetTrackingState() {
        this.isInitialized = false;
        this.isInitializing = false;
        this.lastLocationKey = "";
        this.activeDeviceLocalId = "";
    }

    /** Stop listeners and clear in-memory tracking state (logout / user switch). */
    static async stopTracking() {
        try {
            const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
            if (hasStarted) {
                await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
                console.log("📍 Background location tracking stopped");
            }
        } catch (bgError) {
            console.warn("⚠️ Failed to stop background location tracking:", bgError);
        }
        if (this.locationSubscription) {
            this.locationSubscription.remove();
            this.locationSubscription = null;
            console.log("📍 Foreground location tracking stopped");
        }
        this.resetTrackingState();
    }

    /** Full restart — used after login or when the tracked device changes. */
    static async restartTracking() {
        console.log("📍 Restarting Traccar tracking for new session...");
        await this.init({ force: true });
    }

    /** Idempotent start — skips if already tracking the current device. */
    static async ensureTracking() {
        const device = await getTraccarDevice();
        if (!device?.local_id) {
            if (this.isInitialized) {
                await this.stopTracking();
            }
            return;
        }
        if (this.isInitialized && this.activeDeviceLocalId === device.local_id) {
            return;
        }
        await this.restartTracking();
    }

    static async requestPermissions() {
        console.log("📍 Requesting location permissions...");

        const { status: currentFgStatus } = await Location.getForegroundPermissionsAsync();
        console.log("📍 Current Foreground Status:", currentFgStatus);

        if (currentFgStatus !== 'granted') {
            const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
            console.log("📍 New Foreground Status:", fgStatus);
            if (fgStatus !== 'granted') {
                console.warn("❌ Foreground location permission denied");
                return false;
            }
        }

        const { status: currentBgStatus } = await Location.getBackgroundPermissionsAsync();
        console.log("📍 Current Background Status:", currentBgStatus);

        if (currentBgStatus !== 'granted') {
            console.log("📍 Requesting Background permission (will wait 1s for transition)...");
            await new Promise(resolve => setTimeout(resolve, 1000));

            const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
            console.log("📍 New Background Status:", bgStatus);
            if (bgStatus !== 'granted') {
                console.warn("❌ Background location permission denied");
                return false;
            }
        }

        // Request notification permissions for foreground service
        try {
            const { status: ntStatus } = await Notifications.requestPermissionsAsync();
            console.log("📍 Notification Status:", ntStatus);
        } catch (nError) {
            console.warn("⚠️ Notifications permission request failed:", nError);
        }

        return true;
    }

    static async init(options?: { force?: boolean }) {
        const force = options?.force ?? false;

        if (this.isInitializing && !force) return;

        if (force) {
            await this.stopTracking();
        } else if (this.isInitialized) {
            const device = await getTraccarDevice();
            if (device?.local_id && device.local_id === this.activeDeviceLocalId) {
                return;
            }
            await this.stopTracking();
        }

        this.isInitializing = true;

        try {
            const hasPermissions = await this.requestPermissions();
            if (!hasPermissions) {
                return;
            }
            const device = await getTraccarDevice();
            if (device && device.local_id) {
                console.log("📍 Traccar Service Initialized for device:", device.local_id);
                this.activeDeviceLocalId = device.local_id;
                this.lastLocationKey = "";
                await this.startTracking(undefined, undefined, true);
                this.syncOfflineLocations();
                this.isInitialized = true;
            } else {
                console.log("📍 Traccar Service: No device configured yet.");
            }
        } catch (error) {
            console.error("❌ Error initializing Traccar Service:", error);
        } finally {
            this.isInitializing = false;
        }
    }

    static async startTracking(lastLat?: number, lastLon?: number, forceRestart = false) {
        // Debounce frequent notification updates (every 2 seconds)
        const now = Date.now();
        if (lastLat !== undefined && lastLon !== undefined && (now - this.lastUpdateCall < 2000)) return;
        this.lastUpdateCall = now;

        const device = await getTraccarDevice();
        const interval = device?.interval ? device.interval * 1000 : 10000;
        const distance = device?.distance ? device.distance : 10;

        const isUpdate = (lastLat !== undefined && lastLon !== undefined);
        const body = isUpdate
            ? `📍 Live: ${lastLat.toFixed(5)}, ${lastLon.toFixed(5)}`
            : "Tracking your location for sales route...";

        if (isUpdate) {
            console.log(`📍 UI Refresh triggered for: ${lastLat}, ${lastLon}`);
        }

        try {
            let hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
            if (hasStarted && forceRestart) {
                await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
                hasStarted = false;
                console.log("📍 Background location tracking restarted (force)");
            }
            if (!hasStarted) {
                await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
                    accuracy: Location.Accuracy.High,
                    timeInterval: interval,
                    distanceInterval: distance,
                    activityType: Location.ActivityType.AutomotiveNavigation,
                    pausesUpdatesAutomatically: false,
                    foregroundService: {
                        notificationTitle: i18n.t('security.tracking_active_title'),
                        notificationBody: i18n.t('security.tracking_active_body'),
                    },
                    deferredUpdatesInterval: interval,
                    deferredUpdatesDistance: distance,
                });
            }
        } catch (bgError) {
            console.warn("⚠️ Background Location Updates start failed, falling back to foreground tracking:", bgError);
        }

        // Setup listeners only on first start
        if (!lastLat && !lastLon) {
            console.log(`📍 Tracking started. Interval: ${interval}ms`);

            // Register Background Sync Task using expo-background-task
            try {
                await BackgroundTask.registerTaskAsync(SYNC_TASK_NAME, {
                    minimumInterval: 15 * 60,
                });
            } catch (err) {
                // Task might already be registered
            }

            // --- FOREGROUND FALLBACK ---
            if (this.locationSubscription) {
                this.locationSubscription.remove();
                this.locationSubscription = null;
            }
            this.locationSubscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: interval,
                    distanceInterval: distance,
                },
                (location) => this.processLocation(location)
            );

            if (forceRestart) {
                try {
                    const location = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.High,
                    });
                    await this.processLocation(location);
                } catch (locError) {
                    console.warn("📍 Failed immediate location ping on restart:", locError);
                }
            }
        }
    }

    static async processLocation(location: Location.LocationObject) {
        // Ensure the user has an active session before processing location updates
        try {
            const session = await getSession();
            if (!session) {
                console.log("📍 Traccar: No active session. Stopping location tracking.");
                await this.stopTracking();
                return;
            }
        } catch (sessErr) {
            console.warn("Failed to check active session:", sessErr);
            return;
        }

        let profile: any = null;
        try {
            profile = await getSalesRepresentative();
        } catch (err) {
            console.warn("Failed to get sales rep profile:", err);
        }

        // Security check for mock location and developer options
        if (profile) {
            try {
                let isDevMode = false;
                if (profile.access_developer_mode || profile.access_force_logout_on_developer_mode) {
                    try {
                        const JailMonkey = require('jail-monkey').default;
                        isDevMode = await JailMonkey.isDevelopmentSettingsMode();
                    } catch (err) {
                        console.warn("JailMonkey developer settings check failed:", err);
                    }
                }

                const mockViolated = location.mocked && profile.access_force_logout_on_mock_location;
                const devViolated = isDevMode && profile.access_force_logout_on_developer_mode;

                const { useOfflineStore } = require('../store/useOfflineStore');

                if (mockViolated || devViolated) {
                    console.log(`📍🚨 SECURITY VIOLATION: mockViolated=${mockViolated}, devViolated=${devViolated}. Forcing logout!`);
                    try {
                        useOfflineStore.setState({ pendingForceLogout: mockViolated ? 'mock' : 'dev' });
                    } catch (storeErr) {
                        console.warn("Failed to set pendingForceLogout in store:", storeErr);
                    }
                    try {
                        if (Platform.OS === 'android') {
                            await Notifications.setNotificationChannelAsync('security-alerts', {
                                name: 'Security Alerts',
                                importance: Notifications.AndroidImportance.HIGH,
                                vibrationPattern: [0, 250, 250, 250],
                                lightColor: '#FF0000',
                            });
                        }
                        await Notifications.scheduleNotificationAsync({
                            identifier: 'security-violation-alert',
                            content: {
                                title: i18n.t('security.title'),
                                body: mockViolated
                                    ? i18n.t('security.mock_detected_logout')
                                    : i18n.t('security.dev_detected_logout'),
                                sound: true,
                                priority: Notifications.AndroidNotificationPriority.HIGH,
                                ...(Platform.OS === 'android' && { channelId: 'security-alerts' }),
                            },
                            trigger: null,
                        });
                    } catch (notiError) {
                        console.warn("Failed to schedule security notification:", notiError);
                    }

                    try {
                        await AsyncStorage.setItem('pending_force_logout', mockViolated ? 'mock' : 'dev');
                        console.log("📍 Flagged pending_force_logout in AsyncStorage:", mockViolated ? 'mock' : 'dev');
                    } catch (storeError) {
                        console.error("Failed to flag pending force logout in AsyncStorage:", storeError);
                    }
                    return; // Stop processing location
                }

                // If developer mode is active and reporting is enabled, trigger the warning alert
                if (isDevMode && profile.access_developer_mode) {
                    console.log("📍🚨 DEVELOPER OPTIONS DETECTED! (isDevMode=true)");
                    useOfflineStore.setState({ isDevModeActive: true });
                    await this.reportSecurityAlert(location, true);
                } else {
                    useOfflineStore.setState({ isDevModeActive: false });
                }
            } catch (secError) {
                console.error("Error during security limit checks:", secError);
            }
        }

        const isMockActive = location.mocked && profile && (profile.access_mock_location || profile.access_force_logout_on_mock_location);
        const { useOfflineStore: offlineStore } = require('../store/useOfflineStore');
        offlineStore.setState({ isMockLocationActive: !!isMockActive });

        if (isMockActive) {
            console.log("📍🚨 FAKE LOCATION DETECTED! (mocked=true)", location.coords);
            await this.reportSecurityAlert(location, false);
        }

        // Deduplication guard: ignore internal updates for same position
        const lat = location.coords.latitude.toFixed(6);
        const lon = location.coords.longitude.toFixed(6);
        const posKey = `${lat},${lon}`;

        if (posKey === this.lastLocationKey) return;
        this.lastLocationKey = posKey;

        try {
            const device = await getTraccarDevice();
            if (!device || !device.local_id || !device.traccar_url) return;

            if (device.local_id !== this.activeDeviceLocalId) {
                this.lastLocationKey = "";
                this.activeDeviceLocalId = device.local_id;
            }

            const timestamp = Math.floor(location.timestamp / 1000);
            const speedKnots = (location.coords.speed || 0) * 1.943844;
            const batteryLevel = await Battery.getBatteryLevelAsync();
            const battery = Math.round(batteryLevel * 100);

            let baseUrl = device.traccar_url.replace(/\/$/, "");
            if (baseUrl.startsWith('https://')) {
                baseUrl = baseUrl.replace('https://', 'http://');
            }
            if (!baseUrl.match(/:\d+$/)) {
                baseUrl += ":5055";
            }

            const params = new URLSearchParams({
                id: device.local_id,
                timestamp: timestamp.toString(),
                lat: location.coords.latitude.toFixed(6),
                lon: location.coords.longitude.toFixed(6),
                speed: speedKnots.toFixed(2),
                bearing: (location.coords.heading || 0).toFixed(1),
                altitude: (location.coords.altitude || 0).toFixed(1),
                accuracy: (location.coords.accuracy || 0).toFixed(1),
                batt: battery.toString()
            });

            const url = `${baseUrl}?${params.toString()}`;
            // console.log(`📍 Sending location: ${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)} to ${device.traccar_url}`);

            try {
                // Use direct axios.get for OsmAnd protocol compatibility
                const response = await axios.get(url, {
                    headers: { 'User-Agent': 'Trackly/1.0' },
                    timeout: 10000,
                });

                if (response.status === 200 || response.status === 204) {
                    // console.log("📍✅ Location sent to Traccar successfully.");
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (networkError: any) {
                console.warn(`❌ Network error (${networkError.message}). Buffering locally.`);
                await insertLocation({
                    device_id: device.id,
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    speed: speedKnots,
                    course: location.coords.heading || 0,
                    accuracy: location.coords.accuracy || 0,
                    battery: battery,
                    timestamp: location.timestamp
                });
            }
        } catch (error) {
            console.error("❌ Error processing location:", error);
        }
    }

    private static async reportSecurityAlert(location: Location.LocationObject, isDevMode: boolean = false) {
        try {
            // Ensure the channel exists (Android specific, safe for iOS)
            if (Platform.OS === 'android') {
                await Notifications.setNotificationChannelAsync('mock-alerts', {
                    name: 'Mock Location Alerts',
                    importance: Notifications.AndroidImportance.HIGH,
                    vibrationPattern: [0, 250, 250, 250],
                    lightColor: '#FF0000',
                });
            }

            // Check if notification is already presented in the tray
            const presented = await Notifications.getPresentedNotificationsAsync();
            const isAlertPresented = presented.some(n => n.request.identifier === 'mock-location-alert');

            if (!isAlertPresented) {
                await Notifications.scheduleNotificationAsync({
                    identifier: 'mock-location-alert',
                    content: {
                        title: i18n.t('security.alert_title'),
                        body: isDevMode
                            ? i18n.t('security.dev_detected_body')
                            : i18n.t('security.mock_detected_body'),
                        sound: true,
                        priority: Notifications.AndroidNotificationPriority.HIGH,
                        // On Android, explicitly attach it to the high-importance channel
                        ...(Platform.OS === 'android' && { channelId: 'mock-alerts' }),
                    },
                    trigger: null, // Displays immediately
                });
                console.log("Security warning notification scheduled locally");
            }
        } catch (error) {
            console.warn("Failed to schedule notification:", error);
        }

        // Send security alert to Odoo for both mock location and developer mode
        const now = Date.now();
        const lastReportAt = isDevMode ? this.lastDevReportAt : this.lastMockReportAt;
        if (now - lastReportAt < MOCK_REPORT_COOLDOWN_MS) {
            return;
        }

        if (isDevMode) {
            this.lastDevReportAt = now;
        } else {
            this.lastMockReportAt = now;
        }

        const alertType = isDevMode ? 'developer_mode' : 'mock_location';

        try {
            const device = await getTraccarDevice();
            await reportSecurityAlert({
                alert_type: alertType,
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                accuracy: location.coords.accuracy ?? undefined,
                device_identifier: device?.local_id || undefined,
            });
            console.log(`📍 Security alert (${alertType}) sent to Odoo`);
        } catch (error: any) {
            console.warn("Failed to report security alert to Odoo:", error?.message || error);
            // Allow retry on next detection after cooldown
            if (isDevMode) {
                this.lastDevReportAt = 0;
            } else {
                this.lastMockReportAt = 0;
            }
        }
    }

    static async syncOfflineLocations() {
        const locations = await getUnsyncedLocations();
        if (locations.length === 0) return;

        console.log(`📍 Found ${locations.length} offline locations to sync...`);
        const device = await getTraccarDevice();
        if (!device || !device.traccar_url) return;

        let baseUrl = device.traccar_url.replace(/\/$/, "");
        if (baseUrl.startsWith('https://')) {
            baseUrl = baseUrl.replace('https://', 'http://');
        }
        if (!baseUrl.match(/:\d+$/)) {
            baseUrl += ":5055";
        }

        for (const loc of locations) {
            const params = new URLSearchParams({
                id: device.local_id,
                timestamp: Math.floor(loc.timestamp / 1000).toString(),
                lat: loc.latitude.toFixed(6),
                lon: loc.longitude.toFixed(6),
                speed: loc.speed.toFixed(2),
                bearing: loc.course.toFixed(1),
                altitude: "0",
                accuracy: loc.accuracy.toFixed(1),
                batt: loc.battery.toString()
            });

            try {
                const response = await axios.get(`${baseUrl}?${params.toString()}`, {
                    headers: { 'User-Agent': 'Trackly/1.0' },
                    timeout: 10000,
                });

                if (response.status === 200 || response.status === 204) {
                    await deleteLocation(loc.id);
                    console.log(`✅ Offline location ${loc.id} synced.`);
                }
            } catch (e) {
                break;
            }
        }
    }
}

// Background Task Definitions
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
        console.log("BG Location Task Error:", error);
        return;
    }
    if (data) {
        const { locations } = data as { locations: Location.LocationObject[] };
        const location = locations[0];
        if (location) {
            // Process the location (send to server)
            await TraccarService.processLocation(location);
        }
    }
});

// Background Task Definitions - Define with safe return codes
TaskManager.defineTask(SYNC_TASK_NAME, async () => {
    try {
        await TraccarService.syncOfflineLocations();
    } catch (error) {
        console.error("BG Sync Task Error:", error);
    }
});
