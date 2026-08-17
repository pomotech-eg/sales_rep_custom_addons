import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput, Alert,
    ActivityIndicator, Platform, StatusBar as RNStatusBar, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeStore } from '../../../store/useThemeStore';
import { useOfflineStore } from '../../../store/useOfflineStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    getSalesRepresentativePaymentMethods, getSalesRepresentative,
    getPartnerById, getActiveVisitForCustomer,
    updateLocalOrderPaymentState, insertLocalCollection
} from '../../../services/database/repositories';
import { CustomAlert } from '../../../components/CustomAlert';
import { CustomDropdown } from '../../../components/CustomDropdown';
import i18n from '../../../i18n';
// import dayjs from 'dayjs';

export default function CustomerPayment() {
    const { id, invoiceAmount, partnerId, partnerName, orderLocalId, orderOdooId, invoiceId, isRefund } = useLocalSearchParams<{ 
        id: string, 
        invoiceAmount?: string, 
        partnerId?: string, 
        partnerName?: string, 
        orderLocalId?: string, 
        orderOdooId?: string,
        invoiceId?: string,
        isRefund?: string
    }>();
    const { colors } = useThemeStore();
    const { currentRoute, currentRouteCustomers, performSync, isOffline, endVisit, fetchDashboardStats, salesRepProfile } = useOfflineStore();
    const router = useRouter();

    useEffect(() => {
        if (salesRepProfile && salesRepProfile.access_visit_payment === 0) {
            Alert.alert(i18n.t('common.error'), i18n.t('common.access_denied'));
            router.back();
        }
    }, [salesRepProfile]);

    const [customer, setCustomer] = useState<any>(null);
    const [methods, setMethods] = useState<any[]>([]);
    const [selectedMethodId, setSelectedMethodId] = useState<number | null>(null);
    const [amount, setAmount] = useState('');
    const [amountTouched, setAmountTouched] = useState(false); // True once user manually edits
    const [memo, setMemo] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

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

    const showAlert = (config: Omit<typeof alertConfig, 'visible'>) => {
        setAlertConfig({ ...config, visible: true });
    };

    useEffect(() => {
        loadCustomer();
    }, [id, currentRouteCustomers]);

    const loadCustomer = async () => {
        if (!id) return;

        let customerData: any = null;
        let partnerIdToFetch: number | null = null;

        // 1. Try to find in current route first (fastest)
        const routeCust = (currentRouteCustomers || []).find(c =>
            c.id?.toString() === id ||
            c.partner_id?.toString() === id ||
            (partnerId && c.partner_id?.toString() === partnerId)
        );

        if (routeCust) {
            customerData = routeCust;
            if (routeCust.partner_id) {
                partnerIdToFetch = routeCust.partner_id;
            }
        }

        // 2. If not found in route, or if we need to fetch partner details (for total_due)
        // If we have an explicit partnerId param but didn't find in route
        if (!customerData && partnerId) {
            partnerIdToFetch = parseInt(partnerId);
        }
        // If we still don't have data and id looks like a partner ID (fallback)
        if (!customerData && !partnerIdToFetch) {
            // We assume 'id' might be partner_id if not found in route
            partnerIdToFetch = parseInt(id);
        }

        // 3. Fetch Partner Data from DB to get total_due
        if (partnerIdToFetch) {
            try {
                const partner = await getPartnerById(partnerIdToFetch) as any;
                console.log("Fetched partner data for payment:", partner);
                if (partner) {
                    // Merge partner data. Priority to partner name and total_due.
                    customerData = {
                        ...customerData,
                        ...partner,
                        name: partner.name || customerData?.name, // Prefer partner name if available
                        total_due: partner.total_due // Ensure we get total_due
                    };
                }
            } catch (e) {
                console.warn("Failed to fetch partner details:", e);
            }
        }

        console.log("Final Customer Data for Payment:", customerData);

        if (customerData) {
            setCustomer(customerData);
            // Only pre-fill amount if the user hasn't already typed something
            if (!amountTouched) {
                if (invoiceAmount) {
                    setAmount(Math.abs(parseFloat(invoiceAmount)).toFixed(2));
                } else if (customerData.total_due && parseFloat(customerData.total_due) > 0) {
                    setAmount(parseFloat(customerData.total_due).toFixed(2));
                }
            }
        } else {
            // Fallback if absolutely nothing found (e.g. invalid ID)
            console.warn("Could not find customer/partner for id:", id);
        }
    };

    useEffect(() => {
        loadMethods();
    }, []);

    const loadMethods = async () => {
        try {
            const salesRep: any = await getSalesRepresentative();
            let availableMethods: any[] = [];

            if (salesRep) {
                availableMethods = await getSalesRepresentativePaymentMethods(salesRep.odoo_id);
            }

            setMethods(availableMethods);

            if (availableMethods.length > 0) {
                setSelectedMethodId(availableMethods[0].odoo_id);
            }
        } catch (e) {
            console.error('Failed to load payment methods', e);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        const val = parseFloat(amount);
        if (!amount || val <= 0) {
            showAlert({
                title: i18n.t('common.error') || 'Error',
                message: i18n.t('payment.enter_valid_amount'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }

        // Validate against Max Amount (Invoice Amount OR Total Due)
        const totalDue = (customer?.total_due ? parseFloat(customer.total_due) : 0);
        const maxAmount = invoiceAmount ? Math.abs(parseFloat(invoiceAmount)) : (totalDue > 0 ? totalDue : Infinity);

        if (maxAmount > 0 && val > (maxAmount + 0.01)) {
            showAlert({
                title: i18n.t('common.error') || 'Error',
                message: `${i18n.t('payment.amount_exceeds')} (${i18n.t('common.currency_symbol')}${maxAmount.toFixed(2)})`,
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }

        if (!selectedMethodId) {
            showAlert({
                title: i18n.t('common.error') || 'Error',
                message: i18n.t('payment.select_method'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }

        setSubmitting(true);
        try {
            // Find the selected method to get its journal_id if needed, or pass method_id depending on backend requirement
            // For register_payment endpoint (via invoice), we typically need journal_id.
            // For create_payment (direct), we also likely need journal_id.
            // The payment_method table now has journal_id.

            const selectedMethod = methods.find(m => m.odoo_id === selectedMethodId);
            const journalId = selectedMethod?.journal_id;

            if (!journalId) {
                showAlert({
                    title: i18n.t('common.error'),
                    message: i18n.t('payment.method_no_journal'),
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
                return;
            }

            // Try to link to an active visit using Odoo ID, Partner ID or Local ID
            const activeVisit: any = await getActiveVisitForCustomer(
                customer?.odoo_id || null,
                partnerId ? parseInt(partnerId) : (customer?.partner_id || null),
                id ? parseInt(id) : null
            );

            console.log("Active visit detection in payment:", {
                activeVisitId: activeVisit?.local_id,
                activeVisitOdooId: activeVisit?.odoo_id,
                customerId: id,
                partnerId: partnerId
            });

            // Determine which ID is the Partner ID and which is the Route Customer ID
            // customer.id is the local SQLite ID.
            // customer.odoo_id is the Odoo ID (either partner_id or route_customer_id depending on how it was loaded)

            // Re-find in currentRouteCustomers to be absolutely sure we have the route_customer_id
            const rcRecord = (currentRouteCustomers || []).find(c =>
                c.id?.toString() === id ||
                (customer && c.odoo_id === customer.odoo_id && c.partner_id)
            );

            const pId = partnerId ? parseInt(partnerId) : (rcRecord?.partner_id || customer?.partner_id || customer?.odoo_id || (id ? parseInt(id) : null));
            const rcId = rcRecord ? rcRecord.odoo_id : null;

            const payload = {
                partner_id: pId,
                journal_id: journalId,
                amount: parseFloat(amount),
                memo: memo.trim() || `${i18n.t('payment.payment_prefix')}${customer?.name || partnerName || ''}`,
                route_customer_id: rcId,
                route_id: currentRoute?.odoo_id || null,
                payment_method_id: selectedMethodId,
                visit_id: activeVisit?.odoo_id || null,
                visit_local_id: activeVisit?.local_id || null,
                // Pass order_id so backend reconciles the correct invoice (not FIFO)
                // Strict check: must be a numeric string or number, not a local ID like "coll_..."
                order_id: (orderOdooId && !isNaN(Number(orderOdooId)) && parseInt(orderOdooId) > 0) ? parseInt(orderOdooId) : null,
                invoice_id: invoiceId ? parseInt(invoiceId) : null,
            };


            const collectionId = await insertLocalCollection({
                visit_local_id: activeVisit?.local_id || null,
                partner_id: pId,
                amount: parseFloat(amount),
                currency_id: null, // Default
                payment_method: selectedMethod?.name || i18n.t('common.unknown'),
                payment_method_id: selectedMethodId,
                collection_date: new Date().toISOString(),
                reference: memo.trim() || `${i18n.t('payment.payment_prefix')}${customer?.name || partnerName || ''}`,
                state: 'draft',
                order_id: payload.order_id,
                journal_id: parseInt(journalId),
                route_id: currentRoute?.odoo_id || null,
                route_customer_id: rcId
            });

            await useOfflineStore.getState().recordPendingAction({
                action_type: invoiceId ? 'register_payment' : 'create_payment',
                payload: {
                    ...payload,
                    local_id: collectionId,
                    order_local_id: orderLocalId || null,
                },
                related_id: customer?.odoo_id?.toString() || id?.toString(),
            });

            // Optimistic update: set correct payment state based on amount paid vs invoice amount
            const amountPaid = parseFloat(amount);
            const maxAmount = invoiceAmount ? parseFloat(invoiceAmount) : 0;
            // If paying less than the full invoice, it's a partial payment
            const optimisticState = (maxAmount > 0 && amountPaid < (maxAmount - 0.01)) ? 'partial' : 'in_payment';
            if (orderOdooId && parseInt(orderOdooId) > 0) {
                await updateLocalOrderPaymentState(parseInt(orderOdooId), optimisticState, isRefund === 'true' ? -amountPaid : amountPaid);
            } else if (orderLocalId) {
                await updateLocalOrderPaymentState(orderLocalId, optimisticState, isRefund === 'true' ? -amountPaid : amountPaid);
            }


            // Refresh stats to show new collection on dashboard
            fetchDashboardStats();

            // Auto-end visit if in progress
            const currentCustomer = currentRouteCustomers.find(c =>
                c.id.toString() === id ||
                c.partner_id?.toString() === id ||
                (partnerId && c.partner_id?.toString() === partnerId)
            );

            if (currentCustomer && currentCustomer.state === 'in_progress') {
                console.log('Attempting to auto-end visit after payment for customer:', currentCustomer.id);
                try {
                    await endVisit(currentCustomer.id, {
                        visit_result: 'successful',
                        notes: i18n.t('visit.auto_ended_payment'),
                    });
                    console.log('Visit auto-ended successfully for customer:', currentCustomer.id);
                } catch (visitErr) {
                    console.error('Failed to auto-end visit after payment:', visitErr);
                }
            } else {
                console.log('No auto-end needed. Customer state:', currentCustomer?.state);
            }

            showAlert({
                title: i18n.t('common.success') || 'Success',
                message: i18n.t('payment.queued_success') + (currentCustomer?.state === 'in_progress' ? i18n.t('common.and') + i18n.t('visit.ended') : ""),
                onConfirm: () => {
                    setAlertConfig(prev => ({ ...prev, visible: false }));
                    router.back();
                }
            });
        } catch (e: any) {
            showAlert({
                title: i18n.t('common.error') || 'Error',
                message: e.message || i18n.t('payment.create_failed'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </SafeAreaView>
        );
    }


    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={() => {
                    if (router.canGoBack()) {
                        router.back();
                    } else {
                        // Fallback if stack is empty (e.g. deep link or reload)
                        router.navigate('/(drawer)/routes');
                    }
                }}>
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>
                        {isRefund === 'true' ? (i18n.t('payment.refund_title') || 'Issue Refund') : i18n.t('payment.collect_payment')}
                    </Text>
                    <Text style={[styles.headerSubtitle, { color: colors.subtext }]} numberOfLines={1}>
                        {customer?.name || partnerName || `${i18n.t('common.customer_id_prefix')}${id}`}
                    </Text>
                </View>
                <View style={{ width: 24 }} />
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={styles.content}>
                    {/* Amount Section */}
                    <View style={[styles.amountSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.amountLabel, { color: colors.subtext }]}>
                            {i18n.t('payment.amount')}
                        </Text>
                        <View style={styles.amountRow}>
                            <Text style={[styles.currencySymbol, { color: colors.primary }]}>{i18n.t('common.currency_symbol')}</Text>
                            <TextInput
                                style={[styles.amountInput, { color: colors.text }]}
                                placeholder="0.00"
                                placeholderTextColor={colors.subtext}
                                keyboardType="numeric"
                                value={amount}
                                onChangeText={(val) => { setAmount(val); setAmountTouched(true); }}
                                autoFocus
                            />
                        </View>
                        {(invoiceAmount && parseFloat(invoiceAmount) > 0) ? (
                            <View style={styles.dueRow}>
                                <Text style={[styles.dueLabel, { color: colors.subtext }]}>
                                    {i18n.t('payment.order_due') || 'Order Due'}:
                                </Text>
                                <Text style={[styles.dueValue, { color: colors.danger }]}>
                                    {i18n.t('common.currency_symbol')}{Math.abs(parseFloat(invoiceAmount)).toFixed(2)}
                                </Text>
                            </View>
                        ) : (
                            customer?.total_due !== undefined && customer.total_due > 0 && (
                                <View style={styles.dueRow}>
                                    <Text style={[styles.dueLabel, { color: colors.subtext }]}>
                                        {i18n.t('payment.total_due')}:
                                    </Text>
                                    <Text style={[styles.dueValue, { color: colors.danger }]}>
                                        {i18n.t('common.currency_symbol')}{parseFloat(customer.total_due).toFixed(2)}
                                    </Text>
                                </View>
                            )
                        )}
                    </View>

                    {/* Payment Method */}
                    <View style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.fieldHeader}>
                            <Ionicons name="card-outline" size={20} color={colors.primary} />
                            <Text style={[styles.fieldLabel, { color: colors.text }]}>
                                {i18n.t('payment.method')}
                            </Text>
                        </View>
                        <View style={{ marginBottom: 12 }}>
                            <CustomDropdown
                                items={methods.map(m => ({ label: m.name, value: m.odoo_id }))}
                                selectedValue={selectedMethodId}
                                onSelect={(val) => setSelectedMethodId(val as number)}
                            />
                        </View>
                    </View>

                    {/* Memo */}
                    <View style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.fieldHeader}>
                            <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                            <Text style={[styles.fieldLabel, { color: colors.text }]}>
                                {i18n.t('payment.memo')}
                            </Text>
                        </View>
                        <TextInput
                            style={[styles.memoInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                            placeholder={i18n.t('payment.memo_placeholder')}
                            placeholderTextColor={colors.subtext}
                            value={memo}
                            onChangeText={setMemo}
                        />
                    </View>

                    {/* Offline indicator */}
                    {isOffline && (
                        <View style={[styles.offlineNote, { backgroundColor: '#fef3c720' }]}>
                            <Ionicons name="cloud-offline-outline" size={18} color="#f59e0b" />
                            <Text style={{ color: '#f59e0b', fontSize: 13, marginLeft: 8, flex: 1 }}>
                                {i18n.t('payment.offline_note')}
                            </Text>
                        </View>
                    )}
                </ScrollView>

                {/* Submit Button */}
                <View style={[styles.footer, { borderTopColor: colors.border }]}>
                    <TouchableOpacity
                        style={[styles.submitBtn, { backgroundColor: amount && parseFloat(amount) > 0 ? colors.primary : colors.border }]}
                        onPress={handleSubmit}
                        disabled={submitting || !amount || parseFloat(amount) <= 0}
                    >
                        {submitting ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <>
                                <Ionicons name="checkmark-circle" size={22} color="#fff" />
                                <Text style={styles.submitBtnText}>
                                    {amount && parseFloat(amount) > 0
                                        ? `${isRefund === 'true' ? (i18n.t('payment.confirm_refund') || 'Confirm Refund') : i18n.t('payment.confirm')} ${i18n.t('common.currency_symbol')}${parseFloat(amount).toFixed(2)}`
                                        : i18n.t('payment.enter_amount')}
                                </Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>

            <CustomAlert
                visible={alertConfig.visible}
                title={alertConfig.title}
                message={alertConfig.message}
                confirmText={alertConfig.confirmText}
                cancelText={alertConfig.cancelText}
                onConfirm={alertConfig.onConfirm}
                onCancel={alertConfig.onCancel}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    headerSubtitle: { fontSize: 13, marginTop: 2 },
    content: { padding: 20, gap: 16 },
    /* Amount */
    amountSection: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 20,
        alignItems: 'center',
    },
    amountLabel: { fontSize: 14, fontWeight: '600', marginBottom: 12 },
    amountRow: { flexDirection: 'row', alignItems: 'center' },
    currencySymbol: { fontSize: 32, fontWeight: '700', marginRight: 4 },
    amountInput: { fontSize: 36, fontWeight: '700', minWidth: 150, textAlign: 'center' },
    dueRow: { flexDirection: 'row', marginTop: 12, gap: 6 },
    dueLabel: { fontSize: 13 },
    dueValue: { fontSize: 13, fontWeight: '700' },
    /* Field cards */
    fieldCard: { borderRadius: 14, borderWidth: 1, padding: 16 },
    fieldHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    fieldLabel: { fontSize: 15, fontWeight: '600' },
    pickerWrap: { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
    memoInput: {
        borderRadius: 10, borderWidth: 1, padding: 14, fontSize: 15,
    },
    offlineNote: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        borderRadius: 10,
    },
    /* Footer */
    footer: { padding: 20, borderTopWidth: 1 },
    submitBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        paddingVertical: 16,
        gap: 10,
    },
    submitBtnText: { fontSize: 17, fontWeight: '700', color: '#fff' },
});
