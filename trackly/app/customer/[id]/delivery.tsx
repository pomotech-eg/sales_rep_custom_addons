import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput, Modal, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeStore } from '../../../store/useThemeStore';
import { getOrderWithLines, updateLocalOrderState, updateLocalOrderLine, updateLocalOrderInvoiceStatus, updateAllLinesInvoiced } from '../../../services/database/repositories';
import { useOfflineStore } from '../../../store/useOfflineStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../../../i18n';
import { SHADOW } from '../../../theme';
import { printInvoice } from '../../../utils/pdfGenerator';

export default function DeliveryScreen() {
    const { id, orderId } = useLocalSearchParams<{ id: string; orderId: string }>();
    const { colors } = useThemeStore();
    const router = useRouter();

    const [order, setOrder] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [quantities, setQuantities] = useState<Record<number, number>>({});
    const [uoms, setUoms] = useState<any[]>([]);
    const [selectedUomIds, setSelectedUomIds] = useState<Record<number, number>>({});

    const [customer, setCustomer] = useState<any>(null);
    const [unsyncedTotal, setUnsyncedTotal] = useState(0);

    useEffect(() => {
        loadOrder();
    }, [orderId]);

    const loadOrder = async () => {
        if (!orderId) return;
        try {
            const { getOrderWithLines, getUomsByCategory, getPartnerById, getLocalUnsyncedOrdersTotal } = require('../../../services/database/repositories');
            const result = await getOrderWithLines(orderId);
            setOrder(result);
            
            if (result?.partner_id) {
                const partner = await getPartnerById(result.partner_id);
                setCustomer(partner);
                const unsynced = await getLocalUnsyncedOrdersTotal(result.partner_id);
                setUnsyncedTotal(unsynced);
            }
            
            // Initialize quantities and UoMs
            const initQty: Record<number, number> = {};
            const initUomIds: Record<number, number> = {};
            const allUoms: any[] = [];
            const processedCategories = new Set<number>();

            for (const line of (result?.lines || [])) {
                if (line.product_type !== 'product') continue; // Skip services/consumables if not storable

                const remaining = (line.product_uom_qty || 0) - (line.qty_delivered || 0);
                initQty[line.id] = Math.max(0, remaining);
                initUomIds[line.id] = line.product_uom_id;

                if (line.uom_category_id && !processedCategories.has(line.uom_category_id)) {
                    const catUoms = await getUomsByCategory(line.uom_category_id);
                    allUoms.push(...catUoms);
                    processedCategories.add(line.uom_category_id);
                }
            }

            setUoms(allUoms);
            setQuantities(initQty);
            setSelectedUomIds(initUomIds);
        } catch (err) {
            console.error('Failed to load order:', err);
        } finally {
            setLoading(false);
        }
    };

    const updateQty = (lineId: number, value: string) => {
        const num = parseFloat(value) || 0;
        setQuantities(prev => ({ ...prev, [lineId]: num }));
    };



    const handleDeliverAll = () => {
        const allQty: Record<number, number> = {};
        (order?.lines || []).forEach((line: any) => {
            if (line.product_type !== 'product') return;
            
            const selectedUomId = selectedUomIds[line.id];
            const selectedUom = uoms.find(u => u.odoo_id === selectedUomId);
            const lineUomFactor = line.uom_factor || 1;
            const selectedUomFactor = selectedUom?.factor || 1;
            
            const remainingInRef = (line.product_uom_qty || 0) / lineUomFactor - (line.qty_delivered || 0) / lineUomFactor;
            const remainingInSelected = remainingInRef * selectedUomFactor;
            
            allQty[line.id] = Math.max(0, parseFloat(remainingInSelected.toFixed(3)));
        });
        setQuantities(allQty);
    };

    const handleSubmit = async () => {
        // --- Credit Limit Check ---
        if (customer && (customer.sale_credit_limit > 0)) {
            const limit = customer.sale_credit_limit || 0;
            const syncedUsed = customer.sale_credit_used || 0;
            const allowOverCredit = customer.allow_over_sale_credit || false;

            const isSynced = !!order.is_synced || !!order.odoo_id;
            const thisOrderAmount = order.amount_total || 0;
            const totalUsed = syncedUsed + unsyncedTotal + (isSynced ? thisOrderAmount : 0);

            const isExceeded = totalUsed > limit;

            if (isExceeded && !allowOverCredit) {
                const otherPending = unsyncedTotal - (isSynced ? 0 : thisOrderAmount);
                const remaining = Math.max(0, limit - syncedUsed - otherPending);
                
                const msg = `${i18n.t('order.credit_block_message') || 'This order cannot be placed because it exceeds the customer credit limit.'}\n\n` +
                    `${i18n.t('order.credit_limit_label') || 'Credit Limit'}: ${i18n.t('common.currency_symbol')}${limit.toFixed(2)}\n` +
                    `${i18n.t('order.credit_used') || 'Used'}: ${i18n.t('common.currency_symbol')}${syncedUsed.toFixed(2)}\n` +
                    (otherPending > 0 ? `${i18n.t('order.credit_pending') || 'Pending Orders'}: ${i18n.t('common.currency_symbol')}${otherPending.toFixed(2)}\n` : '') +
                    `${i18n.t('order.this_order') || 'This Order'}: ${i18n.t('common.currency_symbol')}${thisOrderAmount.toFixed(2)}\n` +
                    `${i18n.t('order.credit_remaining') || 'Available'}: ${i18n.t('common.currency_symbol')}${remaining.toFixed(2)}`;

                Alert.alert(i18n.t('order.credit_exceeded') || 'Credit Limit Exceeded', msg);
                return;
            }
        }
        // --- End Credit Limit Check ---

        const hasQty = Object.values(quantities).some(q => q > 0);
        if (!hasQty) {
            Alert.alert(i18n.t('common.warning'), i18n.t('delivery.enter_qty_error'));
            return;
        }

        const isPartial = (order?.lines || []).some((line: any) => {
            if (line.product_type !== 'product') return false;
            
            const selectedUomId = selectedUomIds[line.id];
            const selectedUom = uoms.find(u => u.odoo_id === selectedUomId);
            const selectedUomFactor = selectedUom?.factor || 1;
            const lineUomFactor = line.uom_factor || 1;

            const currentDeliveredInRef = (line.qty_delivered || 0) / lineUomFactor;
            const newDeliveredInRef = (quantities[line.id] || 0) / selectedUomFactor;
            const totalDeliveredInRef = currentDeliveredInRef + newDeliveredInRef;
            
            const orderedInRef = (line.product_uom_qty || 0) / lineUomFactor;

            return totalDeliveredInRef < (orderedInRef - 0.001);
        });

        if (isPartial) {
            Alert.alert(
                i18n.t('delivery.backorder_title'),
                i18n.t('delivery.backorder_msg'),
                [
                    { text: i18n.t('common.cancel'), style: 'cancel' },
                    {
                        text: i18n.t('delivery.no_backorder'),
                        onPress: () => processDelivery(false)
                    },
                    {
                        text: i18n.t('delivery.create_backorder'),
                        onPress: () => processDelivery(true),
                        style: 'default'
                    }
                ]
            );
        } else {
            Alert.alert(i18n.t('delivery.process_title'), i18n.t('delivery.process_msg'), [
                { text: i18n.t('common.cancel'), style: 'cancel' },
                {
                    text: 'Process',
                    onPress: () => processDelivery(false)
                }
            ]);
        }
    };

    const processDelivery = async (createBackorder: boolean) => {
        // --- Credit Limit Check ---
        if (customer && (customer.sale_credit_limit > 0)) {
            const limit = customer.sale_credit_limit || 0;
            const syncedUsed = customer.sale_credit_used || 0;
            const allowOverCredit = customer.allow_over_sale_credit || false;

            const isSynced = !!order.is_synced || !!order.odoo_id;
            const thisOrderAmount = order.amount_total || 0;
            const totalUsed = syncedUsed + unsyncedTotal + (isSynced ? thisOrderAmount : 0);

            const isExceeded = totalUsed > limit;

            if (isExceeded && !allowOverCredit) {
                const otherPending = unsyncedTotal - (isSynced ? 0 : thisOrderAmount);
                const remaining = Math.max(0, limit - syncedUsed - otherPending);
                
                const msg = `${i18n.t('order.credit_block_message') || 'This order cannot be placed because it exceeds the customer credit limit.'}\n\n` +
                    `${i18n.t('order.credit_limit_label') || 'Credit Limit'}: ${i18n.t('common.currency_symbol')}${limit.toFixed(2)}\n` +
                    `${i18n.t('order.credit_used') || 'Used'}: ${i18n.t('common.currency_symbol')}${syncedUsed.toFixed(2)}\n` +
                    (otherPending > 0 ? `${i18n.t('order.credit_pending') || 'Pending Orders'}: ${i18n.t('common.currency_symbol')}${otherPending.toFixed(2)}\n` : '') +
                    `${i18n.t('order.this_order') || 'This Order'}: ${i18n.t('common.currency_symbol')}${thisOrderAmount.toFixed(2)}\n` +
                    `${i18n.t('order.credit_remaining') || 'Available'}: ${i18n.t('common.currency_symbol')}${remaining.toFixed(2)}`;

                Alert.alert(i18n.t('order.credit_exceeded') || 'Credit Limit Exceeded', msg);
                return;
            }
        }
        // --- End Credit Limit Check ---

        setSubmitting(true);
        try {
            const lineQuantities = Object.entries(quantities)
                .filter(([_, qty]) => qty > 0)
                .map(([lineId, qty]) => {
                    const lid = parseInt(lineId);
                    const line = order?.lines?.find((l: any) => l.id === lid);
                    const selectedUomId = selectedUomIds[lid];
                    return {
                        line_id: line?.odoo_id || lid,
                        quantity: qty,
                        uom_id: selectedUomId
                    };
                });

            const deliveredQuantities: Record<string, number> = {};
            lineQuantities.forEach(lq => {
                const line = order.lines.find((l: any) => l.id === lq.line_id);
                if (line?.product_id) {
                    const key = String(line.product_id);
                    const selectedUom = uoms.find(u => u.odoo_id === lq.uom_id);
                    const factor = selectedUom?.factor || 1;
                    const referenceQty = lq.quantity / factor;
                    deliveredQuantities[key] = (deliveredQuantities[key] || 0) + referenceQty;
                }
            });

            await useOfflineStore.getState().recordPendingAction({
                action_type: 'process_delivery',
                payload: {
                    order_id: orderId,
                    lines: lineQuantities,
                    delivered_quantities: deliveredQuantities,
                    create_backorder: createBackorder,
                },
                related_id: orderId,
            });

            const allFull = (order?.lines || []).every((line: any) => {
                if (line.product_type !== 'product') return true;

                const selectedUomId = selectedUomIds[line.id];
                const selectedUom = uoms.find(u => u.odoo_id === selectedUomId);
                const selectedFactor = selectedUom?.factor || 1;
                const lineFactor = line.uom_factor || 1;
                
                const newQtyInLineUom = ((quantities[line.id] || 0) / selectedFactor) * lineFactor;
                const totalDelivered = (line.qty_delivered || 0) + newQtyInLineUom;
                return totalDelivered >= (line.product_uom_qty - 0.001);
            });

            await Promise.all(lineQuantities.map(async (lq) => {
                const line = order.lines.find((l: any) => l.id === lq.line_id);
                if (!line) return;

                const selectedUom = uoms.find(u => u.odoo_id === lq.uom_id);
                const selectedFactor = selectedUom?.factor || 1;
                const lineFactor = line.uom_factor || 1;
                
                const convertedQty = (lq.quantity / selectedFactor) * lineFactor;
                const currentDelivered = line.qty_delivered || 0;
                
                await updateLocalOrderLine(lq.line_id, {
                    qty_delivered: currentDelivered + convertedQty
                });
            }));

            const finalStatus = (allFull || !createBackorder) ? 'full' : 'partial';

            await updateLocalOrderState(
                orderId,
                undefined,
                finalStatus,
                1
            );

            await updateLocalOrderInvoiceStatus(orderId, 'to invoice');

            if (orderId) {
                const repProfile = useOfflineStore.getState().salesRepProfile;
                const invoicePayload = {
                    order_id: orderId,
                    journal_id: repProfile?.invoice_journal_id || undefined
                };

                await useOfflineStore.getState().recordPendingAction({
                    action_type: 'create_invoice',
                    payload: invoicePayload,
                    related_id: orderId
                });

                await updateLocalOrderInvoiceStatus(orderId, 'invoiced');
                await updateAllLinesInvoiced(orderId);
            }

            Alert.alert(i18n.t('common.success'), i18n.t('delivery.queued_success'), [
                {
                    text: i18n.t('common.ok'),
                    onPress: () => {
                        router.back();
                    }
                }
            ]);
        } catch (err: any) {
            Alert.alert(i18n.t('common.error'), err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            </SafeAreaView>
        );
    }

    if (!order) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
                <View style={styles.centered}>
                    <Text style={{ color: colors.textSecondary }}>{i18n.t('order.not_found')}</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                    {i18n.t('delivery.title')}
                </Text>
                <TouchableOpacity onPress={handleDeliverAll} style={styles.headerAction}>
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>{i18n.t('delivery.deliver_all')}</Text>
                </TouchableOpacity>
            </View>

            <View style={[styles.infoBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <Text style={[styles.orderName, { color: colors.text }]}>
                    {order.name || `Order #${orderId}`}
                </Text>
                <View style={[styles.badge, { backgroundColor: '#60a5fa20' }]}>
                    <Ionicons name="cube-outline" size={14} color="#60a5fa" />
                    <Text style={{ color: '#60a5fa', fontSize: 12, marginLeft: 4 }}>
                        {order.delivery_status === 'full' ? i18n.t('delivery.status_full') : order.delivery_status || i18n.t('delivery.status_not')}
                    </Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {(order.lines || []).filter((l: any) => l.product_type === 'product').map((line: any, idx: number) => {
                    const ordered = line.product_uom_qty || 0;
                    const delivered = line.qty_delivered || 0;
                    const remaining = Math.max(0, ordered - delivered);
                    const currentQty = quantities[line.id] || 0;
                    
                    const selectedUomId = selectedUomIds[line.id];
                    const selectedUom = uoms.find(u => u.odoo_id === selectedUomId) || { name: line.product_uom_name || 'Unit' };

                    return (
                        <View key={line.id || idx} style={[styles.lineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <View style={styles.lineHeader}>
                                <Text style={[styles.lineName, { color: colors.text }]} numberOfLines={2}>
                                    {line.product_name || line.name || `Product #${line.product_id}`}
                                </Text>
                            </View>

                            <View style={styles.lineStats}>
                                <View style={styles.stat}>
                                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{i18n.t('delivery.ordered')}</Text>
                                    <Text style={[styles.statValue, { color: colors.text }]}>{ordered} <Text style={styles.statUom}>{line.product_uom_name}</Text></Text>
                                </View>
                                <View style={styles.stat}>
                                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{i18n.t('delivery.delivered')}</Text>
                                    <Text style={[styles.statValue, { color: '#34d399' }]}>{delivered} <Text style={styles.statUom}>{line.product_uom_name}</Text></Text>
                                </View>
                                <View style={styles.stat}>
                                    <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{i18n.t('delivery.remaining')}</Text>
                                    <Text style={[styles.statValue, { color: remaining > 0 ? '#f59e0b' : '#34d399' }]}>{remaining} <Text style={styles.statUom}>{line.product_uom_name}</Text></Text>
                                </View>
                            </View>

                            {remaining > 0 && (
                                <View style={styles.qtyRow}>
                                    <View 
                                        style={[styles.uomBadge, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '15' }]}
                                    >
                                        <Text style={[styles.uomBadgeText, { color: colors.primary }]}>{selectedUom.name}</Text>
                                    </View>

                                    <View style={styles.qtyControls}>
                                        <TouchableOpacity
                                            style={[styles.qtyBtn, { backgroundColor: colors.border }]}
                                            onPress={() => updateQty(line.id, String(Math.max(0, currentQty - 1)))}
                                        >
                                            <Ionicons name="remove" size={18} color={colors.text} />
                                        </TouchableOpacity>
                                        <TextInput
                                            style={[styles.qtyInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                                            value={String(currentQty)}
                                            onChangeText={(v) => updateQty(line.id, v)}
                                            keyboardType="numeric"
                                            textAlign="center"
                                        />
                                        <TouchableOpacity
                                            style={[styles.qtyBtn, { backgroundColor: colors.primary + '30' }]}
                                            onPress={() => updateQty(line.id, String(currentQty + 1))}
                                        >
                                            <Ionicons name="add" size={18} color={colors.primary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}

                            {remaining === 0 && (
                                <View style={[styles.fullyDelivered, { backgroundColor: '#34d39910' }]}>
                                    <Ionicons name="checkmark-circle" size={16} color="#34d399" />
                                    <Text style={{ color: '#34d399', fontSize: 12, marginLeft: 4 }}>{i18n.t('delivery.fully_delivered')}</Text>
                                </View>
                            )}
                        </View>
                    );
                })}
            </ScrollView>



            <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                <TouchableOpacity
                    style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
                    onPress={handleSubmit}
                    disabled={submitting}
                >
                    {submitting ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Ionicons name="cube" size={20} color="#fff" />
                            <Text style={styles.submitText}>
                                {i18n.t('delivery.submit')}
                            </Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}


const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: 'bold' },
    headerAction: { padding: 4 },
    infoBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    orderName: { fontSize: 16, fontWeight: '600' },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    content: { padding: 16, gap: 12, paddingBottom: 120 },
    lineCard: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 16,
    },
    lineHeader: { marginBottom: 10 },
    lineName: { fontSize: 15, fontWeight: '600' },
    lineStats: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    stat: { alignItems: 'center', flex: 1 },
    statLabel: { fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
    statValue: { fontSize: 15, fontWeight: 'bold' },
    statUom: { fontSize: 10, fontWeight: 'normal', opacity: 0.7 },
    qtyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#00000010',
    },
    uomBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
    },
    uomBadgeText: {
        fontSize: 13,
        fontWeight: '600',
        marginRight: 4,
    },
    qtyControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    qtyBtn: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    qtyBtnText: { fontSize: 20, fontWeight: 'bold' },
    qtyInput: {
        width: 60,
        height: 36,
        borderWidth: 1,
        borderRadius: 8,
        fontSize: 16,
        fontWeight: 'bold',
        padding: 0,
    },
    fullyDelivered: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
        borderRadius: 8,
        marginTop: 4,
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        paddingBottom: Platform.OS === 'ios' ? 32 : 16,
        borderTopWidth: 1,
    },
    submitBtn: {
        height: 54,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    submitText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: 40,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#00000010',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    uomList: {
        padding: 10,
    },
    uomOption: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        marginBottom: 4,
    },
    uomOptionName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    uomOptionFactor: {
        fontSize: 12,
    },
});
