import { Drawer } from 'expo-router/drawer';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/useThemeStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { TouchableOpacity, Alert, View, Text, StyleSheet, I18nManager, ActivityIndicator, Modal, Switch, ScrollView, Dimensions } from 'react-native';
import { CustomAlert } from '../../components/CustomAlert';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import i18n from '../../i18n';
import { sseService } from '../../services/sseService';
import { DrawerContentScrollView, DrawerItemList, DrawerItem } from '@react-navigation/drawer';
import { isProfileAccessEnabled } from '../../services/database/repositories';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const FALLBACK_SYNC_INTERVAL = 30_000;
const { width } = Dimensions.get('window');

export default function DrawerLayout() {
    const insets = useSafeAreaInsets();
    const { colors, mode, toggleTheme, locale, setLocale } = useThemeStore();
    const { logout, token, user } = useAuthStore();
    const router = useRouter();
    const { performSync, isSyncing, isOffline, setSseStatus, salesRepProfile, unsyncedCounts } = useOfflineStore();
    const syncingRef = useRef(isSyncing);
    const offlineRef = useRef(isOffline);

    useEffect(() => { syncingRef.current = isSyncing; }, [isSyncing]);
    useEffect(() => { offlineRef.current = isOffline; }, [isOffline]);

    useEffect(() => {
        useOfflineStore.getState().fetchSalesRepProfile();
    }, []);

    const hasGeneralReturnAccess =
        isProfileAccessEnabled(salesRepProfile, 'access_general_return')
        || isProfileAccessEnabled(user, 'access_general_return');

    useEffect(() => {
        if (token) {
            const onSyncRequired = () => {
                if (!syncingRef.current) {
                    performSync().catch(() => { });
                }
            };
            sseService.connect(token, onSyncRequired, setSseStatus);
        }
        return () => { sseService.disconnect(); };
    }, [token, setSseStatus]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (useOfflineStore.getState().sseStatus !== 'connected' && !offlineRef.current && !syncingRef.current) {
                performSync().catch(() => { });
            }
        }, FALLBACK_SYNC_INTERVAL);
        return () => { clearInterval(interval); };
    }, []);

    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [alertConfig, setAlertConfig] = useState<{
        visible: boolean;
        title: string;
        message: string;
        confirmText: string;
        cancelText?: string;
        onConfirm: () => void;
        onCancel?: () => void;
    }>({
        visible: false,
        title: '',
        message: '',
        confirmText: '',
        onConfirm: () => { },
    });

    const handleLogout = () => {
        const totalPending = (unsyncedCounts?.visits || 0) + (unsyncedCounts?.collections || 0) + (unsyncedCounts?.locations || 0) + (unsyncedCounts?.pending_updates || 0) + (unsyncedCounts?.orders || 0) + (unsyncedCounts?.actions || 0);

        if (totalPending > 0) {
            setAlertConfig({
                visible: true,
                title: i18n.t('common.warning') || 'Warning',
                message: i18n.t('settings.logout_error_unsynced') || 'You have unsynced data. Please sync before logging out.',
                confirmText: i18n.t('common.ok') || 'OK',
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })),
            });
            return;
        }

        setAlertConfig({
            visible: true,
            title: i18n.t('common.logout') || 'Logout',
            message: i18n.t('settings.logout_confirm') || 'Are you sure you want to logout?',
            confirmText: i18n.t('common.logout') || 'Logout',
            cancelText: i18n.t('common.cancel') || 'Cancel',
            onConfirm: async () => {
                setAlertConfig(prev => ({ ...prev, visible: false }));
                setIsLoggingOut(true);
                try {
                    await logout();
                    router.replace('/(auth)/login');
                } catch (e: any) {
                    setAlertConfig({
                        visible: true,
                        title: i18n.t('common.error') || 'Error',
                        message: e.message,
                        confirmText: i18n.t('common.ok') || 'OK',
                        onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })),
                    });
                } finally {
                    setIsLoggingOut(false);
                }
            },
            onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false }))
        });
    };

    const toggleLanguage = async () => {
        const newLocale = locale === 'en' ? 'ar' : 'en';
        setLocale(newLocale);
        i18n.locale = newLocale;
        try {
            const { TraccarService } = require('../../services/traccar');
            await TraccarService.stopTracking();
        } catch (e) {
            console.warn("Failed to stop tracking before reload: ", e);
        }
        try {
            await Updates.reloadAsync();
        } catch (e) {
            console.error("Failed to reload app: ", e);
        }
    };

    // Get status color
    const getStatusColor = () => {
        if (isOffline) return '#FF6B6B';
        if (useOfflineStore.getState().sseStatus === 'connected') return '#51CF66';
        return '#FFD93D';
    };

    const getStatusText = () => {
        if (isOffline) return 'Offline';
        if (useOfflineStore.getState().sseStatus === 'connected') return 'Online';
        return 'Syncing...';
    };

    return (
        <Drawer
            drawerContent={(props) => (
                <View style={{ flex: 1, backgroundColor: colors.background }}>
                    {/* Clean Flat Header with Status Badge */}
                    <View style={[styles.drawerHeader, { paddingTop: Math.max(insets.top, 16), borderBottomColor: colors.border }]}>
                        <View style={styles.headerTop}>
                            <View style={styles.avatarContainer}>
                                <View style={[styles.avatar, { backgroundColor: colors.primary + '20' }]}>
                                    <Text style={[styles.avatarText, { color: colors.primary }]}>
                                        {user?.name?.[0]?.toUpperCase() || 'U'}
                                    </Text>
                                </View>
                                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(), borderColor: colors.background }]} />
                            </View>

                            <View style={styles.userInfo}>
                                <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                                        {salesRepProfile?.name || 'User'}
                                </Text>
                                <Text style={[styles.userCompany, { color: colors.primary }]} numberOfLines={1}>
                                        {salesRepProfile?.company_name || ''}
                                </Text>
                                <Text style={[styles.userEmail, { color: mode === 'dark' ? '#9CA3AF' : colors.textSecondary }]} numberOfLines={1}>
                                        {salesRepProfile?.email || ''}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <DrawerContentScrollView
                        {...props}
                        contentContainerStyle={{ paddingTop: 0, paddingBottom: 20 }}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Navigation Items */}
                        <View style={styles.navSection}>
                            <DrawerItemList {...props} />
                        </View>
                    </DrawerContentScrollView>

                    {/* Footer with Preferences and Logout */}
                    <View style={[styles.drawerFooter, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 20) }]}>
                        {/* Horizontal Preferences Pill Group */}
                        <View style={styles.preferencesRow}>
                            {/* Language Pill */}
                            <TouchableOpacity
                                onPress={toggleLanguage}
                                style={[styles.preferencePill, { backgroundColor: colors.card, borderColor: colors.border }]}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="language-outline" size={16} color={colors.textSecondary} />
                                <Text style={[styles.preferencePillText, { color: colors.text }]}>
                                    {locale === 'en' ? 'العربية' : 'English'}
                                </Text>
                            </TouchableOpacity>

                            {/* Theme Switch Pill */}
                            <View style={[styles.preferencePill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Ionicons
                                    name={mode === 'dark' ? 'moon-outline' : 'sunny-outline'}
                                    size={16}
                                    color={mode === 'dark' ? '#FFD93D' : colors.textSecondary}
                                />
                                <Switch
                                    value={mode === 'dark'}
                                    onValueChange={toggleTheme}
                                    trackColor={{ false: '#767577', true: colors.primary }}
                                    thumbColor={mode === 'dark' ? colors.primary : '#f4f3f4'}
                                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                                    ios_backgroundColor="#E9ECEF"
                                />
                            </View>
                        </View>

                        {/* Logout Button as a regular menu item */}
                        <TouchableOpacity
                            style={styles.logoutMenuItem}
                            onPress={handleLogout}
                            disabled={isLoggingOut}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                            <Text style={styles.logoutMenuText}>
                                {isLoggingOut ? (i18n.t('common.please_wait') || 'Please wait...') : (i18n.t('common.logout') || 'Logout')}
                            </Text>
                        </TouchableOpacity>

                        {/* Logout Modal */}
                        {isLoggingOut && (
                            <Modal transparent visible={isLoggingOut} animationType="fade">
                                <View style={styles.modalOverlay}>
                                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                                        <ActivityIndicator size="large" color={colors.primary} />
                                        <Text style={[styles.modalText, { color: colors.text }]}>
                                            {i18n.t('settings.logging_out') || 'Logging out...'}
                                        </Text>
                                    </View>
                                </View>
                            </Modal>
                        )}

                        <CustomAlert
                            visible={alertConfig.visible}
                            title={alertConfig.title}
                            message={alertConfig.message}
                            onConfirm={alertConfig.onConfirm}
                            onCancel={alertConfig.onCancel}
                            confirmText={alertConfig.confirmText}
                            cancelText={alertConfig.cancelText}
                        />
                    </View>
                </View>
            )}
            screenOptions={{
                headerShown: false,
                drawerPosition: I18nManager.isRTL ? 'right' : 'left',
                drawerStyle: {
                    backgroundColor: colors.background,
                    width: width * 0.85,
                    maxWidth: 320,
                },
                drawerActiveBackgroundColor: colors.primary + '15',
                drawerActiveTintColor: colors.primary,
                drawerInactiveTintColor: mode === 'dark' ? '#9CA3AF' : colors.textSecondary,
                drawerLabelStyle: {
                    fontSize: 15,
                    fontWeight: '500',
                    marginLeft: -6,
                },
                drawerItemStyle: styles.drawerItem,
            }}
        >
            <Drawer.Screen
                name="index"
                options={{
                    drawerLabel: i18n.t('drawer.dashboard'),
                    title: i18n.t('drawer.dashboard'),
                    drawerIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
                }}
            />

            <Drawer.Screen
                name="storage"
                options={{
                    drawerItemStyle: { ...styles.drawerItem, display: salesRepProfile?.access_storage ? 'flex' : 'none' },
                    drawerLabel: i18n.t('drawer.storage'),
                    title: i18n.t('drawer.storage'),
                    drawerIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} />,
                }}
            />

            <Drawer.Screen
                name="database"
                options={{
                    drawerItemStyle: { display: 'none' },
                    drawerLabel: i18n.t('drawer.database'),
                    title: i18n.t('drawer.database'),
                    drawerIcon: ({ color, size }) => <Ionicons name="server-outline" size={size} color={color} />,
                }}
            />

            <Drawer.Screen
                name="routes"
                options={{
                    drawerLabel: i18n.t('drawer.routes'),
                    title: i18n.t('drawer.routes'),
                    drawerIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="inventory-adjustment"
                options={{
                    drawerItemStyle: { ...styles.drawerItem, display: salesRepProfile?.access_inventory_adjustment ? 'flex' : 'none' },
                    drawerLabel: i18n.t('drawer.inventory_adjustment'),
                    title: i18n.t('drawer.inventory_adjustment'),
                    drawerIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="requests"
                options={{
                    drawerItemStyle: { ...styles.drawerItem, display: salesRepProfile?.access_requests ? 'flex' : 'none' },
                    drawerLabel: i18n.t('drawer.requests'),
                    title: i18n.t('drawer.requests'),
                    drawerIcon: ({ color, size }) => <Ionicons name="git-pull-request-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="delivery"
                options={{
                    drawerItemStyle: { ...styles.drawerItem, display: salesRepProfile?.access_delivery ? 'flex' : 'none' },
                    drawerLabel: i18n.t('drawer.delivery'),
                    title: i18n.t('drawer.delivery'),
                    drawerIcon: ({ color, size }) => <Ionicons name="car-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="delivery_details"
                options={{
                    drawerItemStyle: { display: 'none' },
                    drawerLabel: i18n.t('delivery.details_title') || 'Delivery Details',
                    title: i18n.t('delivery.details_title') || 'Delivery Details',
                }}
            />
            <Drawer.Screen
                name="general_return"
                options={{
                    drawerItemStyle: { ...styles.drawerItem, display: hasGeneralReturnAccess ? 'flex' : 'none' },
                    drawerLabel: i18n.t('general_return.title') || 'General Return',
                    title: i18n.t('general_return.title') || 'General Return',
                    drawerIcon: ({ color, size }) => <Ionicons name="return-down-back-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="general_return_form"
                options={{
                    drawerItemStyle: { display: 'none' },
                    title: i18n.t('general_return.title') || 'General Return',
                }}
            />

            <Drawer.Screen
                name="requests_details"
                options={{
                    drawerItemStyle: { display: 'none' },
                    drawerLabel: i18n.t('requests.request_details') || 'Request Details',
                    title: i18n.t('requests.request_details') || 'Request Details',
                }}
            />
            <Drawer.Screen
                name="reports/index"
                options={{
                    drawerLabel: i18n.t('reports.title') || 'Reports',
                    title: i18n.t('reports.title') || 'Reports',
                    drawerIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="reports/sales"
                options={{
                    drawerItemStyle: { display: 'none' },
                    title: i18n.t('reports.sales_report') || 'Sales Report',
                }}
            />
            <Drawer.Screen
                name="reports/debt"
                options={{
                    drawerItemStyle: { display: 'none' },
                    title: i18n.t('reports.debt_report') || 'Customer Debt Report',
                }}
            />
            <Drawer.Screen
                name="reports/collection"
                options={{
                    drawerItemStyle: { display: 'none' },
                    title: i18n.t('reports.collection_report') || 'Collection Report',
                }}
            />
            <Drawer.Screen
                name="reports/journal"
                options={{
                    drawerItemStyle: { display: 'none' },
                    title: i18n.t('reports.journal_report') || 'Journal Transaction Report',
                }}
            />
            <Drawer.Screen
                name="system-status"
                options={{
                    drawerLabel: i18n.t('drawer.system'),
                    title: i18n.t('drawer.system'),
                    drawerIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
                }}
            />
        </Drawer>
    );
}

const styles = StyleSheet.create({
    drawerHeader: {
        padding: 20,
        borderBottomWidth: 1,
    },
    drawerItem: {
        borderRadius: 10,
        marginHorizontal: 12,
        marginVertical: 2,
    },
    headerTop: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarContainer: {
        position: 'relative',
        marginRight: 15,
    },
    avatar: {
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    statusBadge: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
        borderColor: '#FFFFFF',
    },
    userInfo: {
        flex: 1,
        alignItems: I18nManager.isRTL ? 'flex-end' : 'flex-start',
    },
    userName: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 2,
        textAlign: I18nManager.isRTL ? 'right' : 'left',
    },
    userEmail: {
        fontSize: 12,
        marginBottom: 2,
        textAlign: I18nManager.isRTL ? 'right' : 'left',
    },
    userCompany: {
        fontSize: 12,
        fontWeight: '600',
        textAlign: I18nManager.isRTL ? 'right' : 'left',
    },
    navSection: {
        paddingTop: 8,
    },
    drawerFooter: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 20,
        borderTopWidth: 1,
        gap: 12,
    },
    preferencesRow: {
        flexDirection: 'row',
        gap: 10,
    },
    preferencePill: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        height: 40,
    },
    preferencePillText: {
        fontSize: 13,
        fontWeight: '600',
    },
    logoutMenuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 10,
        gap: 12,
    },
    logoutMenuText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#EF4444',
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    modalContent: {
        padding: 24,
        borderRadius: 16,
        alignItems: 'center',
        gap: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    modalText: {
        fontSize: 15,
        fontWeight: '600',
    },
});