import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, TextInput, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import i18n from '../../i18n';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useRouter, useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { stockService } from '../../services/api/index';
import { getProducts, getUomsByCategory } from '../../services/database/repositories';
import { RefreshControl } from 'react-native';

export default function StockRequestsScreen() {
    const { colors } = useThemeStore();
    const router = useRouter();
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const {
        stockRequests, fetchStockRequests, submitStockRequest,
        salesRepProfile, isSyncing
    } = useOfflineStore();

    const [isCreateModalVisible, setCreateModalVisible] = useState(false);
    const [selectedProducts, setSelectedProducts] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [products, setProducts] = useState<any[]>([]);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // UoM Selection State
    const [availableUoms, setAvailableUoms] = useState<Record<number, any[]>>({});
    const [isUomModalVisible, setUomModalVisible] = useState(false);
    const [activeProductForUom, setActiveProductForUom] = useState<any>(null);

    useFocusEffect(
        useCallback(() => {
            fetchStockRequests();
        }, [])
    );

    const handleViewDetails = (request: any) => {
        router.push({
            pathname: '/(drawer)/requests_details',
            params: { local_id: request.local_id }
        });
    };

    const loadProducts = async () => {
        setLoadingProducts(true);
        try {
            const data = await getProducts(true);
            setProducts(data);
        } catch (error) {
            console.error("Failed to load products:", error);
        } finally {
            setLoadingProducts(false);
        }
    };

    const handleOpenCreateModal = () => {
        loadProducts();
        setSelectedProducts([]);
        setCreateModalVisible(true);
    };

    const handleAddProduct = async (product: any) => {
        // Exclude if already selected (though filtered list handles this)
        if (selectedProducts.some(p => p.id === product.id)) return;

        // Load UoMs if not already cached
        if (product.uom_category_id && !availableUoms[product.uom_category_id]) {
            try {
                const uoms = await getUomsByCategory(product.uom_category_id);
                setAvailableUoms(prev => ({ ...prev, [product.uom_category_id]: uoms }));
            } catch (error) {
                console.error("Failed to load UoMs for category:", product.uom_category_id, error);
            }
        }

        setSelectedProducts([...selectedProducts, {
            ...product,
            quantity: 1,
            selected_uom_id: product.uom_id,
            selected_uom_name: product.uom_name || i18n.t('common.uom')
        }]);
    };

    const handleUpdateQuantity = (productId: number, delta: number) => {
        setSelectedProducts(selectedProducts.map(p => {
            if (p.id === productId) {
                const newQty = Math.max(0, p.quantity + delta);
                return { ...p, quantity: newQty };
            }
            return p;
        }).filter(p => p.quantity > 0));
    };

    const handleUpdateUom = (productId: number, uomId: number, uomName: string) => {
        setSelectedProducts(selectedProducts.map(p =>
            p.id === productId ? { ...p, selected_uom_id: uomId, selected_uom_name: uomName } : p
        ));
        setUomModalVisible(false);
    };

    const handleSubmit = async () => {
        if (selectedProducts.length === 0) {
            Alert.alert(i18n.t('common.error'), i18n.t('requests.no_products_selected'));
            return;
        }

        try {
            const lines = selectedProducts.map(p => ({
                product_id: p.odoo_id,
                product_name: p.name,
                product_uom_qty: p.quantity,
                product_uom_id: p.selected_uom_id || p.uom_id
            }));

            await submitStockRequest(lines);
            setCreateModalVisible(false);
            Alert.alert(i18n.t('common.success'), i18n.t('requests.submit_success'));
        } catch (error: any) {
            Alert.alert(i18n.t('common.error'), error.message);
        }
    };

    const filteredProducts = products.filter(p => {
        // Exclude already selected products
        if (selectedProducts.some(sp => sp.id === p.id)) return false;

        const name = p.name || '';
        const code = p.default_code || '';
        return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            code.toLowerCase().includes(searchQuery.toLowerCase());
    });

    const filteredRequests = stockRequests.filter((req: any) => {
        return req.state === 'draft' || req.state === 'submitted' || req.state === 'done';
    });

    const renderRequestItem = ({ item }: { item: any }) => (
        <TouchableOpacity onPress={() => handleViewDetails(item)}>
            <Animated.View
                entering={FadeInDown}
                style={[styles.requestCard, { backgroundColor: colors.card }]}
            >
                <View style={styles.requestHeader}>
                    <Text style={[styles.requestRef, { color: colors.text }]}>
                        {item.name || `Local: ${item.local_id.substring(0, 8)}...`}
                    </Text>
                    <View style={[
                        styles.statusBadge,
                        { backgroundColor: getStatusColor(item.state) + '20' }
                    ]}>
                        <Text style={[styles.statusText, { color: getStatusColor(item.state) }]}>
                            {i18n.t(`requests.status.${item.state}`)}
                        </Text>
                    </View>
                </View>

                <View style={styles.requestDetails}>
                    <View style={styles.detailItem}>
                        <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                            {dayjs(item.date).format('YYYY-MM-DD HH:mm')}
                        </Text>
                    </View>
                </View>
            </Animated.View>
        </TouchableOpacity>
    );

    const getStatusColor = (state: string) => {
        switch (state) {
            case 'draft': return colors.textSecondary;
            case 'submitted': return colors.primary;
            case 'confirmed': return colors.success;
            case 'assigned': return colors.accent;
            case 'done': return colors.success;
            case 'cancel':
            case 'cancelled': return colors.danger;
            default: return colors.primary;
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.backButton}>
                    <Ionicons name="menu" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                    {i18n.t('drawer.requests')}
                </Text>
                <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: colors.primary }]}
                    onPress={() => router.push('/(drawer)/requests_details?mode=create')}
                >
                    <Ionicons name="add" size={24} color="#FFF" />
                </TouchableOpacity>
            </View>

            <FlatList
                data={filteredRequests}
                renderItem={renderRequestItem}
                keyExtractor={item => item.local_id}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={async () => {
                            setRefreshing(true);
                            await fetchStockRequests();
                            setRefreshing(false);
                        }}
                        tintColor={colors.primary}
                    />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="document-text-outline" size={64} color={colors.border} />
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                            {i18n.t('requests.no_requests')}
                        </Text>
                    </View>
                }
            />

            {/* Create Modal */}
            <Modal
                visible={isCreateModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setCreateModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>
                                {i18n.t('requests.new_request')}
                            </Text>
                            <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>

                        {/* Selected Lines */}
                        {selectedProducts.length > 0 && (
                            <View style={styles.selectedSection}>
                                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                                    {i18n.t('requests.selected_items')} ({selectedProducts.length})
                                </Text>
                                <ScrollView style={[styles.selectedList, { maxHeight: 200 }]}>
                                    {selectedProducts.map(p => (
                                        <View key={p.id} style={[styles.selectedItem, { borderBottomColor: colors.border }]}>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.selectedItemName, { color: colors.text }]} numberOfLines={1}>
                                                    {p.name}
                                                </Text>
                                                <TouchableOpacity
                                                    onPress={() => {
                                                        setActiveProductForUom(p);
                                                        setUomModalVisible(true);
                                                    }}
                                                    style={[styles.uomBadge, { backgroundColor: colors.card, borderColor: colors.border }]}
                                                >
                                                    <Text style={[styles.uomBadgeText, { color: colors.textSecondary }]}>
                                                        {p.selected_uom_name}
                                                    </Text>
                                                    <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                                                </TouchableOpacity>
                                            </View>
                                            <View style={styles.qtyControls}>
                                                <TouchableOpacity onPress={() => handleUpdateQuantity(p.id, -1)}>
                                                    <Ionicons name="remove-circle-outline" size={24} color={colors.danger} />
                                                </TouchableOpacity>
                                                <Text style={[styles.qtyText, { color: colors.text }]}>{p.quantity}</Text>
                                                <TouchableOpacity onPress={() => handleUpdateQuantity(p.id, 1)}>
                                                    <Ionicons name="add-circle-outline" size={24} color={colors.success} />
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    ))}
                                </ScrollView>
                            </View>
                        )}

                        {/* Search & Product List */}
                        <View style={styles.searchContainer}>
                            <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
                            <TextInput
                                style={[styles.searchInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                                placeholder={i18n.t('common.search_products')}
                                placeholderTextColor={colors.textSecondary}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                            />
                        </View>

                        {loadingProducts ? (
                            <ActivityIndicator size="large" color={colors.primary} style={{ margin: 20 }} />
                        ) : (
                            <FlatList
                                data={filteredProducts}
                                keyExtractor={item => item.id.toString()}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={[styles.productItem, { borderBottomColor: colors.border }]}
                                        onPress={() => handleAddProduct(item)}
                                    >
                                        <View>
                                            <Text style={[styles.productName, { color: colors.text }]}>{item.name}</Text>
                                            {/* <Text style={[styles.productCode, { color: colors.textSecondary }]}>{item.default_code || '---'}</Text> */}
                                        </View>
                                        <Ionicons name="add-circle" size={24} color={colors.primary} />
                                    </TouchableOpacity>
                                )}
                                style={styles.productList}
                            />
                        )}

                        <TouchableOpacity
                            style={[
                                styles.submitButton,
                                { backgroundColor: colors.primary, opacity: selectedProducts.length > 0 ? 1 : 0.5 }
                            ]}
                            disabled={selectedProducts.length === 0}
                            onPress={handleSubmit}
                        >
                            <Text style={styles.submitButtonText}>{i18n.t('common.submit')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* UoM Selection Modal */}
            <Modal
                visible={isUomModalVisible}
                animationType="fade"
                transparent={true}
                onRequestClose={() => setUomModalVisible(false)}
            >
                <View style={styles.uomModalOverlay}>
                    <View style={[styles.uomModalContent, { backgroundColor: colors.background }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>
                                {i18n.t('common.select_uom')}
                            </Text>
                            <TouchableOpacity onPress={() => setUomModalVisible(false)}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>

                        <FlatList
                            data={activeProductForUom ? (availableUoms[activeProductForUom.uom_category_id] || []) : []}
                            keyExtractor={item => item.odoo_id.toString()}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={[
                                        styles.uomItem,
                                        {
                                            backgroundColor: activeProductForUom?.selected_uom_id === item.odoo_id ? colors.primary + '15' : colors.card
                                        }
                                    ]}
                                    onPress={() => handleUpdateUom(activeProductForUom.id, item.odoo_id, item.name)}
                                >
                                    <Text style={[
                                        styles.uomItemText,
                                        {
                                            color: activeProductForUom?.selected_uom_id === item.odoo_id ? colors.primary : colors.text,
                                        }
                                    ]}>
                                        {item.name}
                                    </Text>
                                    {activeProductForUom?.selected_uom_id === item.odoo_id && (
                                        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                                    )}
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </View>
            </Modal>


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
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        flex: 1,
        textAlign: 'center',
    },
    addButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    listContent: {
        padding: 16,
    },
    requestCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 1.41,
    },
    requestHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    requestRef: {
        fontSize: 16,
        fontWeight: '600',
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    statusText: {
        fontSize: 12,
        fontWeight: 'bold',
        textTransform: 'uppercase',
    },
    requestDetails: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    detailItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    detailText: {
        fontSize: 14,
    },
    syncBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    syncText: {
        fontSize: 12,
        fontWeight: '500',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
        opacity: 0.5,
    },
    emptyText: {
        marginTop: 16,
        fontSize: 16,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    uomModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        height: '80%',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 20,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    searchIcon: {
        position: 'absolute',
        left: 12,
        zIndex: 1,
    },
    searchInput: {
        flex: 1,
        height: 44,
        borderRadius: 12,
        borderWidth: 1,
        paddingLeft: 40,
        paddingRight: 16,
    },
    productList: {
        flex: 1,
    },
    productItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    productName: {
        fontSize: 16,
        fontWeight: '500',
    },
    productCode: {
        fontSize: 12,
        marginTop: 2,
    },
    selectedSection: {
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
    },
    selectedList: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#eee',
    },
    selectedItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
        borderBottomWidth: 1,
    },
    selectedItemName: {
        flex: 1,
        fontSize: 14,
    },
    qtyControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    qtyText: {
        fontSize: 16,
        fontWeight: 'bold',
        marginHorizontal: 15,
    },
    uomBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        marginTop: 6,
        alignSelf: 'flex-start',
        borderWidth: 1,
    },
    uomBadgeText: {
        fontSize: 13,
        marginRight: 6,
        fontWeight: '500',
    },
    uomModalContent: {
        width: '100%',
        maxHeight: '70%',
        borderRadius: 24,
        padding: 24,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 15 },
        shadowOpacity: 0.4,
        shadowRadius: 25,
    },
    uomItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 18,
        paddingHorizontal: 16,
        borderRadius: 16,
        marginBottom: 8,
    },
    uomItemText: {
        fontSize: 16,
        fontWeight: '500',
    },
    submitButton: {
        height: 50,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 20,
    },
    submitButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    // Detail Modal Styles
    detailScroll: {
        flex: 1,
    },
    detailHeaderInfo: {
        alignItems: 'center',
        paddingVertical: 20,
    },
    detailMainRef: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    statusBadgeLarge: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 20,
    },
    statusTextLarge: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    infoCard: {
        marginHorizontal: 16,
        borderRadius: 12,
        padding: 16,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    infoLabel: {
        fontSize: 14,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '600',
    },
    itemsList: {
        marginHorizontal: 16,
        borderRadius: 12,
        marginBottom: 20,
    },
    detailItemRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
    },
    detailItemName: {
        fontSize: 16,
        fontWeight: '500',
    },
    detailItemState: {
        fontSize: 12,
        marginTop: 2,
    },
    detailItemQty: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    modalFooter: {
        paddingTop: 10,
    }
});
