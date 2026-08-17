import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
    ActivityIndicator, RefreshControl, Image, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { executeQuery, getDB } from '../../services/database';
import { useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import i18n from '../../i18n';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Dropdown } from '../../components/CustomDropdown';
import * as stockService from '../../services/api/stockService';

type SortField = 'name' | 'free_qty' | 'default_code';
type SortDir = 'asc' | 'desc';

export default function StorageScreen() {
    const { colors } = useThemeStore();
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const { salesRepProfile, isSyncing, performSync, isOffline, lastSyncTime } = useOfflineStore();

    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortField, setSortField] = useState<SortField>('name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [filter, setFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
    const [selectedLocationId, setSelectedLocationId] = useState<string>('');
    const [locationsList, setLocationsList] = useState<any[]>([]);
    const isFetchingRef = React.useRef(false);

    const [previewImage, setPreviewImage] = useState<string | null>(null);

    const getImageUrl = (url: string) => {
        if (!url) return undefined;
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
        try {
            const { useAuthStore } = require('../../store/useAuthStore');
            const serverUrl = useAuthStore.getState().serverUrl || '';
            const base = serverUrl.replace(/\/+$/, '');
            return `${base}${url}`;
        } catch (e) {
            return url;
        }
    };

    const openImagePreview = (url: string) => {
        const resolved = getImageUrl(url);
        if (resolved) {
            setPreviewImage(resolved);
        }
    };

    const loadProducts = useCallback(async (locId?: string) => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        try {
            const { getProducts } = require('../../services/database/repositories');
            const activeLocId = locId || selectedLocationId;
            const parsedLocId = activeLocId ? parseInt(activeLocId) : undefined;
            const data = await getProducts(true, parsedLocId);

            if (!isOffline && activeLocId) {
                // Reset quantities to 0 initially so we don't display cached offline values while loading
                const initialOnlineData = data.map((p: any) => ({
                    ...p,
                    free_qty: 0
                }));
                setProducts(initialOnlineData);

                try {
                    const quantsRes = await stockService.getQuants([], [parseInt(activeLocId)]);
                    if (quantsRes.data?.success && Array.isArray(quantsRes.data.quants)) {
                        const quantsMap = new Map<number, number>();
                        quantsRes.data.quants.forEach((q: any) => {
                            const pid = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
                            const qty = (q.quantity || 0) - (q.reserved_quantity || 0);
                            quantsMap.set(pid, (quantsMap.get(pid) || 0) + qty);
                        });

                        const updated = data.map((p: any) => ({
                            ...p,
                            free_qty: quantsMap.has(p.odoo_id) ? quantsMap.get(p.odoo_id) : 0
                        }));
                        setProducts(updated);

                        // Async/background cache to SQLite database
                        const localDb = await getDB();
                        await localDb.withTransactionAsync(async () => {
                            for (const p of updated) {
                                const row: any = await localDb.getFirstAsync(
                                    'SELECT free_qtys FROM product_product WHERE odoo_id = ?',
                                    p.odoo_id
                                );
                                let qtys: any[] = [];
                                if (row && row.free_qtys) {
                                    try {
                                        qtys = JSON.parse(row.free_qtys);
                                    } catch (e) {}
                                }
                                if (!Array.isArray(qtys)) {
                                    qtys = [];
                                }

                                const locObj = locationsList.find(l => l.id.toString() === activeLocId);
                                const locName = locObj ? locObj.name : `Location #${activeLocId}`;

                                qtys = qtys.filter((item: any) => item.location_id !== parseInt(activeLocId));
                                qtys.push({
                                    location_id: parseInt(activeLocId),
                                    location_name: locName,
                                    quantity: p.free_qty
                                });

                                await localDb.runAsync(
                                    'UPDATE product_product SET free_qtys = ? WHERE odoo_id = ?',
                                    JSON.stringify(qtys),
                                    p.odoo_id
                                );
                            }
                        });
                        return;
                    }
                } catch (err) {
                    console.warn('Storage: Failed to fetch real-time quants:', err);
                }
                return;
            }

            setProducts(data || []);
        } catch (e) {
            console.error('Storage: Failed to load products', e);
        } finally {
            isFetchingRef.current = false;
        }
    }, [isOffline, selectedLocationId]);

    useEffect(() => {
        let defaultLocations: any[] = [];
        if (salesRepProfile && salesRepProfile.default_location_ids) {
            try {
                const parsed = typeof salesRepProfile.default_location_ids === 'string'
                    ? JSON.parse(salesRepProfile.default_location_ids)
                    : salesRepProfile.default_location_ids;
                if (Array.isArray(parsed)) {
                    defaultLocations = parsed.map((loc: any) => {
                        if (typeof loc === 'object' && loc !== null) {
                            return { id: loc.id, name: loc.display_name || loc.name };
                        }
                        return { id: loc, name: `Location #${loc}` };
                    });
                }
            } catch (e) {
                console.warn("Failed to parse default_location_ids:", e);
            }
        }
        if (defaultLocations.length === 0 && salesRepProfile?.default_location_id) {
            defaultLocations = [{
                id: salesRepProfile.default_location_id,
                name: salesRepProfile.default_location_name || `Location #${salesRepProfile.default_location_id}`
            }];
        }
        setLocationsList(defaultLocations);
        if (defaultLocations.length > 0 && !selectedLocationId) {
            setSelectedLocationId(defaultLocations[0].id.toString());
        }
    }, [salesRepProfile]);

    useEffect(() => {
        if (selectedLocationId) {
            (async () => {
                setLoading(true);
                await loadProducts(selectedLocationId);
                setLoading(false);
            })();
        } else {
            setLoading(false);
        }
    }, [selectedLocationId]);

    // Reload when sync finishes
    useEffect(() => {
        if (!isSyncing && !loading) {
            loadProducts(selectedLocationId);
        }
    }, [isSyncing]);

    const onRefresh = async () => {
        setRefreshing(true);
        if (!isOffline) {
            await performSync();
        }
        await loadProducts(selectedLocationId);
        setRefreshing(false);
    };

    // Filter & sort
    const filteredProducts = products
        .filter(p => {
            if (filter === 'in_stock') return (p.free_qty || 0) > 0;
            if (filter === 'out_of_stock') return (p.free_qty || 0) <= 0;
            return true;
        })
        .filter(p =>
            (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.default_code || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
        .sort((a, b) => {
            let valA = a[sortField];
            let valB = b[sortField];
            if (sortField === 'free_qty') {
                valA = valA || 0;
                valB = valB || 0;
            } else {
                valA = (valA || '').toLowerCase();
                valB = (valB || '').toLowerCase();
            }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

    // Stats
    const totalProducts = products.length;
    const inStockCount = products.filter(p => (p.free_qty || 0) > 0).length;
    const outOfStockCount = totalProducts - inStockCount;
    const totalValue = products.reduce((sum, p) => sum + ((p.free_qty || 0) * (p.list_price || 0)), 0);

    const formatCurrency = (v: number) => {
        const symbol = i18n.t('common.currency_symbol');
        return `${symbol}${v.toFixed(2)}`;
    };

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    };

    const getStockColor = (qty: number) => {
        if (qty <= 0) return '#ef4444';
        if (qty <= 5) return '#f59e0b';
        return '#22c55e';
    };

    const renderItem = ({ item, index }: { item: any, index: number }) => {
        const qty = item.free_qty || 0;
        const stockColor = getStockColor(qty);

        return (
            <Animated.View
                entering={FadeInDown.delay(index * 15).duration(250)}
                style={[styles.productCard, { backgroundColor: colors.card, borderBottomColor: colors.border + '30' }]}
            >
                {/* Product Icon */}
                <TouchableOpacity
                    onPress={() => item.image_url && openImagePreview(item.image_url)}
                    disabled={!item.image_url}
                    style={[styles.productIcon, { backgroundColor: stockColor + '15', overflow: 'hidden' }]}
                >
                    {item.image_url ? (
                        <Image source={{ uri: getImageUrl(item.image_url) }} style={styles.productImage} />
                    ) : (
                        <Ionicons
                            name={qty > 0 ? 'cube' : 'cube-outline'}
                            size={22}
                            color={stockColor}
                        />
                    )}
                </TouchableOpacity>

                {/* Product Info */}
                <View style={styles.productInfo}>
                    <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                        {item.name}
                    </Text>
                    <View style={styles.productMeta}>
                        {item.default_code ? (
                            <View style={[styles.codeBadge, { backgroundColor: colors.primary + '12' }]}>
                                <Text style={[styles.codeText, { color: colors.primary }]}>{item.default_code}</Text>
                            </View>
                        ) : null}
                        {item.categ_name ? (
                            <Text style={[styles.categText, { color: colors.textSecondary }]}>
                                {item.categ_name}
                            </Text>
                        ) : null}
                    </View>
                </View>

                {/* Qty & Price */}
                <View style={styles.qtyContainer}>
                    <View style={[styles.qtyBadge, { backgroundColor: stockColor + '15', borderColor: stockColor + '30' }]}>
                        <Text style={[styles.qtyValue, { color: stockColor }]}>
                            {qty}
                        </Text>
                    </View>
                    <Text style={[styles.uomText, { color: colors.textSecondary }]}>
                        {item.uom_name || ''}
                    </Text>
                    {/* <Text style={[styles.priceText, { color: colors.textSecondary }]}>
                        {formatCurrency(item.list_price || 0)}
                    </Text> */}
                </View>
            </Animated.View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.menuBtn}>
                    <Ionicons name="menu-outline" size={26} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                    {i18n.t('storage.title')}
                </Text>
                <TouchableOpacity
                    onPress={onRefresh}
                    disabled={isSyncing}
                    style={[styles.syncBtn, { backgroundColor: colors.primary + '15' }]}
                >
                    <Ionicons name="sync-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
            </View>

             {/* Search Bar */}
            <View style={styles.searchContainer}>
                <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
                    <TextInput
                        style={[styles.searchInput, { color: colors.text }]}
                        placeholder={i18n.t('storage.search_placeholder')}
                        placeholderTextColor={colors.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery !== '' && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Stats Cards */}
            <View style={styles.statsRow}>
                <TouchableOpacity
                    style={[
                        styles.statCard,
                        { backgroundColor: filter === 'all' ? colors.primary + '15' : colors.card, borderColor: filter === 'all' ? colors.primary + '40' : colors.border }
                    ]}
                    onPress={() => setFilter('all')}
                >
                    <Ionicons name="layers-outline" size={18} color={filter === 'all' ? colors.primary : colors.textSecondary} />
                    <Text style={[styles.statNumber, { color: filter === 'all' ? colors.primary : colors.text }]}>{totalProducts}</Text>
                    <Text style={[styles.statLabel, { color: filter === 'all' ? colors.primary : colors.textSecondary }]}>
                        {i18n.t('storage.total')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.statCard,
                        { backgroundColor: filter === 'in_stock' ? '#22c55e15' : colors.card, borderColor: filter === 'in_stock' ? '#22c55e40' : colors.border }
                    ]}
                    onPress={() => setFilter(filter === 'in_stock' ? 'all' : 'in_stock')}
                >
                    <Ionicons name="checkmark-circle-outline" size={18} color={filter === 'in_stock' ? '#22c55e' : '#22c55e'} />
                    <Text style={[styles.statNumber, { color: filter === 'in_stock' ? '#22c55e' : colors.text }]}>{inStockCount}</Text>
                    <Text style={[styles.statLabel, { color: filter === 'in_stock' ? '#22c55e' : colors.textSecondary }]}>
                        {i18n.t('storage.in_stock')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.statCard,
                        { backgroundColor: filter === 'out_of_stock' ? '#ef444415' : colors.card, borderColor: filter === 'out_of_stock' ? '#ef444440' : colors.border }
                    ]}
                    onPress={() => setFilter(filter === 'out_of_stock' ? 'all' : 'out_of_stock')}
                >
                    <Ionicons name="alert-circle-outline" size={18} color={filter === 'out_of_stock' ? '#ef4444' : '#ef4444'} />
                    <Text style={[styles.statNumber, { color: filter === 'out_of_stock' ? '#ef4444' : colors.text }]}>{outOfStockCount}</Text>
                    <Text style={[styles.statLabel, { color: filter === 'out_of_stock' ? '#ef4444' : colors.textSecondary }]}>
                        {i18n.t('storage.out_of_stock')}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Total Inventory Value */}
            {/* <View style={[styles.valueBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="wallet-outline" size={16} color={colors.primary} />
                    <Text style={[styles.valueLabel, { color: colors.textSecondary }]}>
                        {i18n.t('storage.inventory_value') || 'Inventory Value'}
                    </Text>
                </View>
                <Text style={[styles.valueAmount, { color: colors.primary }]}>
                    {formatCurrency(totalValue)}
                </Text>
            </View> */}
            
            {/* Location Selector */}
            {locationsList.length > 1 && (
                <View style={styles.locationSelectorContainer}>
                    <Dropdown
                        items={locationsList.map(loc => ({ label: loc.name, value: loc.id.toString() }))}
                        selectedValue={selectedLocationId}
                        onSelect={(val) => {
                            setSelectedLocationId(val);
                            loadProducts(val);
                        }}
                        placeholder={i18n.t('storage.select_location')}
                    />
                </View>
            )}


            {/* Sort Chips */}
            <View style={styles.sortRow}>
                {([
                    { field: 'name' as SortField, label: i18n.t('storage.sort_name'), icon: 'text-outline' },
                    { field: 'free_qty' as SortField, label: i18n.t('storage.sort_qty'), icon: 'cube-outline' },
                    { field: 'default_code' as SortField, label: i18n.t('storage.sort_code'), icon: 'barcode-outline' },
                ]).map(s => (
                    <TouchableOpacity
                        key={s.field}
                        style={[
                            styles.sortChip,
                            {
                                backgroundColor: sortField === s.field ? colors.primary + '15' : colors.card,
                                borderColor: sortField === s.field ? colors.primary + '40' : colors.border
                            }
                        ]}
                        onPress={() => toggleSort(s.field)}
                    >
                        <Ionicons name={s.icon as any} size={14} color={sortField === s.field ? colors.primary : colors.textSecondary} />
                        <Text style={{ color: sortField === s.field ? colors.primary : colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                            {s.label}
                        </Text>
                        {sortField === s.field && (
                            <Ionicons
                                name={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'}
                                size={12}
                                color={colors.primary}
                            />
                        )}
                    </TouchableOpacity>
                ))}
                <View style={{ flex: 1 }} />
                <Text style={[styles.countText, { color: colors.textSecondary }]}>
                    {filteredProducts.length} {i18n.t('storage.items')}
                </Text>
            </View>

            {/* Product List */}
            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                        {i18n.t('storage.loading')}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={filteredProducts}
                    keyExtractor={item => (item.odoo_id || item.id || Math.random()).toString()}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
                    }
                    ListEmptyComponent={
                        <View style={styles.centered}>
                            <Ionicons name="cube-outline" size={64} color={colors.textSecondary + '50'} />
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                {searchQuery
                                    ? i18n.t('storage.no_results')
                                    : i18n.t('storage.no_products')
                                }
                            </Text>
                        </View>
                    }
                />
            )}

            {/* Last Sync footer */}
            {!!lastSyncTime && (
                <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                    <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
                    <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                        {i18n.t('storage.last_sync')}: {new Date(lastSyncTime).toLocaleString()}
                    </Text>
                </View>
            )}
            <Modal
                visible={!!previewImage}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setPreviewImage(null)}
            >
                <TouchableOpacity 
                    style={styles.modalOverlay} 
                    activeOpacity={1} 
                    onPress={() => setPreviewImage(null)}
                >
                    <View style={styles.modalImageContainer}>
                        {previewImage && (
                            <Image 
                                source={{ uri: previewImage }} 
                                style={styles.previewFullImage} 
                                resizeMode="contain"
                            />
                        )}
                        <TouchableOpacity 
                            style={styles.closePreviewButton} 
                            onPress={() => setPreviewImage(null)}
                        >
                            <Ionicons name="close-circle" size={44} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderBottomWidth: 1,
        gap: 8,
    },
    menuBtn: { padding: 4 },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: 'bold' },
    syncBtn: {
        width: 36, height: 36, borderRadius: 18,
        alignItems: 'center', justifyContent: 'center',
    },
    statsRow: {
        flexDirection: 'row',
        paddingHorizontal: 12,
        paddingTop: 12,
        gap: 8,
    },
    statCard: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        gap: 2,
    },
    statNumber: { fontSize: 20, fontWeight: '800' },
    statLabel: { fontSize: 11, fontWeight: '600' },
    valueBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: 12,
        marginTop: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
    },
    valueLabel: { fontSize: 13, fontWeight: '500' },
    valueAmount: { fontSize: 16, fontWeight: '800' },
    searchContainer: { paddingHorizontal: 12, paddingTop: 10 },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        height: 44,
        borderRadius: 12,
        borderWidth: 1,
        gap: 8,
    },
    searchInput: { flex: 1, fontSize: 15 },
    sortRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 4,
        gap: 6,
    },
    sortChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        gap: 4,
    },
    countText: { fontSize: 12, fontWeight: '500' },
    listContent: { paddingBottom: 60 },
    productCard: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        gap: 12,
    },
    productIcon: {
        width: 42, height: 42,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    productInfo: { flex: 1, gap: 4 },
    productName: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
    productMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    codeBadge: {
        paddingHorizontal: 6, paddingVertical: 2,
        borderRadius: 4,
    },
    codeText: { fontSize: 11, fontWeight: '600' },
    categText: { fontSize: 11 },
    qtyContainer: { alignItems: 'center', gap: 2, minWidth: 58 },
    qtyBadge: {
        paddingHorizontal: 10, paddingVertical: 4,
        borderRadius: 8, borderWidth: 1,
    },
    qtyValue: { fontSize: 16, fontWeight: '800' },
    uomText: { fontSize: 10, fontWeight: '500' },
    priceText: { fontSize: 11, fontWeight: '600' },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    loadingText: { marginTop: 12, fontSize: 14 },
    emptyText: { marginTop: 16, fontSize: 15, textAlign: 'center' },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: 6,
        borderTopWidth: 1,
    },
    footerText: { fontSize: 11 },
    locationSelectorContainer: {
        paddingHorizontal: 12,
        paddingTop: 10,
        zIndex: 10,
    },
    productImage: {
        width: '100%',
        height: '100%',
        borderRadius: 10,
        resizeMode: 'cover',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalImageContainer: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    previewFullImage: {
        width: '95%',
        height: '85%',
    },
    closePreviewButton: {
        position: 'absolute',
        top: 50,
        right: 25,
        zIndex: 10,
        padding: 10,
    },
});
