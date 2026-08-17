import React, { useEffect, useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Alert,
    RefreshControl,
    TextInput,
    FlatList,
    Modal
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import i18n from '../../i18n';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Dropdown } from '../../components/CustomDropdown';
import { getProducts, getUomsByCategory } from '../../services/database/repositories';

export default function RequestDetailsScreen() {
    const { local_id, mode } = useLocalSearchParams<{ local_id?: string; mode?: string }>();
    const { colors } = useThemeStore();
    const router = useRouter();
    const { isOffline, salesRepProfile, submitStockRequest } = useOfflineStore();
    
    const isCreateMode = mode === 'create';

    // View Details State
    const [request, setRequest] = useState<any>(null);
    const [loading, setLoading] = useState(!isCreateMode);
    const [refreshing, setRefreshing] = useState(false);

    // Create Request State
    const [sourceLocId, setSourceLocId] = useState<number | null>(null);
    const [destLocId, setDestLocId] = useState<number | null>(null);
    const [selectedProducts, setSelectedProducts] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [products, setProducts] = useState<any[]>([]);
    const [loadingProducts, setLoadingProducts] = useState(false);

    // UoM Selection State
    const [availableUoms, setAvailableUoms] = useState<Record<number, any[]>>({});
    const [isUomModalVisible, setUomModalVisible] = useState(false);
    const [activeProductForUom, setActiveProductForUom] = useState<any>(null);

    // Load details
    const loadRequestDetails = useCallback(async (showLoading = true) => {
        if (isCreateMode) return;
        if (showLoading) setLoading(true);
        try {
            const { getDB } = require('../../services/database/index');
            const db = await getDB();
            
            const req = await db.getFirstAsync('SELECT * FROM sales_rep_request WHERE local_id = ?', local_id);
            
            if (req) {
                const lines = await db.getAllAsync('SELECT * FROM sales_rep_request_line WHERE request_local_id = ?', local_id);
                
                const linesWithProducts = await Promise.all(lines.map(async (line: any) => {
                    const product = await db.getFirstAsync('SELECT name FROM product_product WHERE odoo_id = ?', line.product_id);
                    return {
                        ...line,
                        product_name: product?.name || line.product_name || `Product #${line.product_id}`
                    };
                }));

                const fullRequest = { ...req, lines: linesWithProducts };
                setRequest(fullRequest);

                if (req.odoo_id && !isOffline) {
                    try {
                        const { stockService } = require('../../services/api/index');
                        const response = await stockService.getPickingDetails(req.odoo_id);
                        if (response.data.success) {
                            const picking = response.data.picking;
                            const remoteRequest = {
                                ...fullRequest,
                                state: picking.state,
                                name: picking.name,
                                source_location_name: picking.location_name || fullRequest.source_location_name,
                                location_name: picking.location_dest_name || fullRequest.location_name,
                                lines: picking.lines.map((l: any) => ({
                                    ...l,
                                    product_name: l.product_name,
                                    qty: l.quantity
                                }))
                            };
                            setRequest(remoteRequest);
                            await db.runAsync('UPDATE sales_rep_request SET state = ?, name = ? WHERE local_id = ?', picking.state, picking.name, local_id);
                        }
                    } catch (remoteError) {
                        console.error("Failed to fetch remote picking details:", remoteError);
                    }
                }
            } else {
                Alert.alert(i18n.t('common.error'), "Request not found.");
                router.replace('/(drawer)/requests');
            }
        } catch (error) {
            console.error("Failed to load request details:", error);
            Alert.alert(i18n.t('common.error'), "Failed to load details.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [local_id, isOffline, isCreateMode]);

    // Load products on Create Mode
    useEffect(() => {
        if (isCreateMode) {
            loadProducts();
            if (salesRepProfile) {
                setSourceLocId(salesRepProfile.location_request_id || null);
                setDestLocId(salesRepProfile.default_location_id || null);
            }
        } else {
            loadRequestDetails();
        }
    }, [isCreateMode, salesRepProfile, loadRequestDetails]);

    const onRefresh = () => {
        setRefreshing(true);
        loadRequestDetails(false);
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

    const handleAddProduct = async (product: any) => {
        if (selectedProducts.some(p => p.id === product.id)) return;

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

    const handleSubmitRequest = async () => {
        if (!sourceLocId) {
            Alert.alert(i18n.t('common.error'), "Please select a source location.");
            return;
        }
        if (!destLocId) {
            Alert.alert(i18n.t('common.error'), "Please select a destination location.");
            return;
        }
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

            await submitStockRequest(lines, sourceLocId, destLocId);
            Alert.alert(i18n.t('common.success'), i18n.t('requests.submit_success'));
            router.replace('/(drawer)/requests');
        } catch (error: any) {
            Alert.alert(i18n.t('common.error'), error.message);
        }
    };

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

    const filteredProducts = products.filter(p => {
        if (selectedProducts.some(sp => sp.id === p.id)) return false;
        const name = p.name || '';
        const code = p.default_code || '';
        return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            code.toLowerCase().includes(searchQuery.toLowerCase());
    });

    if (loading) {
        return (
            <View style={[styles.centered, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (isCreateMode) {
        // Parse source locations robustly (Request Source Locations)
        let parsedSourceLocs = [];
        const rawSourceLocs = salesRepProfile?.location_request_ids;
        if (Array.isArray(rawSourceLocs)) {
            parsedSourceLocs = rawSourceLocs;
        } else if (typeof rawSourceLocs === 'string') {
            try {
                parsedSourceLocs = JSON.parse(rawSourceLocs);
                if (!Array.isArray(parsedSourceLocs)) parsedSourceLocs = [];
            } catch (e) {
                console.warn("Failed to parse location_request_ids:", e);
            }
        }

        // Parse destination locations robustly (Default Stock Locations)
        let parsedDestLocs = [];
        const rawDestLocs = salesRepProfile?.default_location_ids;
        if (Array.isArray(rawDestLocs)) {
            parsedDestLocs = rawDestLocs;
        } else if (typeof rawDestLocs === 'string') {
            try {
                parsedDestLocs = JSON.parse(rawDestLocs);
                if (!Array.isArray(parsedDestLocs)) parsedDestLocs = [];
            } catch (e) {
                console.warn("Failed to parse default_location_ids:", e);
            }
        }

        const sourceItems = parsedSourceLocs.map((loc: any) => ({
            label: loc.name || loc.display_name || `Location #${loc.id}`,
            value: loc.id
        }));
        const destItems = parsedDestLocs.map((loc: any) => ({
            label: loc.name || loc.display_name || `Location #${loc.id}`,
            value: loc.id
        }));

        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.replace('/(drawer)/requests')} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>
                        {i18n.t('requests.new_request')}
                    </Text>
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
                    <View style={styles.formContainer}>
                        {/* Locations Pickers */}
                        <View style={[styles.locationCard, { backgroundColor: colors.card }]}>
                            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                                {i18n.t('requests.source_location')}
                            </Text>
                            <Dropdown
                                items={sourceItems}
                                selectedValue={sourceLocId}
                                onSelect={(val) => setSourceLocId(val as number)}
                                style={{ marginBottom: 16 }}
                            />

                            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                                {i18n.t('requests.destination_location')}
                            </Text>
                            <Dropdown
                                items={destItems}
                                selectedValue={destLocId}
                                onSelect={(val) => setDestLocId(val as number)}
                            />
                        </View>

                        {/* Selected Products */}
                        {selectedProducts.length > 0 && (
                            <View style={styles.selectedSection}>
                                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                                    {i18n.t('requests.selected_items')} ({selectedProducts.length})
                                </Text>
                                <View style={[styles.selectedList, { borderColor: colors.border, backgroundColor: colors.card }]}>
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
                                                    style={[styles.uomBadge, { backgroundColor: colors.background, borderColor: colors.border }]}
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
                                </View>
                            </View>
                        )}

                        {/* Search & Add Products */}
                        <Text style={[styles.sectionTitle, { color: colors.textSecondary, marginTop: 16 }]}>
                            {i18n.t('common.search_products')}
                        </Text>
                        <View style={styles.searchContainer}>
                            <Ionicons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
                            <TextInput
                                style={[styles.searchInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                                placeholder={i18n.t('common.search_products')}
                                placeholderTextColor={colors.subtext}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                            />
                        </View>

                        {loadingProducts ? (
                            <ActivityIndicator size="large" color={colors.primary} style={{ margin: 20 }} />
                        ) : (
                            <View style={[styles.productListCard, { backgroundColor: colors.card }]}>
                                {filteredProducts.map(item => (
                                    <TouchableOpacity
                                        key={item.id}
                                        style={[styles.productItem, { borderBottomColor: colors.border }]}
                                        onPress={() => handleAddProduct(item)}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.productName, { color: colors.text }]}>{item.name}</Text>
                                            <Text style={[styles.productCode, { color: colors.subtext }]}>{item.default_code || '---'}</Text>
                                        </View>
                                        <Ionicons name="add-circle" size={26} color={colors.primary} />
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

                    </View>
                </ScrollView>

                {/* Fixed Footer */}
                <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                    <TouchableOpacity
                        style={[
                            styles.submitButton,
                            { backgroundColor: colors.primary, opacity: selectedProducts.length > 0 ? 1 : 0.5 }
                        ]}
                        disabled={selectedProducts.length === 0}
                        onPress={handleSubmitRequest}
                    >
                        <Text style={styles.submitButtonText}>{i18n.t('common.submit')}</Text>
                    </TouchableOpacity>
                </View>

                {/* UoM Modal */}
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

    if (!request) return null;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.replace('/(drawer)/requests')} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                    {request.name || i18n.t('requests.request_details')}
                </Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView 
                style={styles.content}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
                }
            >
                <Animated.View entering={FadeIn} style={styles.cardContainer}>
                    {/* Status Section */}
                    <View style={[styles.statusCard, { backgroundColor: colors.card }]}>
                        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(request.state) + '20' }]}>
                            <Text style={[styles.statusText, { color: getStatusColor(request.state) }]}>
                                {(i18n.t(`requests.status.${request.state}`) || request.state).toUpperCase()}
                            </Text>
                        </View>
                        <Text style={[styles.dateText, { color: colors.subtext }]}>
                            {dayjs(request.date).format('MMMM D, YYYY [at] HH:mm')}
                        </Text>
                    </View>

                    {/* Info Section */}
                    <View style={[styles.infoSection, { backgroundColor: colors.card }]}>
                        <View style={styles.infoRow}>
                            <View style={styles.infoItem}>
                                <Text style={[styles.infoLabel, { color: colors.subtext }]}>{i18n.t('requests.source_location')}</Text>
                                <Text style={[styles.infoValue, { color: colors.text }]}>{request.source_location_name || '---'}</Text>
                            </View>
                        </View>
                        <View style={[styles.separator, { backgroundColor: colors.border }]} />
                        <View style={styles.infoRow}>
                            <View style={styles.infoItem}>
                                <Text style={[styles.infoLabel, { color: colors.subtext }]}>{i18n.t('requests.destination_location')}</Text>
                                <Text style={[styles.infoValue, { color: colors.text }]}>{request.location_name || '---'}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Items Section */}
                    <Text style={[styles.sectionTitle, { color: colors.subtext }]}>
                        {i18n.t('requests.items')} ({request.lines?.length || 0})
                    </Text>
                    <View style={[styles.itemsCard, { backgroundColor: colors.card }]}>
                        {(request.lines || []).map((line: any, index: number) => (
                            <View key={index}>
                                <View style={styles.itemRow}>
                                    <View style={styles.itemInfo}>
                                        <Text style={[styles.itemName, { color: colors.text }]}>{line.product_name}</Text>
                                        <Text style={[styles.itemSubtext, { color: colors.subtext }]}>
                                            {line.product_code || '---'}
                                        </Text>
                                    </View>
                                    <View style={styles.itemQtyContainer}>
                                        <Text style={[styles.itemQty, { color: colors.primary }]}>{line.qty || line.product_uom_qty}</Text>
                                        <Text style={[styles.itemUom, { color: colors.subtext }]}>{line.uom_name || ''}</Text>
                                    </View>
                                </View>
                                {index < request.lines.length - 1 && (
                                    <View style={[styles.itemSeparator, { backgroundColor: colors.border }]} />
                                )}
                            </View>
                        ))}
                    </View>

                    {request.notes ? (
                        <>
                            <Text style={[styles.sectionTitle, { color: colors.subtext }]}>
                                {i18n.t('common.notes')}
                            </Text>
                            <View style={[styles.notesCard, { backgroundColor: colors.card }]}>
                                <Text style={[styles.notesText, { color: colors.text }]}>{request.notes}</Text>
                            </View>
                        </>
                    ) : null}
                </Animated.View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
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
    content: {
        flex: 1,
    },
    formContainer: {
        padding: 16,
    },
    locationCard: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
    },
    fieldLabel: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 6,
        textTransform: 'uppercase',
    },
    selectedSection: {
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '700',
        marginLeft: 4,
        marginBottom: 8,
        textTransform: 'uppercase',
    },
    selectedList: {
        borderRadius: 12,
        borderWidth: 1,
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
        fontWeight: '500',
    },
    qtyControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    qtyText: {
        fontSize: 16,
        fontWeight: 'bold',
        marginHorizontal: 10,
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
    productListCard: {
        borderRadius: 16,
        paddingHorizontal: 16,
        marginBottom: 20,
    },
    productItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
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
    footer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 1,
    },
    submitButton: {
        height: 50,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    submitButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    cardContainer: {
        padding: 16,
    },
    statusCard: {
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        marginBottom: 16,
        elevation: 2,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    statusBadge: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 24,
        marginBottom: 12,
    },
    statusText: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    dateText: {
        fontSize: 14,
    },
    infoSection: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
    },
    infoRow: {
        paddingVertical: 8,
    },
    infoItem: {
        gap: 4,
    },
    infoLabel: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
    },
    infoValue: {
        fontSize: 16,
        fontWeight: '500',
    },
    separator: {
        height: 1,
        marginVertical: 8,
    },
    itemsCard: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
    },
    itemRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
    },
    itemInfo: {
        flex: 1,
        marginRight: 16,
    },
    itemName: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 2,
    },
    itemSubtext: {
        fontSize: 12,
    },
    itemQtyContainer: {
        alignItems: 'flex-end',
    },
    itemQty: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    itemUom: {
        fontSize: 12,
    },
    itemSeparator: {
        height: 1,
    },
    notesCard: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
    },
    notesText: {
        fontSize: 14,
        lineHeight: 20,
    },
    uomModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    uomModalContent: {
        width: '90%',
        maxHeight: '70%',
        borderRadius: 24,
        padding: 24,
        elevation: 10,
        shadowOffset: { width: 0, height: 15 },
        shadowOpacity: 0.4,
        shadowRadius: 25,
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
    }
});
