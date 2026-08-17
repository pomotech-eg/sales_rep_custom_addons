import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList, StyleSheet, RefreshControl, ScrollView, TextInput, Alert, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/useThemeStore';
import i18n from '../i18n';

interface Reward {
    reward_type: 'discount' | 'product';
    discount_line_product_id?: number;
    discount_line_product_name?: string;
    reward_product_id?: number;
    reward_product_name?: string;
    reward_product_qty?: number;
    required_points?: number;
    description?: string;
    discount?: number;
}

interface Rule {
    minimum_qty?: number;
    minimum_amount?: number;
    code?: string;
    reward_point_amount?: number;
    products?: string[];
    categories?: string[];
}

export interface Promotion {
    id: number | null;
    name: string;
    program_type: string;
    rewards?: Reward[];
    rules?: Rule[];
    coupon_code?: string;
}

interface PromotionsModalProps {
    visible: boolean;
    onClose: () => void;
    promotions: Promotion[];
    onApply: (promotion: Promotion | { id: null, coupon_code: string }) => void;
    onRefresh?: () => void;
    refreshing?: boolean;
    creditPoints?: number;
    orderPointsToEarn?: number;
    orderLines?: any[]; // Order lines to check for eligibility
    isApplying?: boolean;
}

const PromotionsModal: React.FC<PromotionsModalProps> = ({
    visible, onClose, promotions, onApply, onRefresh, refreshing,
    creditPoints = 0, orderPointsToEarn = 0, orderLines = [], isApplying = false
}) => {
    const { colors } = useThemeStore();
    const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
    const [couponCode, setCouponCode] = useState('');

    useEffect(() => {
        if (visible) {
            setCouponCode('');
            setSelectedPromotion(null);
        }
    }, [visible]);

    const handleApply = (promotion: Promotion | null) => {
        // Point Check
        if (promotion && promotion.rewards && promotion.rewards.length > 0) {
            const costs = promotion.rewards.map(r => r.required_points || 0);
            const minPointCost = Math.min(...costs);

            // Instant Reward Logic: Allow using points earned in this order
            const totalAvailablePoints = creditPoints + orderPointsToEarn;
            console.log('totalAvailablePoints', totalAvailablePoints);
            console.log('minPointCost', minPointCost);
            if (minPointCost > totalAvailablePoints) {
                Alert.alert(
                    i18n.t('promotions.insufficient_credits') || 'Insufficient Credits',
                    i18n.t('promotions.requires_credits', {
                        cost: minPointCost.toFixed(2),
                        balance: totalAvailablePoints.toFixed(2)
                    }) || `Requires ${minPointCost.toFixed(2)} credits. Your balance: ${totalAvailablePoints.toFixed(2)}`
                );
                return;
            }
        }

        const promoData = promotion || { id: null, name: '', program_type: 'coupon' } as Promotion;
        onApply({ ...promoData, coupon_code: couponCode }); // Pass coupon code if entered
        setSelectedPromotion(null);
        setCouponCode('');
    };

    const handleManualCouponApply = () => {
        if (!couponCode.trim()) {
            Alert.alert(i18n.t('common.error') || 'Error', i18n.t('promotions.enter_coupon') || 'Please enter a coupon code');
            return;
        }
        onApply({ id: null, coupon_code: couponCode });
        setCouponCode('');
    };

    // // Filter promotions logic
    // const filteredPromotions = (promotions || []).filter(p => {
    //     // 1. Exclude coupon types (handled by manual input)
    //     if (['coupons', 'coupon', 'promo_code'].includes(p.program_type)) return false;

    //     // 2. Check eligibility
    //     if (!p.rules || p.rules.length === 0) return true; // Global promo

    //     // Check if any rule has product restrictions
    //     const hasProductRestriction = p.rules.some(r => (r.products && r.products.length > 0) || (r.categories && r.categories.length > 0));

    //     // If no rules have product restrictions, it's applicable (e.g. min amount only)
    //     if (!hasProductRestriction) return true;

    //     if (!orderLines || orderLines.length === 0) return false;

    //     return p.rules.some(r => {
    //         let matchFound = false;
    //         // Check product names
    //         if (r.products && r.products.length > 0) {
    //             const productNames = r.products;
    //             const lineProductNames = orderLines.map(l => {
    //                 if (l.product_name) return l.product_name;
    //                 if (l.name) return l.name;
    //                 return '';
    //             });

    //             if (productNames.some(name => lineProductNames.includes(name))) matchFound = true;
    //         }

    //         // Check categories (lenient)
    //         if ((!r.products || r.products.length === 0) && (r.categories && r.categories.length > 0)) {
    //             return true;
    //         }

    //         return matchFound;
    //     });
    // });

    // Show all available promotions
    const filteredPromotions = promotions || [];

    const renderItem = ({ item }: { item: Promotion }) => (
        <TouchableOpacity
            style={[styles.itemContainer, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setSelectedPromotion(item)}
        >
            <View style={[styles.iconContainer, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name="gift-outline" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: colors.text }]}>{item.name}</Text>
                <Text style={[styles.itemType, { color: colors.textSecondary }]}>{item.program_type}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
    );

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={() => {
                if (selectedPromotion) setSelectedPromotion(null);
                else onClose();
            }}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.background }]}>

                    {!selectedPromotion ? (
                        <>
                            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                                <Text style={[styles.title, { color: colors.text }]}>{i18n.t('promotions.title') || 'Promotions'}</Text>
                                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                                    <Ionicons name="close" size={24} color={colors.text} />
                                </TouchableOpacity>
                            </View>

                            {/* Coupon Input */}
                            <View style={{ marginBottom: 15 }}>
                                <View style={styles.searchContainer}>
                                    <TextInput
                                        style={[styles.couponInput, {
                                            flex: 1,
                                            backgroundColor: colors.card,
                                            borderColor: colors.border,
                                            color: colors.text
                                        }]}
                                        placeholder={i18n.t('promotions.enter_coupon_placeholder') || 'Enter Coupon Code'}
                                        value={couponCode}
                                        onChangeText={setCouponCode}
                                        placeholderTextColor={colors.textSecondary}
                                        autoCapitalize="characters"
                                    />
                                    <TouchableOpacity
                                        style={[styles.applyButtonSmall, { backgroundColor: colors.primary }, isApplying && { opacity: 0.7 }]}
                                        onPress={handleManualCouponApply}
                                        disabled={isApplying}
                                    >
                                        {isApplying ? (
                                            <ActivityIndicator color="#fff" size="small" />
                                        ) : (
                                            <Text style={styles.applyButtonTextSmall}>{i18n.t('common.apply') || 'Apply'}</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {filteredPromotions.length > 0 ? (
                                <FlatList
                                    data={filteredPromotions}
                                    renderItem={renderItem}
                                    keyExtractor={(item, index) => (item.id || index).toString()}
                                    contentContainerStyle={styles.listContent}
                                    refreshControl={
                                        <RefreshControl refreshing={refreshing || false} onRefresh={onRefresh} colors={[colors.primary]} />
                                    }
                                />
                            ) : (
                                <View style={styles.emptyContainer}>
                                    <Ionicons name="gift-outline" size={48} color={colors.border} />
                                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                        {i18n.t('promotions.no_promotions') || 'No promotions available'}
                                    </Text>
                                </View>
                            )}
                        </>
                    ) : (
                        // Detailed View
                        <>
                            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                                <TouchableOpacity onPress={() => setSelectedPromotion(null)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Ionicons name="arrow-back" size={24} color={colors.text} style={{ marginRight: 8 }} />
                                    <Text style={[styles.title, { color: colors.text }]}>{i18n.t('common.details') || 'Details'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                                    <Ionicons name="close" size={24} color={colors.text} />
                                </TouchableOpacity>
                            </View>

                            <ScrollView style={{ flex: 1 }}>
                                <Text style={[styles.detailName, { color: colors.text }]}>{selectedPromotion.name}</Text>
                                <Text style={[styles.detailType, { color: colors.textSecondary }]}>{selectedPromotion.program_type}</Text>

                                {/* Rewards */}
                                {selectedPromotion.rewards && selectedPromotion.rewards.length > 0 && (
                                    <View style={styles.section}>
                                        <Text style={[styles.sectionTitle, { color: colors.text }]}>{i18n.t('promotions.rewards') || 'Rewards'}</Text>
                                        {selectedPromotion.rewards.map((reward, index) => (
                                            <View key={index} style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                                <View style={styles.cardHeader}>
                                                    <Text style={[styles.cardTitle, { color: colors.text }]}>
                                                        {reward.reward_type === 'product'
                                                            ? (i18n.t('promotions.free_product') || 'Free Product')
                                                            : (reward.description || `${reward.discount}% Discount`)}
                                                    </Text>
                                                    {(reward.required_points || 0) > 0 && (
                                                        <View style={{ alignItems: 'flex-end' }}>
                                                            <Text style={[styles.exchangeText, { color: colors.textSecondary }]}>{i18n.t('promotions.exchange_for') || 'In exchange for'}</Text>
                                                            <Text style={[styles.pointsCost, { color: colors.primary }]}>{(reward.required_points || 0).toFixed(2)} pts</Text>
                                                        </View>
                                                    )}
                                                </View>
                                                <View style={{ marginTop: 8 }}>
                                                    {reward.reward_type === 'product' && reward.reward_product_id && (
                                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                            <Ionicons name="cube-outline" size={16} color={colors.textSecondary} />
                                                            <Text style={[styles.detailText, { marginLeft: 6, color: colors.textSecondary }]}>
                                                                {reward.reward_product_qty}x {reward.reward_product_name || reward.reward_product_id}
                                                            </Text>
                                                        </View>
                                                    )}
                                                    {reward.reward_type === 'discount' && reward.discount_line_product_id && (
                                                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                                                            On {reward.discount_line_product_name || reward.discount_line_product_id}
                                                        </Text>
                                                    )}
                                                </View>
                                            </View>
                                        ))}
                                    </View>
                                )}

                                {/* Rules */}
                                {selectedPromotion.rules && selectedPromotion.rules.length > 0 && (
                                    <View style={styles.section}>
                                        <Text style={[styles.sectionTitle, { color: colors.text }]}>{i18n.t('promotions.rules') || 'Rules'}</Text>
                                        {selectedPromotion.rules.map((rule, index) => (
                                            <View key={index} style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                                <View style={styles.cardHeader}>
                                                    <View>
                                                        {(rule.minimum_qty || 0) > 0 && (
                                                            <Text style={[styles.cardTitle, { color: colors.text }]}>{i18n.t('promotions.min_qty') || 'Min Qty'}: {rule.minimum_qty}</Text>
                                                        )}
                                                        {(rule.minimum_amount || 0) > 0 && (
                                                            <Text style={[styles.cardTitle, { color: colors.text }]}>{i18n.t('promotions.min_amount') || 'Min Amount'}: {rule.minimum_amount?.toFixed(2)}</Text>
                                                        )}
                                                        {rule.code && (
                                                            <Text style={[styles.detailText, { color: colors.textSecondary }]}>{i18n.t('promotions.code') || 'Code'}: <Text style={{ fontWeight: '700' }}>{rule.code}</Text></Text>
                                                        )}
                                                    </View>
                                                    {(rule.reward_point_amount || 0) > 0 && (
                                                        <View style={{ alignItems: 'flex-end' }}>
                                                            <Text style={[styles.exchangeText, { color: colors.textSecondary }]}>{i18n.t('promotions.grant') || 'Grant'}</Text>
                                                            <Text style={[styles.pointsCost, { color: colors.primary }]}>{(rule.reward_point_amount || 0).toFixed(2)} pts</Text>
                                                        </View>
                                                    )}
                                                </View>
                                                {/* Products/Categories display */}
                                                {((rule.products && rule.products.length > 0) || (rule.categories && rule.categories.length > 0)) && (
                                                    <View style={{ marginTop: 8 }}>
                                                        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, textDecorationLine: 'underline' }}>{i18n.t('promotions.among') || 'Among'}</Text>
                                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                                            {rule.products?.map((p, i) => (
                                                                <View key={`p-${i}`} style={[styles.tag, { backgroundColor: colors.background }]}>
                                                                    <Ionicons name="cube-outline" size={10} color={colors.textSecondary} />
                                                                    <Text style={[styles.tagText, { color: colors.text }]}>{p}</Text>
                                                                </View>
                                                            ))}
                                                            {rule.categories?.map((c, i) => (
                                                                <View key={`c-${i}`} style={[styles.tag, { backgroundColor: colors.background }]}>
                                                                    <Ionicons name="folder-outline" size={10} color={colors.textSecondary} />
                                                                    <Text style={[styles.tagText, { color: colors.text }]}>{c}</Text>
                                                                </View>
                                                            ))}
                                                        </View>
                                                    </View>
                                                )}
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </ScrollView>

                            <View style={[styles.footer, { borderTopColor: colors.border }]}>
                                <TouchableOpacity
                                    style={[styles.activateButton, { backgroundColor: colors.primary }, isApplying && { opacity: 0.7 }]}
                                    onPress={() => handleApply(selectedPromotion)}
                                    disabled={isApplying}
                                >
                                    {isApplying ? (
                                        <ActivityIndicator color="#fff" size="small" />
                                    ) : (
                                        <Text style={styles.activateButtonText}>{i18n.t('promotions.activate') || 'Activate'}</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </>
                    )}

                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        justifyContent: "flex-end",
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        height: "80%",
        padding: 20,
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 20,
        borderBottomWidth: 1,
        paddingBottom: 15,
    },
    title: {
        fontSize: 20,
        fontWeight: "bold",
    },
    closeButton: {
        padding: 5,
    },
    listContent: {
        paddingBottom: 20,
    },
    itemContainer: {
        flexDirection: "row",
        alignItems: "center",
        padding: 15,
        borderRadius: 12,
        marginBottom: 10,
        borderWidth: 1,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 15,
    },
    itemName: {
        fontSize: 16,
        fontWeight: "600",
        marginBottom: 2,
    },
    itemType: {
        fontSize: 12,
        textTransform: "capitalize",
    },
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        marginTop: 50,
    },
    emptyText: {
        marginTop: 10,
        fontSize: 16,
    },
    detailName: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
    detailType: { fontSize: 14, marginBottom: 20, textTransform: 'uppercase', fontWeight: 'bold' },
    section: { marginBottom: 20 },
    sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
    detailCard: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 10 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    cardTitle: { fontSize: 14, fontWeight: '600', flex: 1 },
    exchangeText: { fontSize: 11, textDecorationLine: 'underline' },
    pointsCost: { fontSize: 12, fontWeight: '700' },
    detailText: { fontSize: 14 },
    tag: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
    tagText: { fontSize: 11, fontWeight: '500' },
    footer: { marginTop: 'auto', paddingTop: 16, borderTopWidth: 1 },
    activateButton: { borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    activateButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    couponInput: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        fontSize: 14,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    applyButtonSmall: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 8,
        justifyContent: 'center',
    },
    applyButtonTextSmall: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 14,
    },
});

export default PromotionsModal;
