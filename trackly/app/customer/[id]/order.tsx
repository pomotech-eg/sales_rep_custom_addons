import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Image, ActivityIndicator, Alert, ScrollView, Modal } from 'react-native';
import { CustomAlert } from '../../../components/CustomAlert';
import BottomSheetModal from '../../../components/BottomSheetModal';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useThemeStore } from '../../../store/useThemeStore';
import { useCartStore } from '../../../store/useCartStore';
import { useOfflineStore } from '../../../store/useOfflineStore';
import { Ionicons } from '@expo/vector-icons';
import { getProducts, searchProducts, createLocalOrder, insertPendingAction, addLocalOrderLine, getSalesRepresentative, getOrderLines, calculateProductPrice, applyOrderPromotions, getUomsByCategory, getLocalUnsyncedOrdersTotal } from '../../../services/database/repositories';
import { SPACING, RADIUS } from '../../../theme'; // Adjust import path
import dayjs from 'dayjs';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '@/i18n';
import { Dropdown } from '../../../components/CustomDropdown';

export default function CustomerOrder() {
    const { id, editOrderId } = useLocalSearchParams<{ id: string, editOrderId?: string }>();
    const { colors } = useThemeStore();
    const router = useRouter();
    const { currentRoute, currentRouteCustomers, performSync, isOffline, endVisit, salesRepProfile } = useOfflineStore();
    const { items, addItem, removeItem, updateQuantity, updateUom, clearCart, getTotal, getSubtotal, getTaxTotal } = useCartStore();

    useEffect(() => {
        if (salesRepProfile && salesRepProfile.access_visit_order === 0) {
            Alert.alert(i18n.t('common.error'), i18n.t('common.access_denied'));
            router.back();
        }
    }, [salesRepProfile]);
    const [uomPickerVisible, setUomPickerVisible] = useState(false);
    const [selectedCartItem, setSelectedCartItem] = useState<any>(null);
    const [availableUoms, setAvailableUoms] = useState<any[]>([]);


    // Customer State
    const [customer, setCustomer] = useState<any>(null);
    const [customerLoading, setCustomerLoading] = useState(true);

    // Product/Order State
    // Product/Order State
    interface ProductDisplayItem {
        type: 'product' | 'group';
        id: number; // odoo_id or template_id
        name: string;
        data?: any; // for single product
        variants?: any[]; // for group
        isExpanded?: boolean;
    }

    const [products, setProducts] = useState<ProductDisplayItem[]>([]);
    const [allProducts, setAllProducts] = useState<ProductDisplayItem[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
    const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
    const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);

    const productCategories = React.useMemo(() => {
        if (salesRepProfile && salesRepProfile.product_category_ids) {
            try {
                const parsed = typeof salesRepProfile.product_category_ids === 'string'
                    ? JSON.parse(salesRepProfile.product_category_ids)
                    : salesRepProfile.product_category_ids;
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            } catch (e) {
                console.error("Failed to parse product categories:", e);
            }
        }
        return [];
    }, [salesRepProfile]);
    const [cartVisible, setCartVisible] = useState(false);
    const [initialProductIds, setInitialProductIds] = useState<Set<string>>(new Set());
    const [initialQuantities, setInitialQuantities] = useState<{ [cartKey: string]: number }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [unsyncedTotal, setUnsyncedTotal] = useState(0);
    const [selectedLocationId, setSelectedLocationId] = useState<string>('');
    const [locationsList, setLocationsList] = useState<any[]>([]);

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

    const [previewImage, setPreviewImage] = useState<string | null>(null);

    const showAlert = (config: Omit<typeof alertConfig, 'visible'>) => {
        setAlertConfig({ ...config, visible: true });
    };

    useEffect(() => {
        const fetchCustomer = async () => {
            if (id) {
                // 1. Try from store (current route)
                const foundCustomer = currentRouteCustomers.find(c => c.id.toString() === id);
                if (foundCustomer) {
                    setCustomer(foundCustomer);
                } else {
                    // 2. Try fetching from DB directly (fallback)
                    console.log(`Customer ${id} not in current route, fetching from DB...`);
                    try {
                        const { getRouteCustomer } = require('../../../services/database/repositories');
                        const dbCustomer = await getRouteCustomer(parseInt(id));
                        if (dbCustomer) {
                            setCustomer(dbCustomer);
                        } else {
                            console.warn(`Customer ${id} not found in DB`);
                        }
                    } catch (e) {
                        console.error("Error fetching customer fallback:", e);
                    }
                }
                setCustomerLoading(false);

                // Fetch unsynced total for this customer
                try {
                    const total = await getLocalUnsyncedOrdersTotal(parseInt(id));
                    setUnsyncedTotal(total);
                } catch (e) {
                    console.error("Error fetching unsynced total:", e);
                }
            }
        };
        fetchCustomer();
    }, [id, currentRouteCustomers]);

    useEffect(() => {
        clearCart(); // Ensure a fresh state when entering
        // loadProducts will be triggered by customer useEffect once loaded
    }, []);

    useEffect(() => {
        if (customer) {
            loadProducts(selectedLocationId);
        }
    }, [customer, selectedLocationId]);

    useEffect(() => {
        const loadExistingOrder = async () => {
            if (editOrderId) {
                console.log("Loading existing order lines for editing:", editOrderId);
                const orderRef = /^\d+$/.test(editOrderId) ? parseInt(editOrderId, 10) : editOrderId;
                try {
                    const lines = await getOrderLines(orderRef);
                    const existingIds = new Set<string>();
                    const existingQtys: { [cartKey: string]: number } = {};
                    lines.forEach((line: any) => {
                        // Map DB line to CartItem
                        addItem({
                            odoo_id: line.product_id,
                            name: line.product_name,
                            list_price: line.price_unit,
                            free_qty: 99999, // Allow editing regardless of current free_qty
                        }, line.product_uom_qty, line.location_id, line.location_name);
                        
                        const existingKey = `${line.product_id}_${line.location_id || 0}`;
                        existingIds.add(existingKey);
                        existingQtys[existingKey] = line.product_uom_qty;
                    });
                    setInitialProductIds(existingIds);
                    setInitialQuantities(existingQtys);
                } catch (e) {
                    console.error("Failed to load existing order lines:", e);
                }
            }
        };
        loadExistingOrder();
    }, [editOrderId]);

    const groupProducts = (productList: any[]): ProductDisplayItem[] => {
        const groups: { [key: number]: any[] } = {};
        const singles: any[] = [];

        productList.forEach(p => {
            if (p.product_tmpl_id) {
                if (!groups[p.product_tmpl_id]) {
                    groups[p.product_tmpl_id] = [];
                }
                groups[p.product_tmpl_id].push(p);
            } else {
                singles.push(p);
            }
        });

        const displayItems: ProductDisplayItem[] = [];

        Object.keys(groups).forEach(tmplId => {
            const variants = groups[parseInt(tmplId)];
            if (variants.length === 1) {
                displayItems.push({
                    type: 'product',
                    id: variants[0].odoo_id,
                    name: variants[0].name,
                    data: variants[0]
                });
            } else {
                displayItems.push({
                    type: 'group',
                    id: parseInt(tmplId),
                    name: variants[0].name.split('(')[0].trim(),
                    variants: variants,
                    isExpanded: false
                });
            }
        });

        singles.forEach(s => {
            displayItems.push({
                type: 'product',
                id: s.odoo_id,
                name: s.name,
                data: s
            });
        });

        return displayItems.sort((a, b) => a.name.localeCompare(b.name));
    };

    const loadProducts = async (locId?: string) => {
        setLoading(true);
        try {
            const activeLocId = locId || selectedLocationId;
            const parsedLocId = activeLocId ? parseInt(activeLocId) : undefined;
            const data = await getProducts(false, parsedLocId);
            console.log("Products data", data);
            
            // Apply customer-specific pricing if customer is loaded
            if (data && customer?.property_product_pricelist) {
                const pricelistId = customer.property_product_pricelist;
                console.log(`Applying pricelist ${pricelistId} to ${data.length} products`);
                await Promise.all(data.map(async (p: any) => {
                    p.list_price = await calculateProductPrice(p.odoo_id, pricelistId, 1);
                }));
            }

            if (data) {
                const grouped = groupProducts(data);
                console.log("Grouped products", grouped);
                setAllProducts(grouped);
                setProducts(grouped);
            }
        } catch (error) {
            console.error("Failed to load products", error);
        } finally {
            setLoading(false);
        }
    };


    useEffect(() => {
        let filtered = allProducts;

        if (selectedCategoryId !== null) {
            filtered = filtered.filter(item => {
                if (item.type === 'product') {
                    return item.data?.categ_id === selectedCategoryId;
                } else if (item.type === 'group') {
                    return item.variants && item.variants.some(v => v.categ_id === selectedCategoryId);
                }
                return false;
            });
        }

        if (stockFilter !== 'all') {
            filtered = filtered.map(item => {
                if (item.type === 'product') {
                    const isMatch = stockFilter === 'in_stock'
                        ? (item.data?.free_qty || 0) > 0
                        : (item.data?.free_qty || 0) <= 0;
                    return isMatch ? item : null;
                } else if (item.type === 'group') {
                    const matchingVariants = item.variants?.filter(v =>
                        stockFilter === 'in_stock'
                            ? (v.free_qty || 0) > 0
                            : (v.free_qty || 0) <= 0
                    ) || [];
                    return matchingVariants.length > 0
                        ? { ...item, variants: matchingVariants }
                        : null;
                }
                return null;
            }).filter((item): item is ProductDisplayItem => item !== null);
        }

        if (searchQuery) {
            const lowQuery = searchQuery.toLowerCase();
            filtered = filtered.filter(item =>
                item.name.toLowerCase().includes(lowQuery) ||
                (item.variants && item.variants.some(v => v.display_name?.toLowerCase().includes(lowQuery) || v.default_code?.toLowerCase().includes(lowQuery)))
            );
        }

        setProducts(filtered);
    }, [allProducts, selectedCategoryId, searchQuery, stockFilter]);

    const handleSearch = (text: string) => {
        setSearchQuery(text);
    };

    const activeFilterCount = (selectedCategoryId !== null ? 1 : 0) + (stockFilter !== 'all' ? 1 : 0);

    const clearAllFilters = () => {
        setSelectedCategoryId(null);
        setStockFilter('all');
    };

    const toggleGroup = (id: number) => {
        setProducts(prev => prev.map(item =>
            item.id === id && item.type === 'group'
                ? { ...item, isExpanded: !item.isExpanded }
                : item
        ));
    };

    const getVariantCleanName = (variantDisplayName: string, parentName: string) => {
        if (!variantDisplayName) return '';
        // 1. Try to extract content inside the LAST parentheses (Odoo attributes format)
        const match = variantDisplayName.match(/\(([^)]+)\)$/);
        if (match) {
            return match[1];
        }
        // 2. Fallback: Remove parent name and any [CODE]
        let cleaned = variantDisplayName.replace(parentName, '').trim();
        cleaned = cleaned.replace(/^\[[^\]]+\]/, '').trim();
        cleaned = cleaned.replace(/^[(\s,)-]+|[)\s,)-]+$/g, '').trim();
        return cleaned || variantDisplayName;
    };

    const renderProductItem = ({ item }: { item: ProductDisplayItem }) => {
        const getImageUrl = (url: string) => {
            if (!url) return undefined;
            if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
            try {
                const { useAuthStore } = require('../../../store/useAuthStore');
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

        if (item.type === 'group') {
            const variants = item.variants || [];
            const isExpanded = item.isExpanded;

            return (
                <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <TouchableOpacity
                        style={styles.groupHeader}
                        onPress={() => toggleGroup(item.id)}
                        activeOpacity={0.7}
                    >
                        <View style={[styles.productImagePlaceholder, { backgroundColor: colors.background, overflow: 'hidden' }]}>
                            {variants[0]?.image_url ? (
                                <Image source={{ uri: getImageUrl(variants[0].image_url) }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
                            ) : (
                                <Ionicons name="layers-outline" size={24} color={colors.primary} />
                            )}
                        </View>
                        <View style={styles.productInfo}>
                            <Text style={[styles.groupName, { color: colors.text }]}>{item.name}</Text>
                            <Text style={[styles.groupCount, { color: colors.textSecondary }]}>{variants.length} {i18n.t('order.variants')}</Text>
                        </View>
                        <Ionicons
                            name={isExpanded ? "chevron-up" : "chevron-down"}
                            size={20}
                            color={colors.textSecondary}
                        />
                    </TouchableOpacity>

                    {isExpanded && (
                        <View style={styles.variantsList}>
                            {variants.map(variant => {
                                const currentLocId = selectedLocationId ? parseInt(selectedLocationId) : 0;
                                const cartKey = `${variant.odoo_id}_${currentLocId}`;
                                const cartItem = items.find(i => i.cartKey === cartKey);
                                const isOutOfStock = (variant.free_qty || 0) <= 0;
                                const qty = cartItem?.quantity || 0;

                                return (
                                    <View
                                        key={variant.odoo_id}
                                        style={[styles.variantRow, { borderTopColor: colors.border }]}
                                    >
                                        <View style={{ flex: 1, marginRight: 8 }}>
                                            <Text style={[styles.variantName, { color: colors.text }]} numberOfLines={1}>
                                                {getVariantCleanName(variant.display_name || variant.name, item.name)}
                                            </Text>
                                            <View style={styles.variantMeta}>
                                                <Text style={[styles.variantPrice, { color: colors.primary }]}>{i18n.t('common.currency_symbol')}{variant.list_price.toFixed(2)}</Text>
                                                <View style={[styles.stockBadge, { backgroundColor: isOutOfStock ? colors.danger + '20' : colors.success + '20' }]}>
                                                    <Text style={[styles.stockText, { color: isOutOfStock ? colors.danger : colors.success }]}>
                                                        {isOutOfStock ? '0' : variant.free_qty}
                                                    </Text>
                                                </View>
                                                <Text style={[styles.variantUom, { color: colors.textSecondary }]}>{variant.uom_name}</Text>
                                            </View>
                                        </View>

                                        {isOutOfStock ? (
                                            <View style={styles.outOfStockAction}>
                                                <Ionicons name="ban-outline" size={20} color={colors.textSecondary} />
                                            </View>
                                        ) : (
                                            <View style={styles.qtyControlsSmall}>
                                                {qty > 0 && (
                                                    <>
                                                        <TouchableOpacity onPress={() => updateQuantity(cartKey, qty - 1)}>
                                                            <Ionicons name="remove-circle" size={26} color={colors.danger} />
                                                        </TouchableOpacity>
                                                        <TextInput
                                                            style={[styles.qtyTextSmall, { color: colors.text, textAlign: 'center', minWidth: 30 }]}
                                                            value={String(qty)}
                                                            keyboardType="numeric"
                                                            onChangeText={(text) => {
                                                                const parsed = parseInt(text) || 0;
                                                                updateQuantity(cartKey, parsed);
                                                            }}
                                                            selectTextOnFocus
                                                        />
                                                    </>
                                                )}
                                                <TouchableOpacity 
                                                    onPress={() => {
                                                        const locName = locationsList.find(l => l.id.toString() === selectedLocationId)?.name;
                                                        const added = addItem({ ...variant, name: variant.display_name || variant.name }, 1, currentLocId, locName);
                                                        if (!added) {
                                                            showAlert({
                                                                title: i18n.t('order.location_mismatch_title'),
                                                                message: i18n.t('order.location_mismatch_msg'),
                                                                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                                                            });
                                                        }
                                                    }}
                                                    disabled={qty >= (variant.free_qty || 0)}
                                                    style={qty >= (variant.free_qty || 0) && { opacity: 0.5 }}
                                                >
                                                    <Ionicons name="add-circle" size={26} color={qty >= (variant.free_qty || 0) ? colors.textSecondary : colors.primary} />
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>
            );
        }

        const product = item.data;
        const currentLocId = selectedLocationId ? parseInt(selectedLocationId) : 0;
        const cartKey = `${product.odoo_id}_${currentLocId}`;
        const cartItem = items.find(i => i.cartKey === cartKey);
        const isOutOfStock = (product.free_qty || 0) <= 0;
        const qty = cartItem?.quantity || 0;



        return (
            <View style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity onPress={() => openImagePreview(product.image_url)} style={[styles.productImageWrapper, { backgroundColor: colors.background }]}>
                    {product.image_url ? (
                        <Image source={{ uri: getImageUrl(product.image_url) }} style={styles.productImage} />
                    ) : (
                        <Ionicons name="cube-outline" size={32} color={colors.textSecondary} />
                    )}
                    {isOutOfStock && (
                        <View style={styles.outOfStockOverlay}>
                            <Text style={styles.outOfStockLabel}>{i18n.t('order.out_of_stock')}</Text>
                        </View>
                    )}
                </TouchableOpacity>

                <View style={styles.productContent}>
                    <View style={styles.productMainInfo}>
                        <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>{product.name}</Text>
                        <Text style={[styles.productCode, { color: colors.textSecondary }]}>{product.default_code}</Text>
                    </View>

                    <View style={styles.productFooter}>
                        <View>
                            <Text style={[styles.productPrice, { color: colors.primary }]}>{i18n.t('common.currency_symbol')}{product.list_price.toFixed(2)}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={[styles.uomText, { color: colors.textSecondary }]}>{product.uom_name}</Text>
                                <View style={[styles.stockBadge, { backgroundColor: isOutOfStock ? colors.danger + '15' : colors.success + '15', paddingHorizontal: 4, borderRadius: 4 }]}>
                                    <Text style={[styles.stockText, { color: isOutOfStock ? colors.danger : colors.success, fontSize: 10 }]}>
                                        {isOutOfStock ? '0' : (product.free_qty).toFixed(2).replace(/\.?0+$/, '')}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {isOutOfStock ? null : (
                            <View style={styles.qtyControlsLarge}>
                                {qty > 0 && (
                                    <>
                                        <TouchableOpacity onPress={() => updateQuantity(cartKey, qty - 1)}>
                                            <Ionicons name="remove-circle-outline" size={28} color={colors.danger} />
                                        </TouchableOpacity>
                                        <TextInput
                                            style={[styles.qtyTextLarge, { color: colors.text, textAlign: 'center', minWidth: 40 }]}
                                            value={String(qty)}
                                            keyboardType="numeric"
                                            onChangeText={(text) => {
                                                const parsed = parseInt(text) || 0;
                                                updateQuantity(cartKey, parsed);
                                            }}
                                            selectTextOnFocus
                                        />
                                    </>
                                )}
                                <TouchableOpacity onPress={() => {
                                    const locName = locationsList.find(l => l.id.toString() === selectedLocationId)?.name;
                                    const added = addItem(product, 1, currentLocId, locName);
                                    if (!added) {
                                        showAlert({
                                            title: i18n.t('order.location_mismatch_title'),
                                            message: i18n.t('order.location_mismatch_msg'),
                                            onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                                        });
                                    }
                                }}>
                                    <Ionicons name="add-circle" size={32} color={colors.primary} />
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                </View>
            </View>
        );
    };

    const renderCartItem = ({ item }: { item: any }) => {
        const cartItem = items.find(i => i.cartKey === item.cartKey);
        const freeQty = cartItem?.free_qty || 0;
        const isMaxReached = freeQty > 0 && item.quantity >= freeQty;

        return (
            <View style={[styles.cartItem, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.cartItemName, { color: colors.text }]}>
                        {item.name}
                    </Text>
                    <TouchableOpacity 
                        style={styles.cartUomButton}
                        onPress={async () => {
                            if (item.uom_category_id) {
                                const uoms = await getUomsByCategory(item.uom_category_id);
                                setAvailableUoms(uoms);
                                setSelectedCartItem(item);
                                setUomPickerVisible(true);
                            }
                        }}
                    >
                        <Text style={[styles.cartItemPrice, { color: colors.textSecondary }]}>
                            {i18n.t('common.currency_symbol')}{item.price.toFixed(2)} x {item.quantity} {item.uom_name}
                            {item.uom_category_id && <Ionicons name="caret-down" size={12} color={colors.textSecondary} style={{ marginLeft: 4 }} />}
                        </Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.qtyControls}>
                    <TouchableOpacity onPress={() => updateQuantity(item.cartKey, item.quantity - 1)}>
                        <Ionicons name="remove-circle-outline" size={24} color={colors.danger} />
                    </TouchableOpacity>
                    <TextInput
                        style={[styles.cartItemQty, { color: colors.text, textAlign: 'center', minWidth: 35 }]}
                        value={String(item.quantity)}
                        keyboardType="numeric"
                        onChangeText={(text) => {
                            const parsed = parseInt(text) || 0;
                            updateQuantity(item.cartKey, parsed);
                        }}
                        selectTextOnFocus
                    />
                    <TouchableOpacity
                        onPress={() => !isMaxReached && updateQuantity(item.cartKey, item.quantity + 1)}
                        disabled={isMaxReached}
                        style={isMaxReached && { opacity: 0.5 }}
                    >
                        <Ionicons name="add-circle-outline" size={24} color={isMaxReached ? colors.textSecondary : colors.success} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    if (customerLoading) {
        return (
            <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (!customer) {
        return (
            <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ color: colors.text }}>{i18n.t('customer.not_found')}</Text>
            </View>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.headerContainer, { borderBottomColor: colors.border }]}>
                {/* Left: Back Button */}
                <View style={styles.headerLeft}>
                    <TouchableOpacity onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                </View>

                {/* Center: Title */}
                <View style={styles.headerCenter}>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>{editOrderId ? i18n.t('order.add_product') : i18n.t('order.title')}</Text>
                    <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{customer.name}</Text>
                </View>

                {/* Right: Cart Button */}
                <View style={styles.headerRight}>
                    <TouchableOpacity onPress={() => setCartVisible(!cartVisible)}>
                        <View>
                            <Ionicons name="cart-outline" size={26} color={colors.text} />
                            {items.length > 0 && (
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{items.reduce((acc, i) => acc + i.quantity, 0)}</Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>
                </View>
            </View>




            <View style={[styles.searchSection, { backgroundColor: colors.card }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, gap: 12 }}>
                    <View style={[styles.searchBar, { backgroundColor: colors.background, flex: 1, marginHorizontal: 0 }]}>
                        <Ionicons name="search" size={20} color={colors.textSecondary} />
                        <TextInput
                            style={[styles.searchInput, { color: colors.text }]}
                            placeholder={i18n.t('order.search_products')}
                            placeholderTextColor={colors.textSecondary}
                            value={searchQuery}
                            onChangeText={handleSearch}
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => handleSearch('')}>
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
            </View>

            {loading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={{ color: colors.textSecondary, marginTop: 12 }}>{i18n.t('order.syncing_catalog')}</Text>
                </View>
            ) : (
                <FlatList
                    data={products}
                    keyExtractor={(item) => `${item.type}_${item.id}`}
                    renderItem={renderProductItem}
                    contentContainerStyle={[styles.listContent, items.length > 0 && { paddingBottom: 100 }]}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Ionicons name="search-outline" size={64} color={colors.border} />
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{i18n.t('order.no_products')}</Text>
                            <TouchableOpacity style={[styles.retryButton, { borderColor: colors.primary }]} onPress={() => loadProducts()}>
                                <Text style={{ color: colors.primary }}>{i18n.t('order.reload_catalog')}</Text>
                            </TouchableOpacity>
                        </View>
                    }
                    style={{ flex: 1 }}
                />
            )}

            {/* Floating Cart Summary Bar */}
            {items.length > 0 && !cartVisible && (
                <TouchableOpacity
                    style={[styles.floatingCartBar, { backgroundColor: colors.primary, shadowColor: colors.primary }]}
                    onPress={() => setCartVisible(true)}
                    activeOpacity={0.9}
                >
                    <View style={styles.cartBarInfo}>
                        <View style={styles.cartBarBadge}>
                            <Text style={styles.cartBarBadgeText}>{i18n.t('order.items_count', { count: items.reduce((acc, i) => acc + i.quantity, 0) })}</Text>
                        </View>
                        <Text style={styles.cartBarTotal}>{i18n.t('order.total_amount', { symbol: i18n.t('common.currency_symbol'), amount: getTotal().toFixed(2) })}</Text>
                    </View>
                    <View style={styles.viewCartAction}>
                        <Text style={styles.viewCartText}>{i18n.t('order.view_cart')}</Text>
                        <Ionicons name="chevron-forward" size={18} color="#fff" />
                    </View>
                </TouchableOpacity>
            )}

            {/* Cart Summary / Modal */}
            <BottomSheetModal
                visible={cartVisible}
                onClose={() => setCartVisible(false)}
                title={`${i18n.t('order.cart')} (${items.length})`}
            >
                <View style={{ backgroundColor: colors.card }}>
                    {items.length === 0 ? (
                        <View style={styles.emptyCart}>
                            <Text style={{ color: colors.textSecondary }}>{i18n.t('order.cart_empty')}</Text>
                        </View>
                    ) : (
                        <View style={{ maxHeight: 500 }}>
                            {items.map((item) => (
                                <View key={item.cartKey}>
                                    {renderCartItem({ item })}
                                </View>
                            ))}
                        </View>
                    )}

                    <View style={[styles.cartFooter, { borderTopColor: colors.border }]}>
                        <View style={styles.row}>
                            <Text style={{ color: colors.textSecondary }}>{i18n.t('order.subtotal')}:</Text>
                            <Text style={{ color: colors.text }}>{i18n.t('common.currency_symbol')}{getSubtotal().toFixed(2)}</Text>
                        </View>
                        <View style={styles.row}>
                            <Text style={{ color: colors.textSecondary }}>{i18n.t('order.tax')}:</Text>
                            <Text style={{ color: colors.text }}>{i18n.t('common.currency_symbol')}{getTaxTotal().toFixed(2)}</Text>
                        </View>
                        <View style={[styles.row, { marginTop: 8 }]}>
                            <Text style={[styles.totalText, { color: colors.text }]}>{i18n.t('order.total')}:</Text>
                            <Text style={[styles.totalText, { color: colors.primary }]}>{i18n.t('common.currency_symbol')}{getTotal().toFixed(2)}</Text>
                        </View>

                        <TouchableOpacity
                            style={[styles.checkoutButton, { backgroundColor: (items.length > 0 && !isSubmitting) ? colors.primary : colors.textSecondary }]}
                            disabled={items.length === 0 || isSubmitting}
                            onPress={async () => {
                                if (isSubmitting) return;
                                setIsSubmitting(true);
                                try {
                                    if (editOrderId) {
                                        // editOrderId can be a local_id string OR an Odoo numeric ID string
                                        const orderRef: string | number = /^\d+$/.test(editOrderId)
                                            ? parseInt(editOrderId, 10)
                                            : editOrderId;

                                        for (const item of items) {
                                            const isNew = !initialProductIds.has(item.cartKey);
                                            const initialQty = initialQuantities[item.cartKey] || 0;
                                            const qtyChanged = item.quantity !== initialQty;

                                            // Queue server action if it's a new item OR an existing item with changed quantity
                                            if (isNew || qtyChanged) {
                                                await insertPendingAction({
                                                    action_type: 'add_order_line',
                                                    payload: {
                                                        order_id: typeof orderRef === 'number' ? orderRef : null,
                                                        order_local_id: typeof orderRef === 'string' ? orderRef : null,
                                                        product_id: item.id,
                                                        quantity: item.quantity,
                                                        product_uom_id: item.uom_id,
                                                        price_unit: item.price,
                                                        location_id: item.location_id,
                                                        location_name: item.location_name
                                                    },
                                                    related_id: editOrderId
                                                });
                                            }

                                            await addLocalOrderLine(orderRef, {
                                                id: item.id,
                                                name: item.name,
                                                price: item.price,
                                                quantity: item.quantity,
                                                uom_id: item.uom_id,
                                                uom_name: item.uom_name,
                                                location_id: item.location_id,
                                                location_name: item.location_name
                                            });
                                        }

                                        // Recalculate promotions after all lines are added/updated
                                        await applyOrderPromotions(orderRef);

                                        clearCart();
                                        setCartVisible(false);
                                        // Trigger auto-sync if online
                                        useOfflineStore.getState().triggerSyncIfOnline();
                                        router.back();

                                    } else {
                                        // Create New Order
                                        const orderData = {
                                            partner_id: customer.partner_id || customer.id,
                                            route_customer_id: customer.odoo_id || null,
                                            local_route_customer_id: customer.id,
                                            route_id: currentRoute?.odoo_id || null,
                                            date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                                            amount_untaxed: getSubtotal(),
                                            amount_tax: getTaxTotal(),
                                            amount_total: getTotal(),
                                            is_cash: customer.is_cash ? 1 : 0
                                        };

                                        const lines = items.map(item => ({
                                            product_id: item.id,
                                            product_name: item.name,
                                            quantity: item.quantity,
                                            price_unit: item.price,
                                            uom_id: item.uom_id,
                                            uom_name: item.uom_name,
                                            location_id: item.location_id,
                                            location_name: item.location_name
                                        }));

                                        const localId = await createLocalOrder(orderData, lines);

                                        // Recalculate promotions for the new order
                                        await applyOrderPromotions(localId);

                                        if (customer.state === 'in_progress') {
                                            try {
                                                await endVisit(customer.id, {
                                                    visit_result: 'successful',
                                                    notes: i18n.t('visit.auto_ended_order'),
                                                });
                                            } catch (visitErr) {
                                                console.error('Failed to auto-end visit:', visitErr);
                                            }
                                        }

                                        if (!isOffline) {
                                            performSync();
                                        }

                                        showAlert({
                                            title: i18n.t('common.success'),
                                            message: i18n.t('order.submitted') + (customer.state === 'in_progress' ? " & " + i18n.t('visit.ended') : ""),
                                            onConfirm: () => {
                                                clearCart();
                                                setCartVisible(false);
                                                setAlertConfig(prev => ({ ...prev, visible: false }));
                                                router.replace({
                                                    pathname: `/customer/${id}/order-details` as any,
                                                    params: {
                                                        orderId: localId,
                                                        orderType: 'local'
                                                    }
                                                });
                                            }
                                        });
                                    }

                                } catch (e) {
                                    console.error("Order processing failed", e);
                                    showAlert({
                                        title: i18n.t('common.error'),
                                        message: i18n.t('order.save_error'),
                                        onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                                    });
                                } finally {
                                    setIsSubmitting(false);
                                }
                            }}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {isSubmitting && <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />}
                                <Text style={styles.checkoutButtonText}>
                                    {isSubmitting ? i18n.t('common.processing') : (editOrderId ? i18n.t('order.add_product') : i18n.t('order.confirm_order'))}
                                </Text>
                            </View>
                        </TouchableOpacity>
                    </View>
                </View>
            </BottomSheetModal>

            {/* UoM Picker Modal */}
            <BottomSheetModal
                visible={uomPickerVisible}
                onClose={() => setUomPickerVisible(false)}
                title={i18n.t('order.select_uom')}
            >
                <View style={{ paddingBottom: 20 }}>
                    {availableUoms.map((uom) => (
                        <TouchableOpacity
                            key={uom.odoo_id}
                            style={[
                                styles.uomOption,
                                { 
                                    borderBottomColor: colors.border,
                                    backgroundColor: selectedCartItem?.uom_id === uom.odoo_id ? colors.primary + '10' : 'transparent'
                                }
                            ]}
                            onPress={() => {
                                updateUom(selectedCartItem.cartKey, uom);
                                setUomPickerVisible(false);
                            }}
                        >
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.uomOptionName, { color: selectedCartItem?.uom_id === uom.odoo_id ? colors.primary : colors.text }]}>
                                    {uom.name}
                                </Text>
                                <Text style={[styles.uomOptionFactor, { color: colors.textSecondary }]}>
                                    Factor: {uom.factor}
                                </Text>
                            </View>
                            {selectedCartItem?.uom_id === uom.odoo_id && (
                                <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                            )}
                        </TouchableOpacity>
                    ))}
                </View>
            </BottomSheetModal>

            <BottomSheetModal
                visible={isFilterModalVisible}
                onClose={() => setIsFilterModalVisible(false)}
                title={i18n.t('orders.filters_title')}
            >
                <View style={[styles.modalContent, { paddingHorizontal: 16 }]}>
                    {/* Location Selector Section */}
                    {locationsList.length > 1 && (
                        <View style={{ marginBottom: 20, zIndex: 1000 }}>
                            <Text style={[styles.filterSectionTitle, { color: colors.textSecondary }]}>
                                {i18n.t('order.select_location')}
                            </Text>
                            <Dropdown
                                items={locationsList.map(loc => ({ label: loc.name, value: loc.id.toString() }))}
                                selectedValue={selectedLocationId}
                                onSelect={(val) => {
                                    const hasItems = items.length > 0;
                                    const differentLocation = items.some(item => (item.location_id || 0).toString() !== val);
                                    if (hasItems && differentLocation) {
                                        showAlert({
                                            title: i18n.t('order.location_mismatch_title'),
                                            message: i18n.t('order.location_change_warning'),
                                            confirmText: i18n.t('common.yes'),
                                            cancelText: i18n.t('common.no'),
                                            onConfirm: () => {
                                                clearCart();
                                                setSelectedLocationId(val);
                                                loadProducts(val);
                                                setAlertConfig(prev => ({ ...prev, visible: false }));
                                            },
                                            onCancel: () => {
                                                setAlertConfig(prev => ({ ...prev, visible: false }));
                                            }
                                        });
                                    } else {
                                        setSelectedLocationId(val);
                                        loadProducts(val);
                                    }
                                }}
                                placeholder={i18n.t('storage.select_location')}
                            />
                        </View>
                    )}

                    {/* Category Section */}
                    {productCategories.length > 0 && (
                        <>
                            <Text style={[styles.filterSectionTitle, { color: colors.textSecondary }]}>
                                {i18n.t('order.category')}
                            </Text>
                            <View style={styles.chipContainer}>
                                <TouchableOpacity
                                    style={[
                                        styles.chip,
                                        { borderColor: colors.border },
                                        selectedCategoryId === null && { backgroundColor: colors.primary + '15', borderColor: colors.primary }
                                    ]}
                                    onPress={() => setSelectedCategoryId(null)}
                                >
                                    <Text style={[
                                        styles.chipText,
                                        { color: colors.text },
                                        selectedCategoryId === null && { color: colors.primary, fontWeight: 'bold' }
                                    ]}>
                                        {i18n.t('orders.filter_all')}
                                    </Text>
                                </TouchableOpacity>
                                {productCategories.map((cat: any) => (
                                    <TouchableOpacity
                                        key={cat.id}
                                        style={[
                                            styles.chip,
                                            { borderColor: colors.border },
                                            selectedCategoryId === cat.id && { backgroundColor: colors.primary + '15', borderColor: colors.primary }
                                        ]}
                                        onPress={() => setSelectedCategoryId(cat.id)}
                                    >
                                        <Text style={[
                                            styles.chipText,
                                            { color: colors.text },
                                            selectedCategoryId === cat.id && { color: colors.primary, fontWeight: 'bold' }
                                        ]}>
                                            {cat.name}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </>
                    )}

                    {/* Stock Status Section */}
                    <Text style={[styles.filterSectionTitle, { color: colors.textSecondary, marginTop: 20 }]}>
                        {i18n.t('orders.stock_status')}
                    </Text>
                    <View style={styles.chipContainer}>
                        {[
                            { value: 'all', label: i18n.t('orders.filter_all') },
                            { value: 'in_stock', label: i18n.t('storage.in_stock') },
                            { value: 'out_of_stock', label: i18n.t('storage.out_of_stock') }
                        ].map((item) => (
                            <TouchableOpacity
                                key={item.value}
                                style={[
                                    styles.chip,
                                    { borderColor: colors.border },
                                    stockFilter === item.value && { backgroundColor: colors.primary + '15', borderColor: colors.primary }
                                ]}
                                onPress={() => setStockFilter(item.value as any)}
                            >
                                <Text style={[
                                    styles.chipText,
                                    { color: colors.text },
                                    stockFilter === item.value && { color: colors.primary, fontWeight: 'bold' }
                                ]}>
                                    {item.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Footer buttons */}
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

            <CustomAlert
                visible={alertConfig.visible}
                title={alertConfig.title}
                message={alertConfig.message}
                confirmText={alertConfig.confirmText}
                cancelText={alertConfig.cancelText}
                onConfirm={alertConfig.onConfirm}
                onCancel={alertConfig.onCancel}
            />

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
    container: {
        flex: 1,
    },
    headerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SPACING.m,
        paddingVertical: SPACING.s,
        borderBottomWidth: 1,
    },
    headerLeft: {
        flex: 1,
        alignItems: 'flex-start',
    },
    headerCenter: {
        flex: 2,
        alignItems: 'center',
    },
    headerRight: {
        flex: 1,
        alignItems: 'flex-end',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    headerSubtitle: {
        fontSize: 12,
    },
    badge: {
        position: 'absolute',
        top: -5,
        right: -5,
        backgroundColor: '#ef4444',
        borderRadius: 10,
        width: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgeText: {
        color: 'white',
        fontSize: 10,
        fontWeight: 'bold',
    },
    searchSection: {
        paddingVertical: SPACING.s,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    stockFilterRow: {
        flexDirection: 'row',
        paddingHorizontal: SPACING.m,
        marginTop: SPACING.s,
        gap: 8,
    },
    stockFilterChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stockFilterChipText: {
        fontSize: 12,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: SPACING.m,
        paddingHorizontal: SPACING.m,
        paddingVertical: SPACING.s,
        borderRadius: RADIUS.m,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        height: 40,
        fontSize: 16,
    },
    categoriesContainer: {
        marginTop: SPACING.s,
        paddingHorizontal: SPACING.m,
    },
    categoriesScrollContent: {
        gap: 8,
        paddingBottom: 4,
    },
    categoryChip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    categoryChipText: {
        fontSize: 14,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        padding: SPACING.m,
        gap: SPACING.m,
    },
    productCard: {
        flexDirection: 'row',
        borderRadius: RADIUS.l,
        borderWidth: 1,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    productImageWrapper: {
        width: 100,
        height: 110,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    productImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    outOfStockOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    outOfStockLabel: {
        color: 'white',
        fontSize: 10,
        fontWeight: 'bold',
        textTransform: 'uppercase',
    },
    productContent: {
        flex: 1,
        padding: 12,
        justifyContent: 'space-between',
    },
    productMainInfo: {
        marginBottom: 8,
    },
    productName: {
        fontSize: 16,
        fontWeight: 'bold',
        lineHeight: 20,
    },
    productCode: {
        fontSize: 12,
        marginTop: 2,
    },
    productFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
    },
    productPrice: {
        fontSize: 17,
        fontWeight: '800',
    },
    qtyControlsLarge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: 'rgba(0,0,0,0.03)',
        padding: 4,
        borderRadius: 20,
    },
    qtyTextLarge: {
        fontSize: 16,
        fontWeight: 'bold',
        minWidth: 20,
        textAlign: 'center',
    },
    disabledAction: {
        padding: 6,
    },
    groupCard: {
        borderRadius: RADIUS.l,
        borderWidth: 1,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    groupHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        gap: 12,
    },
    productImagePlaceholder: {
        width: 48,
        height: 48,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    productInfo: {
        flex: 1,
    },
    groupName: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    groupCount: {
        fontSize: 12,
    },
    variantsList: {
        backgroundColor: 'rgba(0,0,0,0.02)',
    },
    variantRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        marginLeft: 12,
        borderTopWidth: 1,
    },
    variantName: {
        fontSize: 14,
        fontWeight: '500',
    },
    variantMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 2,
    },
    variantPrice: {
        fontSize: 14,
        fontWeight: '700',
    },
    stockBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
    },
    stockText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    qtyControlsSmall: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    qtyTextSmall: {
        fontSize: 14,
        fontWeight: 'bold',
        minWidth: 16,
        textAlign: 'center',
    },
    outOfStockAction: {
        padding: 4,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
        gap: 16,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '500',
    },
    retryButton: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
        borderWidth: 1,
    },
    floatingCartBar: {
        position: 'absolute',
        bottom: 25,
        left: 20,
        right: 20,
        height: 60,
        borderRadius: 30,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        elevation: 8,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
    },
    cartBarInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    cartBarBadge: {
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    cartBarBadgeText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
    cartBarTotal: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    viewCartAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    viewCartText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14,
    },
    cartItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    cartItemName: {
        fontSize: 15,
        fontWeight: '600',
    },
    cartItemPrice: {
        fontSize: 13,
        marginTop: 2,
    },
    qtyControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    cartItemQty: {
        fontWeight: 'bold',
        fontSize: 16,
        minWidth: 24,
        textAlign: 'center',
    },
    variantUom: {
        fontSize: 11,
        marginLeft: 4,
    },
    uomText: {
        fontSize: 12,
    },
    cartFooter: {
        marginTop: SPACING.m,
        borderTopWidth: 1,
        paddingTop: SPACING.m,
        gap: 6,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    totalText: {
        fontSize: 20,
        fontWeight: '900',
    },
    checkoutButton: {
        padding: 18,
        borderRadius: 18,
        alignItems: 'center',
        marginTop: 12,
    },
    checkoutButtonText: {
        color: 'white',
        fontWeight: '900',
        fontSize: 17,
        letterSpacing: 0.5,
    },
    emptyCart: {
        padding: 60,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cartUomButton: {
        marginTop: 2,
    },
    uomOption: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
    },
    uomOptionName: {
        fontSize: 16,
        fontWeight: '600',
    },
    uomOptionFactor: {
        fontSize: 12,
        marginTop: 2,
    },
    // Credit Banner Styles
    creditBanner: {
        marginHorizontal: 16,
        marginTop: 12,
        padding: 12,
        borderRadius: 12,
        borderLeftWidth: 4,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    creditBannerTitle: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    creditBannerPercent: {
        fontSize: 14,
        fontWeight: '900',
    },
    creditProgressBar: {
        height: 6,
        backgroundColor: 'rgba(0,0,0,0.05)',
        borderRadius: 3,
        marginTop: 8,
        marginBottom: 6,
        overflow: 'hidden',
    },
    creditProgressFill: {
        height: '100%',
        borderRadius: 3,
    },
    creditBannerDetail: {
        fontSize: 11,
        fontWeight: '500',
    },
    locationSelectorContainer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        zIndex: 10,
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
