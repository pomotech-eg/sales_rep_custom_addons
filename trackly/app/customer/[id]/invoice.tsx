import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeStore } from '../../../store/useThemeStore';
import { getOrderWithLines, getSalesRepresentativePaymentMethods, getSalesRepresentative } from '../../../services/database/repositories';
import { useOfflineStore } from '../../../store/useOfflineStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../../../i18n';

export default function InvoicePaymentScreen() {
    const { id, orderId } = useLocalSearchParams<{ id: string; orderId: string }>();
    const { colors } = useThemeStore();
    const router = useRouter();

    const [order, setOrder] = useState<any>(null);
    const [methods, setMethods] = useState<any[]>([]);
    const [selectedMethodId, setSelectedMethodId] = useState<number | null>(null); // payment_method.odoo_id
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [amount, setAmount] = useState('');

    useEffect(() => {
        loadData();
    }, [orderId]);

    const loadData = async () => {
        try {
            const [orderData, salesRep]: [any, any] = await Promise.all([
                getOrderWithLines(parseInt(orderId)),
                getSalesRepresentative()
            ]);
            setOrder(orderData);

            // Fetch allowed payment methods for this sales rep from new table
            let allowedMethods: any[] = [];
            if (salesRep) {
                allowedMethods = await getSalesRepresentativePaymentMethods(salesRep.odoo_id);
            }

            // Calculate Default Amount: Residual if available, else Total - Paid?
            // Since we added amount_residual to DB, use it.
            // If unknown/null, fallback to total (unless paid)
            let defaultVal = orderData.amount_residual;
            if (defaultVal === undefined || defaultVal === null) {
                defaultVal = (orderData.payment_state === 'paid') ? 0 : orderData.amount_total;
            }
            setAmount(defaultVal.toString());

            setMethods(allowedMethods);
            if (allowedMethods.length > 0) {
                // If the filtered list has items, pick the first one's Odoo ID
                setSelectedMethodId(allowedMethods[0].odoo_id);
            }
        } catch (err) {
            console.error('Failed to load data:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleRegisterPayment = () => {
        if (!order?.odoo_id) {
            Alert.alert(i18n.t('common.warning'), i18n.t('invoice.sync_required'));
            return;
        }
        if (!selectedMethodId) {
            Alert.alert(i18n.t('common.warning'), i18n.t('invoice.select_journal'));
            return;
        }

        const val = parseFloat(amount || '0');
        if (val <= 0) {
            Alert.alert(i18n.t('common.warning'), i18n.t('payment.enter_valid_amount'));
            return;
        }

        const maxAmount = order.amount_residual ?? order.amount_total; // Fallback
        if (val > maxAmount + 0.01) { // Floating point tolerance
            Alert.alert(i18n.t('common.warning'), i18n.t('payment.amount_exceeds'));
            return;
        }

        const selectedMethod = methods.find(m => m.odoo_id === selectedMethodId);
        if (!selectedMethod || !selectedMethod.journal_id) {
            Alert.alert(i18n.t('common.error'), "Selected method has no linked Journal ID. Please sync configuration.");
            return;
        }

        Alert.alert(i18n.t('invoice.register_title'), i18n.t('invoice.register_msg').replace('{amount}', formatCurrency(val)), [
            { text: i18n.t('common.cancel'), style: 'cancel' },
            {
                text: i18n.t('invoice.register'),
                onPress: async () => {
                    setSubmitting(true);
                    try {
                        await useOfflineStore.getState().recordPendingAction({
                            action_type: 'register_payment',
                            payload: {
                                order_id: order.odoo_id,
                                journal_id: selectedMethod.journal_id, // Use the linked Journal ID
                                payment_method_id: selectedMethodId, // Added for backend journal resolution
                                amount: val,
                            },
                            related_id: orderId,
                        });

                        Alert.alert(i18n.t('common.success'), i18n.t('invoice.payment_queued'), [
                            { text: i18n.t('common.ok'), onPress: () => router.back() }
                        ]);
                    } catch (err: any) {
                        Alert.alert(i18n.t('common.error'), err.message);
                    } finally {
                        setSubmitting(false);
                    }
                }
            }
        ]);
    };

    const handleRefundInvoice = () => {
        if (!order?.odoo_id) return;
        Alert.alert(i18n.t('invoice.refund_title'), i18n.t('invoice.refund_msg'), [
            { text: i18n.t('common.cancel'), style: 'cancel' },
            {
                text: i18n.t('invoice.refund'),
                style: 'destructive',
                onPress: async () => {
                    setSubmitting(true);
                    try {
                        await useOfflineStore.getState().recordPendingAction({
                            action_type: 'refund_invoice',
                            payload: { order_id: order.odoo_id },
                            related_id: orderId,
                        });

                        Alert.alert(i18n.t('common.success'), i18n.t('invoice.refund_queued'), [
                            { text: i18n.t('common.ok'), onPress: () => router.back() }
                        ]);
                    } catch (err: any) {
                        Alert.alert(i18n.t('common.error'), err.message);
                    } finally {
                        setSubmitting(false);
                    }
                }
            }
        ]);
    };

    const formatCurrency = (amount: number | null) => {
        if (amount === null || amount === undefined) return '—';
        return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
                    {i18n.t('invoice.title')}
                </Text>
                <View style={{ width: 32 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {/* Order Summary */}
                <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.summaryHeader}>
                        <Ionicons name="receipt-outline" size={24} color={colors.primary} />
                        <Text style={[styles.summaryTitle, { color: colors.text }]}>
                            {order.name || `Order #${orderId}`}
                        </Text>
                    </View>

                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{i18n.t('order.subtotal')}</Text>
                        <Text style={[styles.summaryValue, { color: colors.text }]}>{formatCurrency(order.amount_untaxed)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{i18n.t('order.tax')}</Text>
                        <Text style={[styles.summaryValue, { color: colors.text }]}>{formatCurrency(order.amount_tax)}</Text>
                    </View>
                    <View style={[styles.summaryRow, styles.totalRow]}>
                        <Text style={[styles.summaryLabel, { color: colors.text, fontWeight: 'bold', fontSize: 16 }]}>{i18n.t('order.total')}</Text>
                        <Text style={[styles.summaryValue, { color: colors.primary, fontWeight: 'bold', fontSize: 20 }]}>
                            {formatCurrency(order.amount_total)}
                        </Text>
                    </View>
                </View>

                {/* Invoice Status */}
                <View style={[styles.statusSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>{i18n.t('invoice.status_title')}</Text>
                    <View style={styles.statusRow}>
                        <Ionicons
                            name={order.invoice_status === 'invoiced' ? 'checkmark-circle' : 'time-outline'}
                            size={20}
                            color={order.invoice_status === 'invoiced' ? '#34d399' : '#f59e0b'}
                        />
                        <Text style={[styles.statusText, { color: colors.text }]}>
                            {order.invoice_status === 'invoiced' ? i18n.t('invoice.status_invoiced') :
                                order.invoice_status === 'to invoice' ? i18n.t('invoice.status_to_invoice') :
                                    order.invoice_status || i18n.t('invoice.status_not')}
                        </Text>
                    </View>
                </View>



                {/* Amount Input */}
                <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>{i18n.t('payment.amount')}</Text>
                    <TextInput
                        style={[styles.amountInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="numeric"
                        placeholder="0.00"
                        placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
                        {i18n.t('payment.max_amount')}: {formatCurrency(order.amount_residual ?? order.amount_total)}
                    </Text>
                </View>

                {/* Payment Method Selection */}
                <Text style={[styles.sectionTitle, { color: colors.text, paddingHorizontal: 0 }]}>{i18n.t('invoice.journal_title')}</Text>
                <View style={{ gap: 8 }}>
                    {methods.length === 0 ? (
                        <View style={[styles.emptyJournals, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <Ionicons name="wallet-outline" size={32} color={colors.textSecondary} />
                            <Text style={{ color: colors.textSecondary, marginTop: 8 }}>
                                {i18n.t('invoice.no_journals')}
                            </Text>
                        </View>
                    ) : (
                        methods.map((method) => (
                            <TouchableOpacity
                                key={method.odoo_id}
                                style={[
                                    styles.journalOption,
                                    { backgroundColor: colors.card, borderColor: selectedMethodId === method.odoo_id ? colors.primary : colors.border },
                                    selectedMethodId === method.odoo_id && { borderWidth: 2 }
                                ]}
                                onPress={() => setSelectedMethodId(method.odoo_id)}
                            >
                                <Ionicons
                                    name='card-outline'
                                    size={22}
                                    color={selectedMethodId === method.odoo_id ? colors.primary : colors.textSecondary}
                                />
                                <Text style={[
                                    styles.journalName,
                                    { color: selectedMethodId === method.odoo_id ? colors.primary : colors.text }
                                ]}>
                                    {method.name}
                                </Text>
                                {selectedMethodId === method.odoo_id && (
                                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                                )}
                            </TouchableOpacity>
                        ))
                    )}
                </View>

                {/* Action Buttons */}
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#34d399', opacity: submitting ? 0.6 : 1 }]}
                        onPress={handleRegisterPayment}
                        disabled={submitting || !selectedMethodId}
                    >
                        {submitting ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <>
                                <Ionicons name="wallet" size={20} color="#fff" />
                                <Text style={styles.actionBtnText}>{i18n.t('invoice.register_payment_btn')}</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#f8717115', borderWidth: 1, borderColor: '#f87171' }]}
                        onPress={handleRefundInvoice}
                        disabled={submitting}
                    >
                        <Ionicons name="return-down-back" size={20} color="#f87171" />
                        <Text style={[styles.actionBtnText, { color: '#f87171' }]}>{i18n.t('invoice.request_credit_note')}</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView >
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
    content: { padding: 16, gap: 16, paddingBottom: 40 },
    summaryCard: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 16,
    },
    summaryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
    },
    summaryTitle: { fontSize: 17, fontWeight: 'bold' },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(150,150,150,0.1)',
    },
    totalRow: {
        borderBottomWidth: 0,
        paddingTop: 12,
    },
    summaryLabel: { fontSize: 14 },
    summaryValue: { fontSize: 14, fontWeight: '500' },
    statusSection: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 16,
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statusText: { fontSize: 14, fontWeight: '500' },
    emptyJournals: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 24,
        alignItems: 'center',
    },
    journalOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
    },
    journalName: { fontSize: 15, fontWeight: '500', flex: 1 },
    journalType: { fontSize: 12 },
    actions: { gap: 10, marginTop: 8 },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 14,
        borderRadius: 12,
    },
    actionBtnText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    section: {
        padding: 16,
        borderRadius: 14,
        borderWidth: 1,
    },
    amountInput: {
        fontSize: 24,
        fontWeight: 'bold',
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        textAlign: 'center',
    },
});
