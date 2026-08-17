import { GestureHandlerRootView } from 'react-native-gesture-handler';
// import { Drawer } from 'expo-router/drawer'; // Unused
import { Stack, useRouter, Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

// import { CustomDrawerContent } from '../components/CustomDrawerContent'; // Unused
import { useThemeStore } from '../store/useThemeStore';
import { useOfflineStore } from '../store/useOfflineStore';
import { useAuthStore } from '../store/useAuthStore';
import { ToastProvider } from '@/context/ToastContext';
import { SyncingScreen } from '@/components/SyncingScreen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TraccarService } from '../services/traccar';
export default function RootLayout() {
    const { colors, mode } = useThemeStore();
    const { checkSession, isAuthenticated, isLoading } = useAuthStore();
    const { performSync, isInitialSyncComplete, isOffline, isSyncing, unsyncedCounts } = useOfflineStore();
    const router = useRouter();
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        checkSession().then(() => {
            setIsReady(true);
        });
    }, []);

    useEffect(() => {
        if (isReady && !isAuthenticated && !isLoading) {
            router.replace('/(auth)/login');
        }
    }, [isReady, isAuthenticated, isLoading]);

    useEffect(() => {
        if (isReady && isAuthenticated) {
            performSync();
        }
    }, [isReady, isAuthenticated]);

    // Global Auto-Sync Trigger: If we have unsynced items and are online, sync!
    useEffect(() => {
        if (!isReady || !isAuthenticated || !isInitialSyncComplete) return;

        const totalUploads = (unsyncedCounts.actions || 0); // Exclude background locations from instant sync loop
        const totalPending = (unsyncedCounts.visits || 0) + (unsyncedCounts.collections || 0) + (unsyncedCounts.pending_updates || 0) + (unsyncedCounts.orders || 0);

        if (!isOffline && totalUploads > 0 && !isSyncing) {
            console.log(`Global Auto-Sync: Triggering upload for ${totalUploads} items...`);
            performSync();
        }
    }, [isReady, isAuthenticated, isInitialSyncComplete, isOffline, unsyncedCounts.actions, isSyncing]);

    useEffect(() => {
        if (!isReady || !isAuthenticated || !isInitialSyncComplete) return;

        // User is authenticated and sync is complete, ensure tracking is active
        TraccarService.ensureTracking();

        // Check connection every 5 seconds
        const { checkConnection } = useOfflineStore.getState();
        checkConnection();
        const interval = setInterval(() => {
            checkConnection();
        }, 5000);

        return () => clearInterval(interval);
    }, [isReady, isAuthenticated, isInitialSyncComplete]);

    if (!isReady || isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (isAuthenticated && !isInitialSyncComplete) {
        return <SyncingScreen />;
    }

    return (
        <SafeAreaProvider>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
                <ToastProvider>
                    <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
                    <Stack screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: colors.background }
                    }} />
                </ToastProvider>
            </GestureHandlerRootView>
        </SafeAreaProvider>
    );
}
