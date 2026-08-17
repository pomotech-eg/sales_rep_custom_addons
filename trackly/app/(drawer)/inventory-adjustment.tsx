import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, ScrollView,
    BackHandler
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { getInventoryAdjustmentProducts, getUoMsByCategory } from '../../services/database/repositories';
import { useRouter } from 'expo-router';
import i18n from '../../i18n';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CustomAlert } from '../../components/CustomAlert';
import { Dropdown } from '../../components/CustomDropdown';

export default function InventoryAdjustmentScreen() {
    const { colors } = useThemeStore();
    const router = useRouter();
    const { salesRepProfile, submitInventoryAdjustment } = useOfflineStore();
    
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [counts, setCounts] = useState<{ [productId: number]: string }>({});
    const [selectedUoMs, setSelectedUoMs] = useState<{ [productId: number]: { id: number, name: string } }>({});
    const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [focusedProductId, setFocusedProductId] = useState<number | null>(null);
    const inputRefs = useRef<{ [key: number]: any }>({});
    const searchInputRef = useRef<any>(null);

    // UoM Modal state
    const [uomModalVisible, setUomModalVisible] = useState(false);
    const [currentProductForUoM, setCurrentProductForUoM] = useState<any>(null);
    const [availableUoMs, setAvailableUoMs] = useState<any[]>([]);
    const [showDiscardAlert, setShowDiscardAlert] = useState(false);

    const handleBack = () => {
        const hasChanges = Object.values(counts).some(val => val !== '') || Object.keys(selectedUoMs).length > 0;
        if (hasChanges) {
            setShowDiscardAlert(true);
        } else {
            router.back();
        }
    };

    useEffect(() => {
        const backAction = () => {
            const hasChanges = Object.values(counts).some(val => val !== '') || Object.keys(selectedUoMs).length > 0;
            if (hasChanges) {
                setShowDiscardAlert(true);
                return true;
            }
            return false;
        };

        const backHandler = BackHandler.addEventListener(
            'hardwareBackPress',
            backAction
        );

        return () => backHandler.remove();
    }, [counts, selectedUoMs]);

    useEffect(() => {
        loadProducts();
        // Focus search bar on mount
        setTimeout(() => {
            searchInputRef.current?.focus();
        }, 300);
    }, []);

    useEffect(() => {
        if (salesRepProfile) {
            setSelectedLocationId(salesRepProfile.default_location_id || null);
        }
    }, [salesRepProfile]);

    const loadProducts = async () => {
        setLoading(true);
        try {
            const data = await getInventoryAdjustmentProducts();
            setProducts(data);
        } catch (e) {
            console.error("Failed to load products for adjustment:", e);
        } finally {
            setLoading(false);
        }
    };

    const handleCountChange = (productId: number, text: string) => {
        // Only allow numbers and one decimal point
        const cleaned = text.replace(/[^0-9.]/g, '');
        if ((cleaned.match(/\./g) || []).length > 1) return;
        
        setCounts(prev => ({
            ...prev,
            [productId]: cleaned
        }));
    };

    const openUoMSelection = async (product: any) => {
        setCurrentProductForUoM(product);
        try {
            const uoms = await getUoMsByCategory(product.uom_category_id);
            setAvailableUoMs(uoms);
            setUomModalVisible(true);
        } catch (e) {
            console.error("Failed to load UoMs:", e);
            Alert.alert(i18n.t('common.error'), "Failed to load compatible Units of Measure.");
        }
    };

    const selectUoM = (uom: any) => {
        if (!currentProductForUoM) return;
        
        setSelectedUoMs(prev => ({
            ...prev,
            [currentProductForUoM.odoo_id]: { id: uom.odoo_id, name: uom.name }
        }));
        setUomModalVisible(false);
        setCurrentProductForUoM(null);
    };

    const handleSubmit = async () => {
        if (!selectedLocationId) {
            Alert.alert(i18n.t('common.error'), "Please select a stock location.");
            return;
        }

        // Include ALL products — default to 0 if no count was entered
        const lines = products.map((product: any) => {
            const selectedUoM = selectedUoMs[product.odoo_id];
            const enteredQty = counts[product.odoo_id];
            
            return {
                product_id: product.odoo_id,
                product_uom_id: selectedUoM ? selectedUoM.id : product.uom_id,
                counted_qty: (enteredQty !== undefined && enteredQty !== '') ? parseFloat(enteredQty) : 0
            };
        });

        if (lines.length === 0) {
            Alert.alert(i18n.t('common.warning'), i18n.t('inventory.no_products_to_submit') || "No products available to submit.");
            return;
        }

        Alert.alert(
            i18n.t('inventory.confirm_title') || "Confirm Adjustment",
            (i18n.t as any)('inventory.confirm_message', { count: lines.length }) || `Submit counts for ${lines.length} products?`,
            [
                { text: i18n.t('common.cancel'), style: 'cancel' },
                {
                    text: i18n.t('common.submit'),
                    onPress: async () => {
                        setSubmitting(true);
                        try {
                            const result = await submitInventoryAdjustment(lines, selectedLocationId);
                            if (result?.success) {
                                Alert.alert(i18n.t('common.success'), i18n.t('inventory.submit_success') || "Inventory adjustment submitted successfully.");
                                // Reset all values to 0/empty after successful submission
                                setCounts({});
                                setSelectedUoMs({});
                                // Optionally go back or stay based on workflow
                                router.back();
                            } else {
                                throw new Error(result?.message || "Failed to submit adjustment.");
                            }
                        } catch (e: any) {
                            Alert.alert(i18n.t('common.error'), e.message);
                        } finally {
                            setSubmitting(false);
                        }
                    }
                }
            ]
        );
    };

    const filteredProducts = products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             (p.default_code && p.default_code.toLowerCase().includes(searchQuery.toLowerCase()));
        
        return matchesSearch;
    });

    useEffect(() => {
        // Auto-focus the first product if only one is shown (e.g. after search)
        if (filteredProducts.length === 1 && searchQuery.length > 2) {
            const timer = setTimeout(() => {
                const firstProduct = filteredProducts[0];
                if (inputRefs.current[firstProduct.odoo_id]) {
                    inputRefs.current[firstProduct.odoo_id].focus();
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [filteredProducts.length, searchQuery]);

    const renderItem = ({ item, index }: { item: any, index: number }) => {
        const currentUoMName = selectedUoMs[item.odoo_id]?.name || item.uom_name;
        
        return (
            <Animated.View 
                entering={FadeInDown.delay(index * 20).duration(300)}
                style={[styles.productCard, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
            >
                <TouchableOpacity 
                    style={styles.productInfo} 
                    onPress={() => inputRefs.current[item.odoo_id]?.focus()}
                    activeOpacity={0.7}
                >
                    <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>{item.name}</Text>
                    {/* <Text style={[styles.productCode, { color: colors.textSecondary }]}>{item.default_code || i18n.t('product.no_code')}</Text> */}
                </TouchableOpacity>
                <View style={styles.inputContainer}>
                    <TextInput
                        ref={(ref) => { if (ref) inputRefs.current[item.odoo_id] = ref; }}
                        style={[styles.qtyInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={colors.textSecondary}
                        value={counts[item.odoo_id] || ''}
                        onChangeText={(text) => handleCountChange(item.odoo_id, text)}
                        onFocus={() => setFocusedProductId(item.odoo_id)}
                        onBlur={() => setFocusedProductId(null)}
                        returnKeyType="done"
                    />
                    <TouchableOpacity 
                        style={styles.uomSelector}
                        onPress={() => openUoMSelection(item)}
                    >
                        <Text style={[styles.uomText, { color: colors.primary }]}>{currentUoMName}</Text>
                        <Ionicons name="chevron-down" size={14} color={colors.primary} />
                    </TouchableOpacity>
                </View>
            </Animated.View>
        );
    };

    // Parse destination locations robustly (Default Stock Locations)
    let parsedDestLocs: any[] = [];
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

    const locationItems = parsedDestLocs.map((loc: any) => ({
        label: loc.name || loc.display_name || `Location #${loc.id}`,
        value: loc.id
    }));

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>{i18n.t('drawer.inventory_adjustment')}</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                    {i18n.t('requests.destination_location') || "Stock Location"}
                </Text>
                <Dropdown
                    items={locationItems}
                    selectedValue={selectedLocationId}
                    onSelect={(val) => setSelectedLocationId(val as number)}
                />
            </View>

            <View style={styles.searchContainer}>
                <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="search-outline" size={20} color={colors.textSecondary} style={{ marginRight: 10 }} />
                    <TextInput
                        ref={searchInputRef}
                        style={[styles.searchInput, { color: colors.text }]}
                        placeholder={i18n.t('common.search_products') || "Search products..."}
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

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <KeyboardAvoidingView 
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
                    style={{ flex: 1 }}
                >
                    <FlatList
                        data={filteredProducts}
                        keyExtractor={item => item.odoo_id.toString()}
                        renderItem={renderItem}
                        contentContainerStyle={styles.listContent}
                        keyboardShouldPersistTaps="handled"
                        ListEmptyComponent={
                            <View style={styles.centered}>
                                <Ionicons name="cube-outline" size={64} color={colors.textSecondary} />
                                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                    {i18n.t('inventory.no_products') || "No products found."}
                                </Text>
                            </View>
                        }
                    />
                    
                    <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                        <TouchableOpacity 
                            style={[styles.submitButton, { backgroundColor: colors.primary }]}
                            onPress={handleSubmit}
                            disabled={submitting}
                        >
                            {submitting ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="checkmark-circle-outline" size={24} color="#fff" style={{ marginRight: 8 }} />
                                    <Text style={styles.submitButtonText}>{i18n.t('common.submit')}</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            )}

            {/* UoM Selection Modal */}
            <Modal
                visible={uomModalVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setUomModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                            <Text style={[styles.modalTitle, { color: colors.text }]}>
                                {i18n.t('product.select_uom') || "Select Unit of Measure"}
                            </Text>
                            <TouchableOpacity onPress={() => setUomModalVisible(false)}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.uomList}>
                            {availableUoMs.map((uom) => (
                                <TouchableOpacity
                                    key={uom.odoo_id}
                                    style={[
                                        styles.uomItem,
                                        { borderBottomColor: colors.border },
                                        (selectedUoMs[currentProductForUoM?.odoo_id]?.id === uom.odoo_id || (!selectedUoMs[currentProductForUoM?.odoo_id] && currentProductForUoM?.uom_id === uom.odoo_id)) && { backgroundColor: colors.primary + '10' }
                                    ]}
                                    onPress={() => selectUoM(uom)}
                                >
                                    <Text style={[
                                        styles.uomItemText,
                                        { color: colors.text },
                                        (selectedUoMs[currentProductForUoM?.odoo_id]?.id === uom.odoo_id || (!selectedUoMs[currentProductForUoM?.odoo_id] && currentProductForUoM?.uom_id === uom.odoo_id)) && { color: colors.primary, fontWeight: 'bold' }
                                    ]}>
                                        {uom.name}
                                    </Text>
                                    {(selectedUoMs[currentProductForUoM?.odoo_id]?.id === uom.odoo_id || (!selectedUoMs[currentProductForUoM?.odoo_id] && currentProductForUoM?.uom_id === uom.odoo_id)) && (
                                        <Ionicons name="checkmark" size={20} color={colors.primary} />
                                    )}
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            <CustomAlert
                visible={showDiscardAlert}
                title={i18n.t('common.discard_changes_title') || "Discard Changes"}
                message={i18n.t('common.discard_changes_msg') || "Are you sure you want to discard all unsaved changes?"}
                onConfirm={() => {
                    setShowDiscardAlert(false);
                    router.back();
                }}
                onCancel={() => setShowDiscardAlert(false)}
                confirmText={i18n.t('common.discard') || "Discard"}
                confirmColor="red"
                cancelText={i18n.t('common.cancel') || "Cancel"}
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
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    searchContainer: {
        padding: 16,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        height: 48,
        borderRadius: 12,
        borderWidth: 1,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
    },
    listContent: {
        paddingBottom: 100,
    },
    productCard: {
        flexDirection: 'row',
        padding: 16,
        borderBottomWidth: 1,
        alignItems: 'center',
    },
    productInfo: {
        flex: 1,
        marginRight: 12,
    },
    productName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    productCode: {
        fontSize: 12,
        marginBottom: 4,
    },
    theoreticalQty: {
        fontSize: 12,
        fontWeight: '500',
    },
    inputContainer: {
        width: 100,
    },
    qtyInput: {
        height: 45,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        textAlign: 'center',
        fontSize: 18,
        fontWeight: 'bold',
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        borderTopWidth: 1,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    submitButton: {
        height: 54,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    emptyText: {
        marginTop: 16,
        fontSize: 16,
        textAlign: 'center',
    },
    uomSelector: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 4,
    },
    uomText: {
        fontSize: 14,
        fontWeight: '600',
        marginRight: 2,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '70%',
        paddingBottom: 40,
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
    uomList: {
        paddingHorizontal: 20,
    },
    uomItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    uomItemText: {
        fontSize: 16,
    },
    toggleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        marginLeft: 8,
    },
    toggleText: {
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
    fieldLabel: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 6,
        textTransform: 'uppercase',
    }
});
