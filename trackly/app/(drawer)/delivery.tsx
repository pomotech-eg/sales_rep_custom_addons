import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, RefreshControl, ScrollView } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import i18n from '../../i18n';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { getStockPickings } from '../../services/database/repositories';

export default function DeliveriesScreen() {
    const { colors } = useThemeStore();
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const router = useRouter();
    const { performSync, isSyncing, isOffline } = useOfflineStore();

    const [pickings, setPickings] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState< 'all' |'assigned' | 'waiting' | 'done' | 'cancel'>('all');
    const [refreshing, setRefreshing] = useState(false);

    const loadPickings = useCallback(async () => {
        try {
            let queryState = activeTab;
            
            // Fetch pickings from local SQLite
            let data = await getStockPickings(queryState, searchQuery);

            // If we selected 'waiting' we also want to merge 'confirmed' state which Odoo uses
            if (activeTab === 'waiting') {
                const confirmedData = await getStockPickings('confirmed', searchQuery);
                const merged = [...data, ...confirmedData];
                // Sort by date descending
                merged.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
                data = merged;
            }

            setPickings(data);
        } catch (error) {
            console.error("Failed to load pickings from SQLite:", error);
        }
    }, [activeTab, searchQuery]);

    useFocusEffect(
        useCallback(() => {
            loadPickings();
        }, [loadPickings])
    );

    const handleRefresh = async () => {
        setRefreshing(true);
        if (!isOffline) {
            try {
                await performSync();
            } catch (error) {
                console.error("Sync failed during pull:", error);
            }
        }
        await loadPickings();
        setRefreshing(false);
    };

    const handleSelectPicking = (picking: any) => {
        router.push({
            pathname: '/(drawer)/delivery_details',
            params: { odoo_id: picking.odoo_id }
        });
    };

    const getStatusColor = (state: string) => {
        switch (state) {
            case 'draft': return colors.textSecondary || '#6b7280';
            case 'waiting':
            case 'confirmed': return '#f59e0b'; // Amber
            case 'assigned': return '#3b82f6'; // Blue / Ready
            case 'done': return colors.success || '#10b981'; // Green
            case 'cancel': return colors.danger || '#ef4444'; // Red
            default: return colors.primary || '#6366f1';
        }
    };

    const getStatusTranslation = (state: string) => {
        switch (state) {
            case 'draft': return i18n.t('delivery.state_draft') || 'Draft';
            case 'waiting': return i18n.t('delivery.state_waiting') || 'Waiting Another';
            case 'confirmed': return i18n.t('delivery.state_confirmed') || 'Waiting';
            case 'assigned': return i18n.t('delivery.state_assigned') || 'Ready';
            case 'done': return i18n.t('delivery.state_done') || 'Done';
            case 'cancel': return i18n.t('delivery.state_cancel') || 'Cancelled';
            default: return state;
        }
    };

    const renderPickingCard = ({ item, index }: { item: any, index: number }) => (
        <Animated.View entering={FadeInDown.delay(index * 50)} style={[styles.card, { backgroundColor: colors.card }]}>
            <TouchableOpacity onPress={() => handleSelectPicking(item)} activeOpacity={0.8}>
                <View style={styles.cardHeader}>
                    <Text style={[styles.pickingName, { color: colors.text }]}>{item.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.state) + '15' }]}>
                        <Text style={[styles.statusText, { color: getStatusColor(item.state) }]}>
                            {getStatusTranslation(item.state)}
                        </Text>
                    </View>
                </View>

                {item.partner_name ? (
                    <View style={styles.cardRow}>
                        <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                        <Text style={[styles.cardText, { color: colors.textSecondary }]}>{item.partner_name}</Text>
                    </View>
                ) : null}

                {item.origin ? (
                    <View style={styles.cardRow}>
                        <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
                        <Text style={[styles.cardText, { color: colors.textSecondary }]}>
                            {i18n.t('delivery.source_doc')}: {item.origin}
                        </Text>
                    </View>
                ) : null}

                <View style={styles.locationsContainer}>
                    <View style={styles.locationNode}>
                        <Ionicons name="arrow-up-circle-outline" size={16} color={colors.primary} />
                        <Text style={[styles.locationText, { color: colors.text }]} numberOfLines={1}>
                            {item.location_name || 'Stock'}
                        </Text>
                    </View>
                    <Ionicons name="arrow-forward" size={14} color={colors.textSecondary} style={styles.arrowIcon} />
                    <View style={styles.locationNode}>
                        <Ionicons name="arrow-down-circle-outline" size={16} color={colors.success} />
                        <Text style={[styles.locationText, { color: colors.text }]} numberOfLines={1}>
                            {item.location_dest_name || 'Customer'}
                        </Text>
                    </View>
                </View>

                <View style={styles.cardFooter}>
                    <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.dateText, { color: colors.textSecondary }]}>
                        {dayjs(item.date).format('YYYY-MM-DD HH:mm')}
                    </Text>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.menuButton}>
                    <Ionicons name="menu" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                    {i18n.t('delivery.screen_title') || 'Deliveries'}
                </Text>
                <View style={{ width: 40 }} />
            </View>

            {/* Search and Filters */}
            <View style={styles.searchContainer}>
                <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
                    <TextInput
                        placeholder={i18n.t('delivery.search_placeholder') || 'Search deliveries...'}
                        placeholderTextColor={colors.textSecondary + '80'}
                        value={searchQuery}
                        onChangeText={(text) => {
                            setSearchQuery(text);
                            loadPickings();
                        }}
                        style={[styles.searchInput, { color: colors.text }]}
                    />
                    {searchQuery ? (
                        <TouchableOpacity onPress={() => { setSearchQuery(''); loadPickings(); }}>
                            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                    ) : null}
                </View>
            </View>

            {/* Filter Tabs */}
            <View style={styles.tabsContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
                    {(['all','assigned', 'waiting', 'done', 'cancel'] as const).map((tab) => {
                        const isActive = activeTab === tab;
                        return (
                            <TouchableOpacity
                                key={tab}
                                onPress={() => {
                                    setActiveTab(tab);
                                }}
                                style={[
                                    styles.tabButton,
                                    isActive && { backgroundColor: colors.primary }
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.tabText,
                                        { color: isActive ? '#fff' : colors.textSecondary }
                                    ]}
                                >
                                    {getStatusTranslation(tab)}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            {/* Content List */}
            <FlatList
                data={pickings}
                renderItem={renderPickingCard}
                keyExtractor={(item) => item.odoo_id.toString()}
                contentContainerStyle={styles.listContainer}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="car-outline" size={64} color={colors.textSecondary + '40'} />
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                            {i18n.t('delivery.no_deliveries') || 'No deliveries found'}
                        </Text>
                    </View>
                }
            />
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
        paddingVertical: 12,
    },
    menuButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 48,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        paddingVertical: 8,
    },
    tabsContainer: {
        paddingVertical: 8,
    },
    tabsScroll: {
        paddingHorizontal: 16,
        gap: 8,
    },
    tabButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    tabText: {
        fontSize: 14,
        fontWeight: '600',
    },
    listContainer: {
        padding: 16,
        gap: 12,
    },
    card: {
        borderRadius: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    pickingName: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
    },
    cardRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    cardText: {
        fontSize: 14,
    },
    locationsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#00000003',
        padding: 8,
        borderRadius: 8,
        marginTop: 4,
        marginBottom: 12,
    },
    locationNode: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    locationText: {
        fontSize: 13,
        fontWeight: '500',
        flex: 1,
    },
    arrowIcon: {
        marginHorizontal: 8,
    },
    cardFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#00000010',
        paddingTop: 12,
    },
    dateText: {
        fontSize: 12,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        gap: 12,
    },
    emptyText: {
        fontSize: 16,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        height: '80%',
        paddingBottom: 20,
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
    },
    modalBody: {
        flex: 1,
        padding: 16,
    },
    detailCard: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 20,
    },
    detailCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    detailCardName: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    divider: {
        height: 1,
        backgroundColor: '#00000010',
        marginVertical: 12,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 6,
    },
    detailLabel: {
        fontSize: 14,
    },
    detailValue: {
        fontSize: 14,
        fontWeight: '500',
    },
    movesTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 12,
        paddingHorizontal: 4,
    },
    movesList: {
        gap: 8,
    },
    moveItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        borderBottomWidth: 1,
    },
    moveItemLeft: {
        flex: 1,
        gap: 4,
    },
    productName: {
        fontSize: 14,
        fontWeight: '500',
    },
    moveLocations: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    moveUom: {
        fontSize: 12,
    },
    moveItemRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    qtyNode: {
        alignItems: 'center',
    },
    qtyLabel: {
        fontSize: 11,
        marginBottom: 2,
    },
    qtyValue: {
        fontSize: 14,
    },
});
