import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { executeQuery } from '../../services/database';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Toast, ToastType } from '@/components/Toast';
import dayjs from 'dayjs';

import { getRecentSyncLogs, getPendingCollections, getPendingSalesOrders, getPendingVisits, getPendingActions, deleteCollection, deleteSalesOrder, deleteVisit, deletePendingAction } from '@/services/database/repositories';
import i18n from '@/i18n';
import { sseService, SSEStatus } from '../../services/sseService';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';

export default function DatabaseScreen() {
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const { colors } = useThemeStore();
    const { isOffline, lastSyncTime, unsyncedCounts, performSync, isSyncing, fetchUnsyncedCounts, checkConnection } = useOfflineStore();
    const [selectedTable, setSelectedTable] = useState<string | null>('pending_action'); // Default to pending actions
    const [tableData, setTableData] = useState<any[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [toastType, setToastType] = useState<ToastType>('info');
    const [recentLogs, setRecentLogs] = useState<any[]>([]);
    const [sseStatus, setSseStatus] = useState<SSEStatus>(sseService.status);
    const [pendingItems, setPendingItems] = useState<any[]>([]);
    const [pendingType, setPendingType] = useState<'collections' | 'orders' | 'visits' | 'actions' | 'locations'>('actions');

    useEffect(() => {
        fetchUnsyncedCounts();
        checkConnection();
        fetchRecentLogs();
        // Poll SSE status every 3 seconds for UI
        const sseInterval = setInterval(() => {
            setSseStatus(sseService.status);
        }, 3000);
        return () => clearInterval(sseInterval);
    }, []);

    useEffect(() => {
        if (selectedTable) {
            fetchTableData(selectedTable);
        }
        if (!isSyncing) {
            fetchRecentLogs(); // Refresh logs when sync finishes
            fetchPendingItems(); // Refresh pending items
            fetchUnsyncedCounts(); // Refresh counts
        }
    }, [selectedTable, isSyncing, pendingType]); // Refresh when sync status or category changes

    const fetchRecentLogs = async () => {
        try {
            const logs = await getRecentSyncLogs(3); // Get last 3 logs
            setRecentLogs(logs);
        } catch (error) {
            console.error('Error fetching recent logs:', error);
        }
    };

    const showToast = (message: string, type: ToastType = 'info') => {
        setToastMessage(message);
        setToastType(type);
    };

    const fetchTableData = async (tableName: string) => {
        setRefreshing(true);
        try {
            const result = await executeQuery(`SELECT * FROM ${tableName} ORDER BY rowid DESC LIMIT 50`); // Added limit and order
            if (result && result.length > 0) {
                setTableData(result);
                // Extract columns from first row
                setColumns(Object.keys(result[0] as object));
            } else {
                setTableData([]);
                setColumns([]);
            }
        } catch (error) {
            console.error('Error fetching table data:', error);
            showToast(i18n.t('database.fetch_error'), 'error');
        } finally {
            setRefreshing(false);
        }
    };

    const fetchPendingItems = async () => {
        try {
            let items: any[] = [];
            switch (pendingType) {
                case 'collections': items = await getPendingCollections(); break;
                case 'orders': items = await getPendingSalesOrders(); break;
                case 'visits': items = await getPendingVisits(); break;
                case 'actions': items = await getPendingActions(); break;
            }
            setPendingItems(items);
        } catch (error) {
            console.error('Error fetching pending items:', error);
        }
    };

    const handleDelete = async (localId: string) => {
        Alert.alert(
            i18n.t('common.warning'),
            "Are you sure you want to delete this pending item? This action cannot be undone and the data will NOT be synced.",
            [
                { text: i18n.t('common.cancel'), style: 'cancel' },
                {
                    text: i18n.t('common.remove'),
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            switch (pendingType) {
                                case 'collections': await deleteCollection(localId); break;
                                case 'orders': await deleteSalesOrder(localId); break;
                                case 'visits': await deleteVisit(localId); break;
                                case 'actions': await deletePendingAction(localId); break;
                            }
                            showToast(i18n.t('common.success'), 'success');
                            fetchPendingItems();
                            fetchUnsyncedCounts();
                        } catch (error) {
                            console.error('Error deleting pending item:', error);
                            showToast(i18n.t('common.error'), 'error');
                        }
                    }
                }
            ]
        );
    };

    const handleSync = async () => {
        if (isOffline) {
            showToast(i18n.t('common.offline_sync_error'), 'info');
            return;
        }
        await performSync();
        fetchTableData(selectedTable || 'pending_action');
    };

    const renderHeader = () => (
        <View style={[styles.headerContainer, { borderBottomColor: colors.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ padding: 16, paddingRight: 0, marginRight: 12 }}>
                    <Ionicons name="menu-outline" size={28} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text, paddingLeft: 0 }]}>{i18n.t('system.title')}</Text>
            </View>

            {/* Connection Status Card */}
            <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.statusRow}>
                    <View style={styles.statusItem}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>{i18n.t('system.connection')}</Text>
                        <View style={styles.valueContainer}>
                            <Ionicons name={isOffline ? "cloud-offline" : "cloud"} size={16} color={isOffline ? colors.danger : colors.success} />
                            <Text style={[styles.value, { color: isOffline ? colors.danger : colors.success }]}>
                                {isOffline ? i18n.t('system.offline') : i18n.t('system.online')}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.statusItem}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>{i18n.t('system.last_sync')}</Text>
                        <Text style={[styles.value, { color: colors.text }]}>
                            {lastSyncTime ? dayjs(lastSyncTime).format('HH:mm:ss') : i18n.t('system.never')}
                        </Text>
                    </View>
                </View>

                {/* SSE Status */}
                <View style={[styles.statusRow, { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <View style={styles.statusItem}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>{i18n.t('system.sse')}</Text>
                        <View style={styles.valueContainer}>
                            <Ionicons
                                name={sseStatus === 'connected' ? 'radio' : 'radio-outline'}
                                size={16}
                                color={sseStatus === 'connected' ? colors.success : sseStatus === 'connecting' ? '#2196F3' : sseStatus === 'offline' ? colors.danger : colors.textSecondary}
                            />
                            <Text style={[styles.value, {
                                color: sseStatus === 'connected' ? colors.success : sseStatus === 'connecting' ? '#2196F3' : sseStatus === 'offline' ? colors.danger : colors.textSecondary,
                                textTransform: 'capitalize'
                            }]}>
                                {sseStatus}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.statusItem}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>{i18n.t('system.sync_mode')}</Text>
                        <Text style={[styles.value, { color: sseStatus === 'connected' ? colors.success : colors.textSecondary }]}>
                            {sseStatus === 'connected' ? i18n.t('system.real_time') : i18n.t('system.polling')}
                        </Text>
                    </View>
                </View>

                {/* Queue Stats */}
                <View style={[styles.statusRow, { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <View style={styles.statusItem}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>{i18n.t('system.pending_actions')}</Text>
                        <Text style={[styles.value, { color: unsyncedCounts.actions > 0 ? colors.danger : colors.text }]}>
                            {unsyncedCounts.actions}
                        </Text>
                    </View>
                    <View style={styles.statusItem}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>{i18n.t('system.pending_orders')}</Text>
                        <Text style={[styles.value, { color: unsyncedCounts.orders > 0 ? colors.danger : colors.text }]}>
                            {unsyncedCounts.orders}
                        </Text>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.syncButton, { backgroundColor: isSyncing ? colors.border : colors.primary }]}
                    onPress={handleSync}
                    disabled={isSyncing || isOffline}
                >
                    <Text style={styles.syncButtonText}>{isSyncing ? i18n.t('common.syncing') : i18n.t('common.sync_now')}</Text>
                    <Ionicons name="refresh" size={16} color="#fff" style={{ marginLeft: 8 }} />
                </TouchableOpacity>
            </View>

            {/* Sync History Card */}
            <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 0, marginBottom: 12, marginTop: 0 }]}>{i18n.t('system.recent_syncs')}</Text>
                {recentLogs.length > 0 ? (
                    recentLogs.map((log, index) => (
                        <View key={log.id} style={[styles.logRow, { borderBottomWidth: index === recentLogs.length - 1 ? 0 : 1, borderBottomColor: colors.border }]}>
                            <View style={styles.logInfo}>
                                <Text style={[styles.logTime, { color: colors.text }]}>
                                    {dayjs(log.started_at).format('HH:mm:ss')}
                                </Text>
                                <Text style={[styles.logDate, { color: colors.textSecondary }]}>
                                    {dayjs(log.started_at).format('MMM DD')}
                                </Text>
                            </View>

                            <View style={styles.logStatus}>
                                <View style={[styles.statusBadge, {
                                    backgroundColor: log.status === 'success' ? '#4CAF5020' : log.status === 'running' ? '#2196F320' : '#F4433620'
                                }]}>
                                    <Text style={[styles.statusText, {
                                        color: log.status === 'success' ? '#4CAF50' : log.status === 'running' ? '#2196F3' : '#F44336'
                                    }]}>
                                        {log.status === 'running' ? i18n.t('common.syncing').toUpperCase() : log.status?.toUpperCase()}
                                    </Text>
                                </View>
                                {log.error_message && (
                                    <Text style={[styles.logError, { color: colors.danger }]} numberOfLines={1}>
                                        {log.error_message}
                                    </Text>
                                )}
                            </View>
                        </View>
                    ))
                ) : (
                    <Text style={{ color: colors.textSecondary, fontStyle: 'italic', padding: 8 }}>{i18n.t('system.no_history')}</Text>
                )}
            </View>

            {/* Pending Items Management */}
            {/*<View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 0, marginBottom: 12, marginTop: 0 }]}>
                    Management: Pending Syncs
                </Text>

                <View style={styles.typeSelector}>
                    {(['actions', 'collections', 'orders', 'visits'] as const).map((type) => (
                        <TouchableOpacity
                            key={type}
                            onPress={() => setPendingType(type)}
                            style={[
                                styles.typeButton,
                                { backgroundColor: pendingType === type ? colors.primary : colors.background, borderColor: colors.border }
                            ]}
                        >
                            <Text style={[styles.typeButtonText, { color: pendingType === type ? '#fff' : colors.textSecondary }]}>
                                {type.charAt(0).toUpperCase() + type.slice(1)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {pendingItems.length > 0 ? (
                    pendingItems.map((item, index) => (
                        <View
                            key={item.local_id}
                            style={[
                                styles.pendingItemRow,
                                { borderBottomWidth: index === pendingItems.length - 1 ? 0 : 1, borderBottomColor: colors.border }
                            ]}
                        >
                            <View style={styles.pendingItemInfo}>
                                <Text style={[styles.pendingItemTitle, { color: colors.text }]}>
                                    {pendingType === 'actions' ? item.action_type :
                                     pendingType === 'collections' ? `Amount: ${item.amount}` :
                                     pendingType === 'orders' ? `Total: ${item.amount_total}` :
                                     `Visit: ${item.state}`}
                                </Text>
                                <Text style={[styles.pendingItemDesc, { color: colors.textSecondary }]}>
                                    ID: {item.local_id.substring(0, 15)}...
                                </Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => handleDelete(item.local_id)}
                                style={styles.deleteButton}
                            >
                                <Ionicons name="trash-outline" size={20} color={colors.danger} />
                            </TouchableOpacity>
                        </View>
                    ))
                ) : (
                    <Text style={{ color: colors.textSecondary, fontStyle: 'italic', padding: 8 }}>
                        No pending {pendingType}
                    </Text>
                )}
            </View>*/}
        </View >
    );

    const renderRow = ({ item, index }: { item: any, index: number }) => (
        <View style={[styles.row, { borderBottomColor: colors.border }]}>
            {columns.map((col) => (
                <View key={col} style={styles.cell}>
                    <Text style={[styles.cellLabel, { color: colors.textSecondary }]}>{col}:</Text>
                    <Text style={[styles.cellValue, { color: colors.text }]}>
                        {item[col] !== null ? String(item[col]) : 'NULL'}
                    </Text>
                </View>
            ))}
        </View>
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => {
                            fetchUnsyncedCounts();
                            fetchRecentLogs();
                            fetchPendingItems();
                            if (selectedTable) fetchTableData(selectedTable);
                        }}
                        tintColor={colors.primary}
                    />
                }
            >
                {renderHeader()}
            </ScrollView>
            {
                toastMessage && (
                    <Toast
                        message={toastMessage!}
                        type={toastType}
                        onDismiss={() => setToastMessage(null)}
                    />
                )
            }
        </SafeAreaView >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    headerContainer: {
        paddingBottom: 8,
        borderBottomWidth: 1,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        padding: 16,
        paddingBottom: 8,
    },
    statusCard: {
        margin: 16,
        marginTop: 0,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    statusRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    statusItem: {
        flex: 1,
    },
    label: {
        fontSize: 12,
        marginBottom: 4,
    },
    valueContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6
    },
    value: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    syncButton: {
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderRadius: 8,
    },
    syncButtonText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginLeft: 16,
        marginBottom: 8,
        marginTop: 8,
    },
    tableSelector: {
        paddingHorizontal: 16,
        marginBottom: 8,
        height: 50,
    },
    tableButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        marginRight: 8,
        borderWidth: 1,
        height: 36,
        justifyContent: 'center',
    },
    contentContainer: {
        flex: 1,
    },
    tableHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
    },
    tableTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    listContent: {
        padding: 16,
    },
    row: {
        marginBottom: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
    },
    cell: {
        flexDirection: 'row',
        marginBottom: 4,
        flexWrap: 'wrap',
    },
    cellLabel: {
        fontWeight: 'bold',
        marginRight: 8,
        width: 120, // Increased width for better alignment
        fontSize: 12,
    },
    cellValue: {
        flex: 1,
        fontSize: 12,
        fontFamily: 'monospace', // Better for IDs and data
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 50,
    },
    // New Styles
    logRow: {
        flexDirection: 'row',
        paddingVertical: 12,
        alignItems: 'center',
    },
    logInfo: {
        width: 80,
    },
    logTime: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    logDate: {
        fontSize: 10,
    },
    logStatus: {
        flex: 1,
        justifyContent: 'center',
    },
    statusBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        marginBottom: 2,
    },
    statusText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    logError: {
        fontSize: 10,
        marginTop: 2,
    },
    // New Styles
    typeSelector: {
        flexDirection: 'row',
        marginBottom: 16,
        gap: 8,
        flexWrap: 'wrap',
    },
    typeButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
    },
    typeButtonText: {
        fontSize: 12,
        fontWeight: '600',
    },
    pendingItemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
    },
    pendingItemInfo: {
        flex: 1,
    },
    pendingItemTitle: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    pendingItemDesc: {
        fontSize: 12,
    },
    deleteButton: {
        padding: 8,
    }
});
