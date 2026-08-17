import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform, StatusBar as RNStatusBar, RefreshControl, Modal, ActivityIndicator, UIManager } from 'react-native';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomAlert } from '../../components/CustomAlert';
import { useThemeStore } from '../../store/useThemeStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import i18n from '../../i18n';

export default function Dashboard() {
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const { colors } = useThemeStore();
    const { logout, user } = useAuthStore();
    const {
        isOffline, isSyncing, performSync,
        currentRoute, salesRepProfile,
        fetchLocalRoutes, fetchSalesRepProfile,
        unsyncedCounts, fetchUnsyncedCounts,
        activeVisits, fetchActiveVisits,
        recentActivity, fetchRecentActivity,
        routes, selectRoute,
        sseStatus, dashboardStats, fetchDashboardStats,
        journalPaymentStats, fetchJournalPaymentStats,
        journalHistoricalPayments, fetchJournalHistoricalPayments,
        isMockLocationActive, isDevModeActive,
        pendingForceLogout, setSecurityStatus
    } = useOfflineStore();
    const router = useRouter();
    const [refreshing, setRefreshing] = useState(false);
    const [selectedJournal, setSelectedJournal] = useState<any | null>(null);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [, setTick] = useState(0); // for live timer
    const [showPaymentSummary, setShowPaymentSummary] = useState(false);

    // Alert State
    const [alertConfig, setAlertConfig] = useState<{
        visible: boolean;
        title: string;
        message: string;
        confirmText?: string;
        cancelText?: string;
        onConfirm: () => void;
        onCancel?: () => void;
    }>({
        visible: false,
        title: '',
        message: '',
        onConfirm: () => { },
    });

    const showAlert = (config: Omit<typeof alertConfig, 'visible'>) => {
        setAlertConfig({ ...config, visible: true });
    };

    // Live timer tick
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    // Watch pending force logout flag from background task in real-time
    useEffect(() => {
        if (pendingForceLogout) {
            const isMockViolated = pendingForceLogout === 'mock' && salesRepProfile?.access_force_logout_on_mock_location;
            const isDevViolated = pendingForceLogout === 'dev' && salesRepProfile?.access_force_logout_on_developer_mode;

            if (!isMockViolated && !isDevViolated) {
                AsyncStorage.removeItem('pending_force_logout');
                setSecurityStatus({ pendingForceLogout: null });
                return;
            }

            console.log(`📍🚨 Real-time Security Violation detected in store: ${pendingForceLogout}. Showing alert.`);
            AsyncStorage.removeItem('pending_force_logout');
            setSecurityStatus({ pendingForceLogout: null });
            showAlert({
                title: "Security Violation",
                message: pendingForceLogout === 'mock'
                    ? "Mock location detected on your device. Force logging out."
                    : "Developer options are enabled on your device. Force logging out.",
                onConfirm: async () => {
                    await logout(true);
                    router.replace('/(auth)/login');
                }
            });
        }
    }, [pendingForceLogout, salesRepProfile]);

    useFocusEffect(
        useCallback(() => {
            loadData();
        }, [])
    );

    const loadData = async () => {
        await fetchLocalRoutes();
        await fetchSalesRepProfile();
        await fetchUnsyncedCounts();
        await fetchActiveVisits();
        await fetchRecentActivity();
        await fetchDashboardStats(); // Refresh dashboard stats
        await fetchJournalPaymentStats(); // Refresh journal/payment stats

        // Check if mock location or developer mode is active and enforce security rules
        try {
            let isMock = false;
            let isMockActiveValue = false;
            if (salesRepProfile?.access_mock_location || salesRepProfile?.access_force_logout_on_mock_location) {
                const { status } = await Location.getForegroundPermissionsAsync();
                if (status === 'granted') {
                    const lastKnown = await Location.getLastKnownPositionAsync();
                    if (lastKnown) {
                        isMock = !!lastKnown.mocked;
                    } else {
                        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
                        isMock = !!current?.mocked;
                    }
                    isMockActiveValue = isMock && salesRepProfile?.access_mock_location;
                }
            }

            let isDevMode = false;
            let isDevModeActiveValue = false;
            if (salesRepProfile?.access_developer_mode || salesRepProfile?.access_force_logout_on_developer_mode) {
                try {
                    const JailMonkey = require('jail-monkey').default;
                    isDevMode = await JailMonkey.isDevelopmentSettingsMode();
                } catch (dmErr) {
                    console.warn("Error checking development settings:", dmErr);
                }
                isDevModeActiveValue = isDevMode && salesRepProfile?.access_developer_mode;
            }

            const storagePending = await AsyncStorage.getItem('pending_force_logout');
            const currentPending = pendingForceLogout || (storagePending as 'mock' | 'dev' | null);

            setSecurityStatus({
                isMockLocationActive: isMockActiveValue,
                isDevModeActive: isDevModeActiveValue,
                pendingForceLogout: currentPending
            });

            const mockViolated = (isMock || currentPending === 'mock') && salesRepProfile?.access_force_logout_on_mock_location;
            const devViolated = (isDevMode || currentPending === 'dev') && salesRepProfile?.access_force_logout_on_developer_mode;

            if (mockViolated || devViolated) {
                console.log(`📍🚨 Dashboard Security Violation: mockViolated=${mockViolated}, devViolated=${devViolated}. Showing alert before logout.`);
                await AsyncStorage.removeItem('pending_force_logout');
                setSecurityStatus({ pendingForceLogout: null });
                showAlert({
                    title: "Security Violation",
                    message: (mockViolated && !devViolated)
                        ? "Mock location detected on your device. Force logging out."
                        : "Developer options are enabled on your device. Force logging out.",
                    onConfirm: async () => {
                        await logout(true);
                        router.replace('/(auth)/login');
                    }
                });
            }
        } catch (error) {
            console.warn("Error checking mock location status:", error);
        }
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await loadData();
        setRefreshing(false);
    };

    const handleLogout = async () => {
        try {
            await logout();
            router.replace('/(auth)/login');
        } catch (e: any) {
            showAlert({
                title: i18n.t('common.warning') || 'Warning',
                message: e.message,
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        }
    };

    const handleSync = async () => {
        if (isSyncing) return;
        await performSync();
    };

    const handleJournalPress = async (journal: any) => {
        setSelectedJournal(journal);
        setLoadingHistory(true);
        await fetchJournalHistoricalPayments(journal.journal_id);
        setLoadingHistory(false);
    };

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return i18n.t('dashboard.greeting_morning');
        if (hour < 18) return i18n.t('dashboard.greeting_afternoon');
        return i18n.t('dashboard.greeting_evening');
    };

    const getDateLabel = (dateStr: string) => {
        const date = dayjs(dateStr);
        const today = dayjs().startOf('day');
        const yesterday = dayjs().subtract(1, 'day').startOf('day');
        const dateFormatted = date.format('DD MMMM YYYY');

        if (date.isSame(today, 'day')) return `${i18n.t('common.today')}, ${dateFormatted}`;
        if (date.isSame(yesterday, 'day')) return `${i18n.t('common.yesterday')}, ${dateFormatted}`;
        return dateFormatted;
    };

    const groupActivitiesByDate = () => {
        const groups: { [key: string]: any[] } = {};
        recentActivity.forEach(item => {
            const date = dayjs(item.timestamp).format('YYYY-MM-DD');
            if (!groups[date]) groups[date] = [];
            groups[date].push(item);
        });
        return Object.keys(groups)
            .sort((a, b) => dayjs(b).unix() - dayjs(a).unix())
            .map(date => ({
                date,
                label: getDateLabel(date),
                data: groups[date]
            }));
    };

    const groupedActivities = groupActivitiesByDate();

    // Calculate progress
    const totalVisits = dashboardStats.totalVisits;
    const completedVisits = dashboardStats.completedVisits;
    const progress = totalVisits > 0 ? completedVisits / totalVisits : 0;

    // structured journal stats
    const journalsData = journalPaymentStats;

    return (
        <>
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
                <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 12 }}>
                            <Ionicons name="menu-outline" size={28} color={colors.text} />
                        </TouchableOpacity>
                        <View>
                            <Text style={[styles.title, { color: colors.text }]}>
                                {salesRepProfile?.name || salesRepProfile?.email?.split('@')[0] || i18n.t('dashboard.sales_rep')}
                            </Text>
                            <Text style={[styles.greeting, { color: colors.textSecondary }]}>
                                {salesRepProfile?.company_name}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.headerRight}>
                        {/* Check Connection between the device and the server */}
                        <TouchableOpacity
                            style={[styles.iconButton, {
                                backgroundColor: isSyncing ? colors.background :
                                    (sseStatus === 'connected' ? colors.success + '20' :
                                        sseStatus === 'connecting' ? colors.primary + '20' :
                                            sseStatus === 'offline' ? colors.danger + '20' : colors.textSecondary + '20')
                            }]}
                            onPress={handleSync}
                        >
                            <Ionicons
                                name={isSyncing ? "sync" :
                                    (sseStatus === 'connected' || sseStatus === 'connecting' ? 'radio' : 'radio-outline')}
                                size={22}
                                color={isSyncing ? colors.textSecondary :
                                    (sseStatus === 'connected' ? colors.success :
                                        sseStatus === 'connecting' ? colors.primary :
                                            sseStatus === 'offline' ? colors.danger : colors.textSecondary)}
                                style={(isSyncing || sseStatus === 'connecting') ? styles.rotating : undefined}
                            />
                        </TouchableOpacity>

                    </View>
                </View>

                <ScrollView
                    contentContainerStyle={styles.content}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
                >
                    {(unsyncedCounts.visits > 0 || unsyncedCounts.collections > 0 || unsyncedCounts.locations > 0 || unsyncedCounts.pending_updates > 0 || unsyncedCounts.orders > 0 || unsyncedCounts.actions > 0 || unsyncedCounts.inventory_adjustments > 0) && (
                        <View style={[styles.unsyncedCard, { backgroundColor: colors.warning + '15', borderColor: colors.warning }]}>
                            <View style={styles.unsyncedInfo}>
                                <Ionicons name="cloud-offline" size={24} color={colors.warning} />
                                <View>
                                    <Text style={[styles.unsyncedTitle, { color: colors.text }]}>{i18n.t('dashboard.pending_sync')}</Text>
                                    <Text style={[styles.unsyncedText, { color: colors.textSecondary }]}>
                                        {[
                                            unsyncedCounts.visits > 0 ? i18n.t('dashboard.pending_visits_count', { count: unsyncedCounts.visits }) : null,
                                            unsyncedCounts.collections > 0 ? i18n.t('dashboard.pending_collections_count', { count: unsyncedCounts.collections }) : null,
                                            unsyncedCounts.orders > 0 ? i18n.t('dashboard.pending_orders_count', { count: unsyncedCounts.orders }) : null,
                                            unsyncedCounts.locations > 0 ? i18n.t('dashboard.pending_locations_count', { count: unsyncedCounts.locations }) : null,
                                            unsyncedCounts.pending_updates > 0 ? i18n.t('dashboard.pending_updates_count', { count: unsyncedCounts.pending_updates }) : null,
                                            unsyncedCounts.actions > 0 ? i18n.t('dashboard.pending_actions_count', { count: unsyncedCounts.actions }) : null,
                                            unsyncedCounts.inventory_adjustments > 0 ? i18n.t('dashboard.pending_inventory_adjustments_count', { count: unsyncedCounts.inventory_adjustments }) : null
                                        ].filter(Boolean).join(i18n.t('common.separator'))}
                                    </Text>
                                </View>
                            </View>
                            <TouchableOpacity
                                style={[styles.syncButton, { backgroundColor: colors.warning }]}
                                onPress={handleSync}
                                disabled={isSyncing}
                            >
                                <Text style={styles.syncButtonText}>{isSyncing ? i18n.t('common.syncing') : i18n.t('common.sync_now')}</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                    {/* show this section when mock location is active */}
                    {isMockLocationActive && (
                        <View style={[styles.unsyncedCard, { backgroundColor: colors.warning + '15', borderColor: colors.warning }]}>
                            <View style={styles.unsyncedInfo}>
                                <Ionicons name="warning" size={24} color={colors.warning} />
                                <View>
                                    <Text style={[styles.unsyncedTitle, { color: colors.text }]}>{i18n.t('dashboard.mock_location_active')}</Text>
                                    <Text style={[styles.unsyncedText, { color: colors.textSecondary }]}>
                                        {i18n.t('dashboard.mock_location_active_desc')}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    )}
                    {/* show this section when developer options are active */}
                    {isDevModeActive && (
                        <View style={[styles.unsyncedCard, { backgroundColor: colors.warning + '15', borderColor: colors.warning }]}>
                            <View style={styles.unsyncedInfo}>
                                <Ionicons name="construct" size={24} color={colors.warning} />
                                <View>
                                    <Text style={[styles.unsyncedTitle, { color: colors.text }]}>{i18n.t('dashboard.dev_mode_active')}</Text>
                                    <Text style={[styles.unsyncedText, { color: colors.textSecondary }]}>
                                        {i18n.t('dashboard.dev_mode_active_desc')}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    )}
                    {/* Statistics Cards */}
                    <View style={styles.statsContainer}>
                        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <View style={[styles.statIcon, { backgroundColor: colors.primary + '20' }]}>
                                <Ionicons name="location" size={20} color={colors.primary} />
                            </View>
                            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{i18n.t('dashboard.visits')}</Text>
                            <Text style={[styles.statValue, { color: colors.text }]}>
                                {currentRoute ? `${completedVisits}/${totalVisits}` : '-/-'}
                            </Text>
                        </View>
                        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <View style={[styles.statIcon, { backgroundColor: '#10b98120' }]}>
                                <Ionicons name="cash" size={20} color="#10b981" />
                            </View>
                            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{i18n.t('dashboard.sales')}</Text>
                            <Text style={[styles.statValue, { color: colors.text }]}>
                                {i18n.t('common.currency_symbol') || '$'}{dashboardStats.actualSales.toFixed(2)}
                            </Text>
                        </View>
                        <TouchableOpacity 
                            style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                            onPress={() => {
                                setShowPaymentSummary(!showPaymentSummary);
                            }}
                            activeOpacity={0.7}
                        >
                            <View style={[styles.statIcon, { backgroundColor: '#f59e0b20' }]}>
                                <Ionicons name="wallet" size={20} color="#f59e0b" />
                            </View>
                            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{i18n.t('dashboard.collect')}</Text>
                            <Text style={[styles.statValue, { color: colors.text }]}>
                                {i18n.t('common.currency_symbol') || '$'}{dashboardStats.actualCollections.toFixed(2)}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Payment Summary Section */}
                    {showPaymentSummary && (
                        <Animated.View 
                            layout={LinearTransition} 
                            style={styles.section}
                            entering={FadeInDown.duration(300)}
                            exiting={FadeOutUp.duration(300)}
                        >
                            {!salesRepProfile?.access_cash_balance ? (
                                <View style={{ padding: 20, alignItems: 'center' }}>
                                    <Ionicons name="lock-closed-outline" size={24} color={colors.textSecondary} />
                                    <Text style={{ color: colors.textSecondary, marginTop: 8, textAlign: 'center' }}>
                                        {i18n.t('dashboard.access_denied_cash') || 'Access to cash balance details is disabled in your profile.'}
                                    </Text>
                                </View>
                            ) : journalsData.length === 0 ? (
                                <View style={{ padding: 20, alignItems: 'center' }}>
                                    <Ionicons name="information-circle-outline" size={24} color={colors.textSecondary} />
                                    <Text style={{ color: colors.textSecondary, marginTop: 8 }}>
                                        {i18n.t('dashboard.no_journals') || 'No journals assigned or available.'}
                                    </Text>
                                </View>
                            ) : (
                                journalsData.map((journal: any, index: number) => (


                                <Animated.View 
                                    key={journal.journal_id}
                                    entering={FadeInDown.delay(index * 40).springify()}
                                    exiting={FadeOutUp.delay((journalsData.length - 1 - index) * 40).springify()}
                                    layout={LinearTransition}
                                >
                                    <TouchableOpacity
                                        style={[styles.journalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                                        activeOpacity={0.7}
                                        onPress={() => handleJournalPress(journal)}
                                    >
                                        <View style={styles.journalHeader}>
                                            <View style={styles.journalTitleContainer}>
                                                <Ionicons name="wallet-outline" size={20} color={colors.primary} />
                                                <Text style={[styles.journalName, { color: colors.text }]}>{journal.journal_name}</Text>
                                            </View>
                                            <View style={styles.journalRight}>
                                                <Text style={[styles.todayLabel, { color: colors.textSecondary }]}>{i18n.t('dashboard.balance')}</Text>
                                                <Text style={[styles.todayValue, { color: colors.primary }]}>
                                                    {journal.journal_balance?.toLocaleString()} EGP
                                                </Text>
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                </Animated.View>
                            )))
                        }

                    </Animated.View>
                )}




                    {/* ── Active Visit Card ── */}
                    <Animated.View layout={LinearTransition}>
                        {(() => {
                            const visit = activeVisits?.[0];
                        if (!visit) return (
                            <View style={[styles.section]}>
                                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 8 }]}>
                                    {i18n.t('dashboard.active_visits')}
                                </Text>
                                <View style={[styles.emptyActiveVisit, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <Ionicons name="walk-outline" size={20} color={colors.textSecondary} style={{ opacity: 0.5 }} />
                                    <Text style={[styles.emptyActiveVisitText, { color: colors.textSecondary }]}>
                                        {i18n.t('dashboard.no_active_visits')}
                                    </Text>
                                </View>
                            </View>
                        );

                        // Compute duration
                        const startTime = visit.start_time || visit.visit_start_time;
                        const diff = startTime ? dayjs().diff(dayjs(startTime), 'second') : 0;
                        const h = Math.floor(diff / 3600);
                        const m = Math.floor((diff % 3600) / 60);
                        const s = diff % 60;
                        const timer = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

                        return (
                            <View style={styles.section}>
                                <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 8 }]}>
                                    {i18n.t('dashboard.active_visits')}
                                </Text>
                                <TouchableOpacity
                                    activeOpacity={0.7}
                                    onPress={async () => {
                                        if (visit.route_id) {
                                            const matchingRoute = routes.find(r => r.odoo_id === visit.route_id);
                                            if (matchingRoute) {
                                                await selectRoute(matchingRoute);
                                            }
                                        }
                                        router.push({
                                            pathname: '/(drawer)/routes',
                                            params: { scrollToCustomerId: visit.customer_id }
                                        });
                                    }}
                                    style={[
                                        styles.customerCard,
                                        { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2 }
                                    ]}
                                >
                                    {/* Header */}
                                    <View style={styles.cardHeader}>
                                        <View style={styles.customerInfo}>
                                            <Text style={[styles.customerName, { color: colors.text }]}>
                                                {visit.partner_name || visit.route_customer_name || i18n.t('common.na')}
                                            </Text>
                                            {visit.address ? (
                                                <Text style={[styles.customerAddress, { color: colors.textSecondary }]} numberOfLines={1}>
                                                    {visit.address}
                                                </Text>
                                            ) : null}
                                            {visit.visit_type_name ? (
                                                <Text style={[styles.customerAddress, { color: colors.textSecondary }]} numberOfLines={1}>
                                                    {visit.visit_type_name}
                                                </Text>
                                            ) : null}
                                        </View>
                                        <View style={{ alignItems: 'flex-end' }}>
                                            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                                            <View style={[styles.timerBadge, { backgroundColor: colors.primary + '15', marginTop: 4 }]}>
                                                <Text style={[styles.timerBadgeText, { color: colors.primary }]}>{timer}</Text>
                                            </View>
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        );
                    })()}
                    </Animated.View>

                    {/* Current Route Section */}
                    <Animated.View layout={LinearTransition} style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>{i18n.t('dashboard.todays_route')}</Text>
                        {(() => {
                            const todaysRoutes = routes.filter(r => dayjs(r.date).format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD'));
                            if (todaysRoutes.length > 0) {
                                return todaysRoutes.map((route) => {
                                    const isCurrent = currentRoute?.id === route.id;
                                    return (
                                        <View key={route.id} style={[styles.routeCard, { backgroundColor: colors.card, borderColor: isCurrent ? colors.primary : colors.border, borderWidth: 1, marginBottom: 12 }]}>
                                            <View style={styles.routeHeader}>
                                                <View>
                                                    <Text style={[styles.routeName, { color: colors.text }]}>{route.name}</Text>
                                                    <Text style={[styles.routeStatus, { color: colors.textSecondary }]}>
                                                        {i18n.t('dashboard.status')}: <Text style={{ color: route.state === 'in_progress' ? colors.primary : colors.textSecondary, fontWeight: '600' }}>{i18n.t('dashboard.states.' + route.state, { defaultValue: route.state })}</Text>
                                                    </Text>
                                                </View>
                                                {isCurrent && (
                                                    <View style={[styles.progressBadge, { backgroundColor: colors.primary + '20' }]}>
                                                        <Text style={[styles.progressText, { color: colors.primary }]}>
                                                            {Math.round(progress * 100)}%
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>

                                            {isCurrent && (
                                                <View style={[styles.progressBarBg, { backgroundColor: colors.background, marginTop: 12, height: 6, borderRadius: 3, overflow: 'hidden' }]}>
                                                    <View style={[styles.progressBarFill, { backgroundColor: colors.primary, width: `${progress * 100}%`, height: '100%' }]} />
                                                </View>
                                            )}

                                            <TouchableOpacity
                                                style={[styles.actionButton, { backgroundColor: isCurrent ? colors.primary : colors.border, marginTop: 12 }]}
                                                onPress={async () => {
                                                    if (!isCurrent) await selectRoute(route);
                                                    router.push('/(drawer)/routes');
                                                }}
                                            >
                                                <Text style={[styles.actionButtonText, { color: isCurrent ? '#fff' : colors.text }]}>
                                                    {isCurrent ? i18n.t('dashboard.continue_route') : i18n.t('dashboard.select_route')}
                                                </Text>
                                                <Ionicons name="arrow-forward" size={16} color={isCurrent ? "#fff" : colors.text} />
                                            </TouchableOpacity>
                                        </View>
                                    );
                                });
                            }

                            return (
                                <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <Ionicons name="calendar-outline" size={48} color={colors.textSecondary} style={{ opacity: 0.5 }} />
                                    <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>{i18n.t('dashboard.no_route_today')}</Text>
                                    <TouchableOpacity
                                        style={[styles.secondaryButton, { borderColor: colors.border }]}
                                        onPress={() => router.push('/(drawer)/routes')}
                                    >
                                        <Text style={[styles.secondaryButtonText, { color: colors.text }]}>{i18n.t('dashboard.view_all_routes')}</Text>
                                    </TouchableOpacity>
                                </View>
                            );
                        })()}
                    </Animated.View>

                    {/* Recent Activity */}
                    {/* <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>{i18n.t('dashboard.recent_activity')}</Text>
                        </View>

                        {groupedActivities.length > 0 ? (
                            groupedActivities.map((group, gIndex) => (
                                <View key={group.date} style={{ marginBottom: 16 }}>
                                    <View style={styles.dateHeader}>
                                        <Text style={[styles.dateHeaderText, { color: colors.textSecondary }]}>{group.label}</Text>
                                    </View>
                                    <View style={[styles.activityList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                        {group.data.slice(0, 8).map((item, index, array) => (
                                            <View key={item.id || index} style={[styles.activityItem, { borderBottomColor: colors.border, borderBottomWidth: index === array.length - 1 ? 0 : 1 }]}>
                                                <View style={[styles.activityIcon, { backgroundColor: getActivityColor(item.type, colors) + '20' }]}>
                                                    <Ionicons name={getActivityIcon(item.type)} size={18} color={getActivityColor(item.type, colors)} />
                                                </View>
                                                <View style={styles.activityContent}>
                                                    <Text style={[styles.activityTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                                                    <Text style={[styles.activitySubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                                                        {item.subtitle}
                                                        {!!item.status && <Text style={{ color: colors.primary }}> • {item.status}</Text>}
                                                    </Text>
                                                </View>
                                                <View style={styles.activityRight}>
                                                    {!!item.amount && (
                                                        <Text style={[styles.activityAmount, { color: colors.text }]}>
                                                            ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                        </Text>
                                                    )}
                                                    <Text style={[styles.activityTime, { color: colors.textSecondary }]}>
                                                        {dayjs(item.timestamp).format('HH:mm')}
                                                    </Text>
                                                </View>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            ))
                        ) : (
                            <View style={[styles.activityList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <View style={styles.emptyActivity}>
                                    <Ionicons name="list-outline" size={32} color={colors.textSecondary} style={{ opacity: 0.3, marginBottom: 8 }} />
                                    <Text style={{ color: colors.textSecondary }}>{i18n.t('dashboard.no_recent_activity')}</Text>
                                </View>
                            </View>
                        )}
                    </View> */}

                </ScrollView>
            </SafeAreaView>

            {/* Journal History Modal */}
            {/* <Modal
                visible={!!selectedJournal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setSelectedJournal(null)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>
                                {selectedJournal?.journal_name} - {i18n.t('dashboard.historical_payments')}
                            </Text>
                            <TouchableOpacity onPress={() => setSelectedJournal(null)} style={styles.closeButton}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>

                        {loadingHistory ? (
                            <View style={styles.modalLoading}>
                                <ActivityIndicator size="large" color={colors.primary} />
                            </View>
                        ) : journalHistoricalPayments.length === 0 ? (
                            <View style={styles.modalEmpty}>
                                <Text style={{ color: colors.textSecondary }}>{i18n.t('dashboard.no_history_found')}</Text>
                            </View>
                        ) : (
                            <ScrollView contentContainerStyle={styles.modalScroll}>
                                {journalHistoricalPayments.map((payment, idx) => (
                                    <View 
                                        key={idx} 
                                        style={[
                                            styles.historyItem, 
                                            { borderBottomColor: colors.border }
                                        ]}
                                    >
                                        <View style={styles.historyMain}>
                                            <View>
                                                <Text style={[styles.historyMethod, { color: colors.text }]}>
                                                    {payment.method_name}
                                                </Text>
                                                <Text style={[styles.historyDate, { color: colors.textSecondary }]}>
                                                    {dayjs(payment.date).format('DD/MM/YYYY HH:mm')}
                                                </Text>
                                            </View>
                                            <View style={styles.historyRight}>
                                                <Text style={[styles.historyAmount, { color: colors.primary }]}>
                                                    {i18n.t('common.currency_symbol')}{payment.amount.toLocaleString()}
                                                </Text>
                                                <View style={[
                                                    styles.statusBadge, 
                                                    { backgroundColor: payment.is_synced ? '#E8F5E9' : '#FFF3E0' }
                                                ]}>
                                                    <Text style={[
                                                        styles.statusBadgeText, 
                                                        { color: payment.is_synced ? '#2E7D32' : '#EF6C00' }
                                                    ]}>
                                                        {payment.is_synced ? i18n.t('orders.synced') : i18n.t('orders.offline')}
                                                    </Text>
                                                </View>
                                            </View>
                                        </View>
                                        {!!payment.reference && (
                                            <Text style={[styles.historyRef, { color: colors.textSecondary }]}>
                                                {payment.reference}
                                            </Text>
                                        )}
                                    </View>
                                ))}
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal> */}

            <CustomAlert
                visible={alertConfig.visible}
                title={alertConfig.title}
                message={alertConfig.message}
                confirmText={alertConfig.confirmText}
                cancelText={alertConfig.cancelText}
                onConfirm={alertConfig.onConfirm}
                onCancel={alertConfig.onCancel}
            />
        </>
    );
}

// Helpers for Activity Icons/Colors
const getActivityIcon = (type: string): any => {
    switch (type) {
        case 'visit': return 'walk-outline';
        case 'order': return 'cart-outline';
        case 'payment': return 'cash-outline';
        default: return 'ellipse-outline';
    }
};

const getActivityColor = (type: string, colors: any): string => {
    switch (type) {
        case 'visit': return colors.primary;
        case 'order': return '#10b981';
        case 'payment': return '#f59e0b';
        default: return colors.textSecondary;
    }
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingVertical: 15,
        borderBottomWidth: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    greeting: {
        fontSize: 14,
        marginBottom: 4,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    headerRight: {
        flexDirection: 'row',
        gap: 10,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        padding: 20,
        gap: 24,
    },
    statsContainer: {
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
    },
    statCard: {
        flex: 1,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        gap: 8,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    statIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
    },
    statIconBlue: { backgroundColor: '#3b82f620' },
    statIconGreen: { backgroundColor: '#10b98120' },
    statIconYellow: { backgroundColor: '#f59e0b20' },
    statLabel: {
        fontSize: 12,
        fontWeight: '500',
    },
    statValue: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    section: {
        gap: 12,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    routeCard: {
        padding: 16,
        borderRadius: 16,
        gap: 16,
    },
    routeHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    routeName: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 4,
    },
    routeStatus: {
        fontSize: 14,
    },
    progressBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    progressText: {
        fontSize: 12,
        fontWeight: '700',
    },
    progressBarBg: {
        height: 8,
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 4,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 12,
        gap: 8,
    },
    actionButtonText: {
        color: '#fff',
        fontWeight: '600',
        fontSize: 15,
    },
    emptyState: {
        padding: 30,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 16,
        borderWidth: 1,
        borderStyle: 'dashed',
        gap: 12,
    },
    journalCard: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    journalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    journalTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    journalName: {
        fontSize: 16,
        fontWeight: '700',
    },
    journalTotal: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    journalBalanceLabel: {
        fontSize: 12,
        marginTop: 2,
    },
    journalRight: {
        alignItems: 'flex-end',
    },
    todayLabel: {
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: '700',
    },
    todayValue: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    methodList: {
        gap: 0,
    },
    methodItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
    },
    methodName: {
        fontSize: 14,
    },
    methodAmount: {
        fontSize: 14,
        fontWeight: '600',
    },
    emptyStateText: {
        fontSize: 16,
        fontWeight: '500',
    },
    secondaryButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        marginTop: 8,
    },
    secondaryButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    rotating: {
        opacity: 0.5
    },
    unsyncedCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 10,
        borderRadius: 12,
        borderWidth: 1,
    },
    unsyncedInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    unsyncedTitle: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    unsyncedText: {
        fontSize: 12,
    },
    syncButton: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    syncButtonText: {
        color: '#fff',
        fontWeight: '600',
        fontSize: 12,
    },
    emptyActiveVisit: {
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    emptyActiveVisitText: {
        fontSize: 14,
    },
    customerCard: {
        borderRadius: 16,
        borderWidth: 1,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 16,
        paddingBottom: 12,
    },
    customerInfo: { flex: 1, marginRight: 8 },
    customerName: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
    customerAddress: { fontSize: 14 },
    timerBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    timerBadgeText: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    activityList: {
        borderRadius: 16,
        borderWidth: 1,
        overflow: 'hidden',
    },
    activityItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        gap: 12,
    },
    activityIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    activityContent: {
        flex: 1,
        gap: 2,
    },
    activityTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    activitySubtitle: {
        fontSize: 12,
    },
    activityRight: {
        alignItems: 'flex-end',
        gap: 2,
    },
    activityAmount: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    activityTime: {
        fontSize: 10,
    },
    dateHeader: {
        marginBottom: 8,
        paddingLeft: 4,
    },
    dateHeaderText: {
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    emptyActivity: {
        padding: 30,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        height: '80%',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 8,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        flex: 1,
    },
    closeButton: {
        padding: 4,
    },
    modalLoading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalEmpty: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    modalScroll: {
        paddingBottom: 40,
    },
    historyItem: {
        padding: 16,
        borderBottomWidth: 1,
    },
    historyMain: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    historyMethod: {
        fontSize: 14,
        fontWeight: '600',
    },
    historyDate: {
        fontSize: 12,
        marginTop: 2,
    },
    historyRight: {
        alignItems: 'flex-end',
    },
    historyAmount: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    historyRef: {
        fontSize: 12,
        marginTop: 4,
        fontStyle: 'italic',
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
        marginTop: 4,
    },
    statusBadgeText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
});
