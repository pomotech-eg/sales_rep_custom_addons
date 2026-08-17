import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { executeQuery } from '../../services/database';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Toast, ToastType } from '@/components/Toast';
import dayjs from 'dayjs';

import { getRecentSyncLogs } from '@/services/database/repositories';
import { clearSession } from '@/services/database';
import i18n from '@/i18n';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';

const TABLES = [
    'session',
    'sales_representative',
    'sales_rep_route',
    'sales_route_customer',
    'product_product',
    'uom_uom',
    'uom_category',
    'sales_rep_visit',
    'sales_order',
    'sales_order_line',
    'traccar_device',
    'location',
    'pending_action',
    'payment_journal',
    'pricelist',
    'payment_term',
    'res_partner',
    'loyalty_program',
    'sales_rep_collection',
    'sync_log',
    'product_stock',
];

export default function DatabaseScreen() {
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const { colors } = useThemeStore();
    const { isOffline, lastSyncTime, unsyncedCounts, performSync, isSyncing, fetchUnsyncedCounts, checkConnection } = useOfflineStore();
    const [selectedTable, setSelectedTable] = useState<string | null>('sales_representative'); // Default to pending actions
    const [tableData, setTableData] = useState<any[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [toastType, setToastType] = useState<ToastType>('info');
    const [recentLogs, setRecentLogs] = useState<any[]>([]); // Added

    useEffect(() => {
        fetchUnsyncedCounts();
        checkConnection();
        fetchRecentLogs(); // Added
    }, []);

    useEffect(() => {
        if (selectedTable) {
            fetchTableData(selectedTable);
        }
        if (!isSyncing) {
            fetchRecentLogs(); // Refresh logs when sync finishes
        }
    }, [selectedTable, isSyncing]); // Refresh when sync status changes

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

    const handleHardReset = () => {
        Alert.alert(
            i18n.t('database.hard_reset_title'),
            i18n.t('database.hard_reset_msg'),
            [
                { text: i18n.t('common.cancel'), style: "cancel" },
                {
                    text: i18n.t('database.reset'),
                    style: "destructive",
                    onPress: async () => {
                        await clearSession(true);
                        showToast(i18n.t('database.reset_complete'), "success");
                        fetchTableData(selectedTable || 'pending_action');
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ padding: 16, paddingRight: 8 }}>
                        <Ionicons name="menu-outline" size={28} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 0 }]}>{i18n.t('database.title')}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity 
                        onPress={handleSync} 
                        style={{ backgroundColor: colors.primary, padding: 6, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                        disabled={isSyncing}
                    >
                        <Ionicons name="sync" size={12} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>
                            {isSyncing ? i18n.t('common.syncing') : i18n.t('common.sync')}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleHardReset} style={{ backgroundColor: '#ff4444', padding: 6, borderRadius: 4 }}>
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{i18n.t('database.hard_reset')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableSelector}>
                {TABLES.map((table) => (
                    <TouchableOpacity
                        key={table}
                        style={[
                            styles.tableButton,
                            {
                                backgroundColor: selectedTable === table ? colors.primary : colors.card,
                                borderColor: colors.border
                            }
                        ]}
                        onPress={() => setSelectedTable(table)}
                    >
                        <Text style={{
                            color: selectedTable === table ? '#fff' : colors.text,
                            fontWeight: selectedTable === table ? 'bold' : 'normal'
                        }}>
                            {table}
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
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
            {renderHeader()}

            <View style={styles.contentContainer}>
                <View style={[styles.tableHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                    <Text style={[styles.tableTitle, { color: colors.text }]}>
                        {selectedTable ? `${selectedTable} (${tableData.length})` : i18n.t('database.select_table')}
                    </Text>
                    {selectedTable && (
                        <TouchableOpacity onPress={() => fetchTableData(selectedTable)}>
                            <Ionicons name="refresh" size={20} color={colors.primary} />
                        </TouchableOpacity>
                    )}
                </View>

                {selectedTable ? (
                    <FlatList
                        data={tableData}
                        renderItem={renderRow}
                        keyExtractor={(_, index) => index.toString()}
                        contentContainerStyle={styles.listContent}
                        refreshControl={
                            <RefreshControl refreshing={refreshing} onRefresh={() => fetchTableData(selectedTable)} />
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <Text style={{ color: colors.textSecondary }}>{i18n.t('database.no_data')}</Text>
                            </View>
                        }
                    />
                ) : (
                    <View style={styles.emptyContainer}>
                        <Text style={{ color: colors.textSecondary }}>{i18n.t('database.select_table_msg')}</Text>
                    </View>
                )}
            </View>
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
    }
});
