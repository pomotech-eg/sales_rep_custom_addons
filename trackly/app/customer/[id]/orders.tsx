import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, SectionList, TouchableOpacity, Platform, StatusBar as RNStatusBar, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeStore } from '../../../store/useThemeStore';
import { useOfflineStore } from '../../../store/useOfflineStore';
import { getCustomerOrders } from '../../../services/database/repositories';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import i18n from '../../../i18n';
import BottomSheetModal from '../../../components/BottomSheetModal';

const STATUS_CONFIG: Record<string, { color: string; icon: string; labelKey: string }> = {
    draft: { color: '#94a3b8', icon: 'create-outline', labelKey: 'orders.draft' },
    sent: { color: '#60a5fa', icon: 'send-outline', labelKey: 'orders.sent' },
    sale: { color: '#34d399', icon: 'checkmark-circle-outline', labelKey: 'orders.sale' },
    done: { color: '#818cf8', icon: 'lock-closed-outline', labelKey: 'orders.done' },
    cancel: { color: '#f87171', icon: 'close-circle-outline', labelKey: 'orders.cancel' },
};

export default function OrderHistory() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { colors } = useThemeStore();
    const { currentRouteCustomers, isOffline } = useOfflineStore();
    const router = useRouter();

    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const customer = currentRouteCustomers.find(c => c.id.toString() === id);
    const partnerId = customer?.partner_id;

    const loadOrders = useCallback(async () => {
        if (!partnerId) return;
        try {
            const result = await getCustomerOrders(partnerId);

            // Sort: Offline orders (is_synced === 0) first, then by date descending
            const sortedOrders = [...result].sort((a: any, b: any) => {
                const aOffline = a.is_synced === 0 ? 1 : 0;
                const bOffline = b.is_synced === 0 ? 1 : 0;

                if (aOffline !== bOffline) {
                    return bOffline - aOffline;
                }

                const dateA = new Date(a.date || 0).getTime();
                const dateB = new Date(b.date || 0).getTime();
                return dateB - dateA;
            });

            setOrders(sortedOrders);
        } catch (err) {
            console.error('Failed to load orders:', err);
        } finally {
            setLoading(false);
        }
    }, [partnerId]);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    const onRefresh = async () => {
        setRefreshing(true);
        await loadOrders();
        setRefreshing(false);
    };

    const getStatusConfig = (state: string) => STATUS_CONFIG[state] || STATUS_CONFIG.draft;

    const formatCurrency = (amount: number | null) => {
        if (amount === null || amount === undefined) return '—';
        return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const renderOrderItem = ({ item }: { item: any }) => {
        const status = getStatusConfig(item.state);
        const isUnsynced = item.is_synced === 0;

        return (
            <TouchableOpacity
                style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push({
                    pathname: `/customer/${id}/order-details` as any,
                    params: { orderId: item.local_id || item.odoo_id, orderType: item.local_id ? 'local' : 'odoo' }
                })}
                activeOpacity={0.7}
            >
                <View style={styles.orderHeader}>
                    <View style={styles.orderTitleRow}>
                        <Text style={[styles.orderName, { color: colors.text }]}>
                            {item.name || `Draft #${item.local_id?.slice(-6) || item.id}`}
                        </Text>
                        {isUnsynced && (
                            <View style={[styles.syncBadge, { backgroundColor: '#f59e0b20' }]}>
                                <Ionicons name="cloud-offline-outline" size={12} color="#f59e0b" />
                                <Text style={[styles.syncBadgeText, { color: '#f59e0b' }]}>Offline</Text>
                            </View>
                        )}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
                        <Ionicons name={status.icon as any} size={14} color={status.color} />
                        <Text style={[styles.statusText, { color: status.color }]}>{i18n.t(status.labelKey)}</Text>
                    </View>
                </View>

                <View style={styles.orderDetails}>
                    <View style={styles.detailItem}>
                        <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                            {item.date ? dayjs(item.date).format('MMM D, YYYY') : '—'}
                        </Text>
                    </View>
                    <View style={styles.detailItem}>
                        <Ionicons name="cash-outline" size={14} color={colors.textSecondary} />
                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                            {formatCurrency(item.amount_total)}
                        </Text>
                    </View>
                </View>

                {/* Invoice, Delivery & Payment Status Row */}
                {(item.invoice_status || item.delivery_status || item.payment_state) && (
                    <View style={styles.statusRow}>
                        {item.invoice_status && (
                            <View style={[styles.miniTag, { backgroundColor: item.invoice_status === 'invoiced' ? '#34d39920' : '#94a3b820' }]}>
                                <Ionicons name="receipt-outline" size={11} color={item.invoice_status === 'invoiced' ? '#34d399' : '#94a3b8'} />
                                <Text style={{ fontSize: 10, color: item.invoice_status === 'invoiced' ? '#34d399' : '#94a3b8', marginLeft: 3 }}>
                                    {item.invoice_status}
                                </Text>
                            </View>
                        )}
                        {item.delivery_status && (
                            <View style={[styles.miniTag, { backgroundColor: item.delivery_status === 'full' ? '#34d39920' : item.delivery_status === 'returned' ? '#10b98120' : '#60a5fa20' }]}>
                                <Ionicons name="cube-outline" size={11} color={item.delivery_status === 'full' ? '#34d399' : item.delivery_status === 'returned' ? '#10b981' : '#60a5fa'} />
                                <Text style={{ fontSize: 10, color: item.delivery_status === 'full' ? '#34d399' : item.delivery_status === 'returned' ? '#10b981' : '#60a5fa', marginLeft: 3 }}>
                                    {item.delivery_status === 'full' ? i18n.t('orders.delivered') : item.delivery_status === 'returned' ? i18n.t('order.returned_prefix') : item.delivery_status}
                                </Text>
                            </View>
                        )}
                        {item.payment_state && (
                            <View style={[
                                styles.miniTag, 
                                { backgroundColor: item.payment_state === 'paid' ? '#10b98120' : item.payment_state === 'partial' ? '#f59e0b20' : '#10b98120' }
                            ]}>
                                <Ionicons 
                                    name={item.payment_state === 'paid' ? "card-outline" : "hourglass-outline"} 
                                    size={11} 
                                    color={item.payment_state === 'paid' ? '#10b981' : item.payment_state === 'partial' ? '#f59e0b' : '#10b981'} 
                                />
                                <Text style={{ 
                                    fontSize: 10, 
                                    color: item.payment_state === 'paid' ? '#10b981' : item.payment_state === 'partial' ? '#f59e0b' : '#10b981', 
                                    marginLeft: 3 
                                }}>
                                    {i18n.t(`orders.${item.payment_state}`) || item.payment_state}
                                </Text>
                            </View>
                        )}
                    </View>
                )}

                <View style={styles.orderFooter}>
                    <Text style={[styles.amountLabel, { color: colors.text }]}>Total</Text>
                    <Text style={[styles.amountValue, { color: colors.primary }]}>
                        {formatCurrency(item.amount_total)}
                    </Text>
                </View>
            </TouchableOpacity>
        );
    };

    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [paymentFilter, setPaymentFilter] = useState('all');
    const [syncFilter, setSyncFilter] = useState('all');
    const [filteredOrders, setFilteredOrders] = useState<any[]>([]);
    const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);

    useEffect(() => {
        let result = orders;

        // Apply Status Filter
        if (statusFilter !== 'all') {
            result = result.filter(order => order.state === statusFilter);
        }

        // Apply Payment Status Filter
        if (paymentFilter !== 'all') {
            result = result.filter(order => order.payment_state === paymentFilter);
        }

        // Apply Sync Status Filter
        if (syncFilter !== 'all') {
            if (syncFilter === 'synced') {
                result = result.filter(order => order.is_synced !== 0);
            } else if (syncFilter === 'offline') {
                result = result.filter(order => order.is_synced === 0);
            }
        }

        // Apply Search Filter
        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            result = result.filter(order =>
                (order.name && order.name.toLowerCase().includes(query)) ||
                (order.local_id && order.local_id.toLowerCase().includes(query)) ||
                (order.odoo_id && order.odoo_id.toString().includes(query)) ||
                (order.amount_total && order.amount_total.toString().includes(query))
            );
        }

        setFilteredOrders(result);
    }, [searchQuery, statusFilter, paymentFilter, syncFilter, orders]);

    const handleSearch = (text: string) => {
        setSearchQuery(text);
    };

    const clearAllFilters = () => {
        setStatusFilter('all');
        setPaymentFilter('all');
        setSyncFilter('all');
    };

    const activeFilterCount = (statusFilter !== 'all' ? 1 : 0) + 
                             (paymentFilter !== 'all' ? 1 : 0) + 
                             (syncFilter !== 'all' ? 1 : 0);

    // ... (rest of the component)

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                {/* ... (existing header content) ... */}
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>
                        {i18n.t('orders.history_title')}
                    </Text>
                </View>
            </View>

            <View style={[styles.searchContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <View style={[styles.searchSubContainer, { backgroundColor: colors.background }]}>
                    <Ionicons name="search" size={18} color={colors.textSecondary} />
                    <TextInput
                        style={[styles.searchInput, { color: colors.text }]}
                        placeholder={i18n.t('orders.search_placeholder')}
                        placeholderTextColor={colors.textSecondary}
                        value={searchQuery}
                        onChangeText={handleSearch}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                    )}
                </View>
                <TouchableOpacity 
                    style={[
                        styles.filterButton, 
                        { backgroundColor: colors.background, borderColor: colors.border },
                        activeFilterCount > 0 && { borderColor: colors.primary, backgroundColor: colors.primary + '10' }
                    ]}
                    onPress={() => setIsFilterModalVisible(true)}
                >
                    <Ionicons 
                        name={activeFilterCount > 0 ? "filter" : "filter-outline"} 
                        size={20} 
                        color={activeFilterCount > 0 ? colors.primary : colors.text} 
                    />
                    {activeFilterCount > 0 && (
                        <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                            <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>

            {/* Summary Bar */}
            <View style={[styles.summaryBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <View style={styles.summaryItem}>
                    <Text style={[styles.summaryValue, { color: colors.primary }]}>{orders.length}</Text>
                    <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                        {i18n.t('orders.total_orders')}
                    </Text>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
                <View style={styles.summaryItem}>
                    <Text style={[styles.summaryValue, { color: '#34d399' }]}>
                        {orders.filter(o => o.state === 'sale' || o.state === 'done').length}
                    </Text>
                    <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                        {i18n.t('orders.confirmed')}
                    </Text>
                </View>
                <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
                <View style={styles.summaryItem}>
                    <Text style={[styles.summaryValue, { color: '#f59e0b' }]}>
                        {orders.filter(o => o.is_synced === 0).length}
                    </Text>
                    <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                        {i18n.t('orders.pending_sync')}
                    </Text>
                </View>
            </View>

            {/* Offline Banner */}
            {isOffline && (
                <View style={[styles.offlineBanner, { backgroundColor: '#f59e0b15' }]}>
                    <Ionicons name="cloud-offline-outline" size={16} color="#f59e0b" />
                    <Text style={{ color: '#f59e0b', fontSize: 12, marginLeft: 6 }}>
                        {i18n.t('orders.offline_notice')}
                    </Text>
                </View>
            )}

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : orders.length === 0 ? (
                <View style={styles.centered}>
                    <Ionicons name="document-text-outline" size={64} color={colors.textSecondary} />
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                        {i18n.t('orders.no_orders')}
                    </Text>
                </View>
            ) : (
                <SectionList
                    sections={[
                        { title: i18n.t('orders.offline_orders') || 'Offline Orders', data: filteredOrders.filter(o => o.is_synced === 0) },
                        { title: i18n.t('orders.sales_orders') || 'Sales Orders', data: filteredOrders.filter(o => o.is_synced !== 0) },
                    ].filter(section => section.data.length > 0)}
                    renderItem={renderOrderItem}
                    renderSectionHeader={({ section: { title } }) => (
                        <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                            <Text style={[styles.sectionHeaderText, { color: colors.textSecondary }]}>{title}</Text>
                        </View>
                    )}
                    keyExtractor={(item) => item.local_id || item.odoo_id?.toString() || item.id?.toString()}
                    contentContainerStyle={styles.list}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.primary}
                        />
                    }
                />
            )}

            <BottomSheetModal
                visible={isFilterModalVisible}
                onClose={() => setIsFilterModalVisible(false)}
                title={i18n.t('orders.filters_title')}
            >
                <View style={styles.modalContent}>
                    {/* Order Status Section */}
                    <Text style={[styles.filterSectionTitle, { color: colors.textSecondary }]}>
                        {i18n.t('orders.order_status')}
                    </Text>
                    <View style={styles.chipContainer}>
                        {['all', 'draft', 'sent', 'sale', 'cancel'].map((status) => (
                            <TouchableOpacity
                                key={status}
                                style={[
                                    styles.chip,
                                    { borderColor: colors.border },
                                    statusFilter === status && { backgroundColor: colors.primary + '15', borderColor: colors.primary }
                                ]}
                                onPress={() => setStatusFilter(status)}
                            >
                                <Text style={[
                                    styles.chipText,
                                    { color: colors.text },
                                    statusFilter === status && { color: colors.primary, fontWeight: 'bold' }
                                ]}>
                                    {status === 'all' ? i18n.t('orders.filter_all') : i18n.t(STATUS_CONFIG[status]?.labelKey)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Payment Status Section */}
                    <Text style={[styles.filterSectionTitle, { color: colors.textSecondary, marginTop: 20 }]}>
                        {i18n.t('orders.payment_status')}
                    </Text>
                    <View style={styles.chipContainer}>
                        {[
                            { id: 'all', label: i18n.t('orders.filter_all') },
                            { id: 'paid', label: i18n.t('orders.paid') },
                            { id: 'not_paid', label: i18n.t('orders.not_paid') },
                            { id: 'partial', label: i18n.t('orders.partial') },
                        ].map((item) => (
                            <TouchableOpacity
                                key={item.id}
                                style={[
                                    styles.chip,
                                    { borderColor: colors.border },
                                    paymentFilter === item.id && { backgroundColor: colors.primary + '15', borderColor: colors.primary }
                                ]}
                                onPress={() => setPaymentFilter(item.id)}
                            >
                                <Text style={[
                                    styles.chipText,
                                    { color: colors.text },
                                    paymentFilter === item.id && { color: colors.primary, fontWeight: 'bold' }
                                ]}>
                                    {item.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Sync Status Section */}
                    <Text style={[styles.filterSectionTitle, { color: colors.textSecondary, marginTop: 20 }]}>
                        {i18n.t('orders.sync_status')}
                    </Text>
                    <View style={styles.chipContainer}>
                        {[
                            { id: 'all', label: i18n.t('orders.filter_all') },
                            { id: 'synced', label: i18n.t('orders.synced') },
                            { id: 'offline', label: i18n.t('orders.offline') },
                        ].map((item) => (
                            <TouchableOpacity
                                key={item.id}
                                style={[
                                    styles.chip,
                                    { borderColor: colors.border },
                                    syncFilter === item.id && { backgroundColor: colors.primary + '15', borderColor: colors.primary }
                                ]}
                                onPress={() => setSyncFilter(item.id)}
                            >
                                <Text style={[
                                    styles.chipText,
                                    { color: colors.text },
                                    syncFilter === item.id && { color: colors.primary, fontWeight: 'bold' }
                                ]}>
                                    {item.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <View style={styles.modalFooter}>
                        <TouchableOpacity 
                            style={[styles.clearBtn, { borderColor: colors.border }]}
                            onPress={clearAllFilters}
                        >
                            <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>
                                {i18n.t('orders.clear_filters')}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                            style={[styles.applyBtn, { backgroundColor: colors.primary }]}
                            onPress={() => setIsFilterModalVisible(false)}
                        >
                            <Text style={styles.applyBtnText}>{i18n.t('orders.apply_filters')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </BottomSheetModal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    backBtn: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    summaryBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    summaryItem: {
        alignItems: 'center',
    },
    summaryValue: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    summaryLabel: {
        fontSize: 11,
        marginTop: 2,
    },
    summaryDivider: {
        width: 1,
        height: 30,
    },
    offlineBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
    },
    list: {
        padding: 16,
        gap: 12,
    },
    sectionHeader: {
        paddingVertical: 8,
        paddingHorizontal: 4,
        marginTop: 10,
        marginBottom: 4,
        backgroundColor: 'transparent',
    },
    sectionHeaderText: {
        fontSize: 14,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    orderCard: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 16,
    },
    orderHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    orderTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    orderName: {
        fontSize: 16,
        fontWeight: '600',
    },
    syncBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    syncBadgeText: {
        fontSize: 10,
        fontWeight: '600',
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '600',
    },
    orderDetails: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 8,
    },
    detailItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    detailText: {
        fontSize: 12,
    },
    statusRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 10,
    },
    miniTag: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 6,
    },
    orderFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: 'rgba(150,150,150,0.1)',
        paddingTop: 10,
    },
    amountLabel: {
        fontSize: 14,
        fontWeight: '500',
    },
    amountValue: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
    },
    emptyText: {
        fontSize: 16,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: 1,
    },
    searchSubContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        height: 44,
        borderRadius: 12,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        paddingVertical: 8,
    },
    filterButton: {
        width: 44,
        height: 44,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    filterBadge: {
        position: 'absolute',
        top: -4,
        right: -4,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: '#fff',
    },
    filterBadgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
    },
    modalContent: {
        paddingTop: 10,
    },
    filterSectionTitle: {
        fontSize: 13,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 12,
    },
    chipContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
    },
    chipText: {
        fontSize: 14,
    },
    modalFooter: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 32,
        paddingBottom: 10,
    },
    applyBtn: {
        flex: 2,
        height: 52,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    applyBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    clearBtn: {
        flex: 1,
        height: 52,
        borderRadius: 14,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    clearBtnText: {
        fontSize: 14,
        fontWeight: '600',
    },
});
