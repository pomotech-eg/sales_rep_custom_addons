import React, { useEffect, useState, useCallback } from 'react';
import { CustomAlert } from '../../../components/CustomAlert';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useThemeStore } from '../../../store/useThemeStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { getOrderWithLines, updateLocalOrderState, updateLocalOrderLine, removeLocalOrderLine, updateLocalOrderInvoiceStatus, updateAllLinesInvoiced, updateLocalOrderPaymentState, updateLocalOrderAfterReturn, getLoyaltyPrograms, getPartnerById, applyLocalPromotion, getPendingActions, getProducts, addLocalOrderLine, getPendingReturnsForOrder, getUomsByCategory, getUomByOdooId, getLocalUnsyncedOrdersTotal, getLocalUnsyncedCreditExposure, updateLocalOrderDiscount, updateOrderCashStatus } from '../../../services/database/repositories';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, ScrollView, TextInput, FlatList, Dimensions, Switch, Image, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import i18n from '../../../i18n';
import { useOfflineStore } from '../../../store/useOfflineStore';
import { getLoyaltyInfo } from '../../../services/api/customerService';
import { applyPromotion, getOrderDetails } from '../../../services/api/orderService';
import { getInvoiceDetails } from '../../../services/api/accountService';
import { getPendingReturns, validateReturns } from '../../../services/api/stockService';
import PdfService from '../../../services/PdfService';
import PromotionsModal, { Promotion } from '../../../components/PromotionsModal';
import BottomSheetModal from '../../../components/BottomSheetModal';
import { Dropdown } from '../../../components/CustomDropdown';
import { AttachmentSection } from '../../../components/AttachmentSection';

// Removed static STATE_LABELS to allow dynamic i18n switching

const STATE_COLORS: Record<string, string> = {
    draft: '#94a3b8',
    sent: '#60a5fa',
    sale: '#34d399',
    done: '#818cf8',
    cancel: '#f87171',
};

// Removed static PAYMENT_STATE_LABELS

const PAYMENT_STATE_COLORS: Record<string, string> = {
    'not_paid': '#6b7280', // gray
    'in_payment': '#3b82f6', // blue
    'paid': '#22c55e', // green
    'partial': '#f59e0b', // orange
    'reversed': '#ef4444', // red
    'invoicing_legacy': '#6b7280',
};

function OrderDetails() {
    const { id, orderId, orderType } = useLocalSearchParams<{ id: string; orderId: string; orderType: string }>();
    const { colors } = useThemeStore();
    const router = useRouter();
    const { lastSyncTime, recordPendingAction } = useOfflineStore();

    const [order, setOrder] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [uomPickerVisible, setUomPickerVisible] = useState(false);
    const [selectedLine, setSelectedLine] = useState<any>(null);
    const [availableUoms, setAvailableUoms] = useState<any[]>([]);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [pendingReturnPickings, setPendingReturnPickings] = useState<number[]>([]);
    const [pendingReturnTally, setPendingReturnTally] = useState<{ [productId: number]: number }>({});
    const [promotionModalVisible, setPromotionModalVisible] = useState(false);
    const [promotions, setPromotions] = useState<Promotion[]>([]);
    const [loadingPromotions, setLoadingPromotions] = useState(false);
    const [creditPoints, setCreditPoints] = useState(0);
    const [pointsToEarn, setPointsToEarn] = useState(0);
    const [partnerName, setPartnerName] = useState<string | null>(null);
    const [allInvoices, setAllInvoices] = useState<any[]>([]);
    const [printing, setPrinting] = useState<number | string | null>(null);
    const [totalCredited, setTotalCredited] = useState(0);
    const [netAmount, setNetAmount] = useState<number | null>(null);
    const [totalPaid, setTotalPaid] = useState(0);
    const [discountModalVisible, setDiscountModalVisible] = useState(false);
    const [discountValue, setDiscountValue] = useState('');
    const salesRepProfile = useOfflineStore(state => state.salesRepProfile);

    // Add Product Modal State
    const [productModalVisible, setProductModalVisible] = useState(false);
    const [catalog, setCatalog] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [addingProduct, setAddingProduct] = useState<number | null>(null);
    const [selectedQuantities, setSelectedQuantities] = useState<Record<number, number>>({});
    const [localeVersion, setLocaleVersion] = useState(0);
    const [customer, setCustomer] = useState<any>(null);
    const [unsyncedTotal, setUnsyncedTotal] = useState(0);
    const [exposureBreakdown, setExposureBreakdown] = useState({ draftTotal: 0, confirmedTotal: 0, total: 0 });

    const [attachments, setAttachments] = useState<any[]>([]);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
    const [locallyDeletedFiles, setLocallyDeletedFiles] = useState<Set<string>>(new Set());

    const handleTakeAttachment = async () => {
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert(i18n.t('common.error') || 'Error', 'Camera permission is required to attach images');
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: false,
                quality: 0.8,
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                const uri = asset.uri;

                setIsUploadingAttachment(true);

                // Get name and size
                const name = uri.substring(uri.lastIndexOf('/') + 1) || `attachment_${Date.now()}.jpg`;
                const fileSize = asset.fileSize ? `${(asset.fileSize / 1024).toFixed(1)} KB` : 'Unknown size';

                // Read as base64 for upload sync
                const response = await fetch(uri);
                const blob = await response.blob();

                const base64Clean = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64data = reader.result as string;
                        resolve(base64data.split(',')[1]);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                const newAttachment = {
                    name,
                    file_size: fileSize,
                    uri: uri,
                    base64: base64Clean,
                };

                const updated = [...attachments, newAttachment];
                setAttachments(updated);
                await AsyncStorage.setItem('order_attachments_' + orderId, JSON.stringify(updated));

                // Queue action for syncing the attachment to the Odoo order
                const targetId = order?.odoo_id || order?.local_id;
                await queueAction('upload_attachment', {
                    res_model: 'sale.order',
                    res_id: targetId,
                    file_base64: newAttachment.base64,
                    file_name: newAttachment.name,
                }, undefined, true);

                // Trigger sync if online
                const { syncPendingActionsLightweight } = useOfflineStore.getState();
                await syncPendingActionsLightweight();

                // Refresh order data to get synced attachment URLs
                await loadOrder();
            }
        } catch (e: any) {
            console.error("Failed to take photo:", e);
            Alert.alert(i18n.t('common.error') || 'Error', e.message);
        } finally {
            setIsUploadingAttachment(false);
        }
    };

    const handleDeleteAttachment = async (fileName: string) => {
        try {
            setLocallyDeletedFiles(prev => {
                const next = new Set(prev);
                next.add(fileName);
                return next;
            });

            // 1. Optimistically update UI
            const updated = attachments.filter(att => att.name !== fileName);
            setAttachments(updated);
            await AsyncStorage.setItem('order_attachments_' + orderId, JSON.stringify(updated));

            // 2. Queue action to delete from server
            const targetId = order?.odoo_id || order?.local_id;
            await queueAction('delete_attachment', {
                res_model: 'sale.order',
                res_id: targetId,
                file_name: fileName,
            }, undefined, true);

            // 3. Trigger Sync if Online
            const { syncPendingActionsLightweight } = useOfflineStore.getState();
            await syncPendingActionsLightweight();
        } catch (e: any) {
            console.error("Failed to delete attachment:", e);
            Alert.alert(i18n.t('common.error') || 'Error', e.message);
        }
    };
    const [selectedLocationId, setSelectedLocationId] = useState<string>('');
    const [locationsList, setLocationsList] = useState<any[]>([]);

    const stateLabels = {
        draft: i18n.t('order.status_quotation'),
        sent: i18n.t('order.status_quotation_sent'),
        sale: i18n.t('order.status_sales_order'),
        done: i18n.t('order.status_locked'),
        cancel: i18n.t('order.status_cancelled'),
    };

    const paymentStateLabels = {
        'not_paid': i18n.t('payment.status_not_paid'),
        'in_payment': i18n.t('orders.in_payment'),
        'paid': i18n.t('payment.status_paid'),
        'partial': i18n.t('payment.status_partial'),
        'reversed': i18n.t('invoice.status_reversed'),
        'invoicing_legacy': i18n.t('invoice.status_legacy'),
    };


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

    // Guards to prevent concurrent loadOrder calls
    const isLoadingRef = React.useRef(false);
    const isFocusedRef = React.useRef(false);
    const processedAutoReceives = React.useRef<Set<string>>(new Set());
    const autoProcessingRef = React.useRef(false);

    useFocusEffect(
        useCallback(() => {
            isFocusedRef.current = true;
            processedAutoReceives.current.clear();
            loadOrder();
            return () => { isFocusedRef.current = false; };
        }, [orderId])
    );

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

        const hasExistingLines = order?.lines && order.lines.length > 0;
        if (!hasExistingLines && defaultLocations.length > 0 && !selectedLocationId) {
            setSelectedLocationId(defaultLocations[0].id.toString());
        }
    }, [salesRepProfile, order?.lines]);

    // Reload order whenever a sync completes — but only if screen is focused and not already loading
    useEffect(() => {
        if (lastSyncTime && isFocusedRef.current && !isLoadingRef.current) {
            loadOrder();
        }
    }, [lastSyncTime]);

    useEffect(() => {
        if (order?.partner_id) {
            fetchPromotions();
        }
    }, [order?.partner_id]);

    const fetchPromotions = async () => {
        if (!order?.partner_id) return;
        setLoadingPromotions(true);
        try {
            // 1. Try Local First
            const localPartner = await getPartnerById(order.partner_id);
            if (localPartner) {
                setCreditPoints((localPartner as any).loyalty_points || 0);
            }

            const localPrograms = await getLoyaltyPrograms();
            if (localPrograms && localPrograms.length > 0) {
                setPromotions(localPrograms);
            }

            // 2. Refresh from API if online (silent update or overwrite)
            // Only if we are online and want to refresh
            if (!useOfflineStore.getState().isOffline) {
                const res = await getLoyaltyInfo(order.partner_id);
                if (res.data && res.data.promotions) {
                    setPromotions(res.data.promotions);
                    setCreditPoints(res.data.credit_points || 0);
                }
            }
        } catch (e) {
            console.log("Error loading promotions:", e);
        } finally {
            setLoadingPromotions(false);
        }
    };

    const handleApplyPromotion = async (promotion: Promotion | { id: null, coupon_code: string }) => {
        // ... (existing code)
    };

    const handleApplyDiscount = async () => {
        const val = parseFloat(discountValue);
        if (isNaN(val) || val < 0) {
            showAlert({
                title: i18n.t('order.invalid_discount'),
                message: i18n.t('order.discount_positive_msg'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }

        try {
            setActionLoading('apply_discount');
            await updateLocalOrderDiscount(order.local_id || order.odoo_id, val);

            // Queue Action for Sync
            await queueAction('apply_fixed_discount', {
                order_id: order.odoo_id || order.local_id,
                discount_amount: val
            }, undefined, true);

            setDiscountModalVisible(false);
            await loadOrder();

            // Trigger Sync if Online
            const { triggerSyncIfOnline } = useOfflineStore.getState();
            await triggerSyncIfOnline();
        } catch (e: any) {
            console.error("Discount application failed:", e);
            showAlert({
                title: i18n.t('common.error'),
                message: e.message,
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setActionLoading(null);
        }
    };

    const loadOrder = async () => {
        if (!orderId) return;
        if (isLoadingRef.current) return;  // Prevent concurrent calls
        isLoadingRef.current = true;
        try {
            const identifier = orderType === 'local' ? orderId : parseInt(orderId);
            const result = await getOrderWithLines(identifier);
            console.log("OrderDetails: Loaded order:", result?.name, "ID:", identifier);
            setOrder(result);

            try {
                const stored = await AsyncStorage.getItem('order_attachments_' + orderId);
                if (stored) {
                    setAttachments(JSON.parse(stored));
                } else {
                    setAttachments([]);
                }
            } catch (e) {
                console.error("Failed to load attachments from AsyncStorage:", e);
            }

            if (result?.lines && result.lines.length > 0) {
                const firstLineWithLocation = result.lines.find((l: any) => l.location_id);
                if (firstLineWithLocation) {
                    setSelectedLocationId(firstLineWithLocation.location_id.toString());
                }
            }

            if (result?.partner_id) {
                const partner = await getPartnerById(result.partner_id);
                setCustomer(partner);

                const exposure = await getLocalUnsyncedCreditExposure(result.partner_id);
                setExposureBreakdown(exposure);
                setUnsyncedTotal(exposure.total);
            }

            // Fetch pending invoices too (optimistic UI)
            const pendingActions = await getPendingActions();
            const pendingInvoiceActions = pendingActions.filter((a: any) =>
                a.action_type === 'create_invoice' &&
                (a.payload.order_id === result.odoo_id || a.payload.order_id === result.local_id)
            );

            const localPendingInvoices = pendingInvoiceActions.map((a: any) => ({
                id: a.local_id,
                name: i18n.t('order.pending_invoice'),
                state: 'draft',
                move_type: 'out_invoice',
                amount_total: result.amount_total,
                invoice_date: dayjs().format('YYYY-MM-DD'),
            }));

            // Fetch pending offline returns for this order
            const returnsTally = await getPendingReturnsForOrder(identifier);
            setPendingReturnTally(returnsTally);

            // If online and has odoo_id, fetch extra info (like points_to_earn) from server
            if (!useOfflineStore.getState().isOffline && result.odoo_id) {
                try {
                    const detailsRes = await getOrderDetails(result.odoo_id);
                    const data = detailsRes.data;
                    if (data && data.success) {
                        setPointsToEarn(data.points_to_earn || 0);
                        if (data.order && Array.isArray(data.order.partner_id)) {
                            setPartnerName(data.order.partner_id[1]);
                        }

                        // Merge server's fresh financial/status data into the local order state
                        if (data.order) {
                            setOrder((prev: any) => prev ? {
                                ...prev,
                                amount_residual: data.order.amount_residual,
                                payment_state: data.order.payment_state,
                                invoice_status: data.order.invoice_status,
                                delivery_status: data.order.delivery_status
                            } : prev);
                        }

                        // Merge server invoices with local pending ones
                        const serverInvoices = data.allInvoices || [];
                        setAllInvoices([...serverInvoices, ...localPendingInvoices]);

                        if (data.total_credited !== undefined) setTotalCredited(data.total_credited);
                        if (data.net_amount !== undefined) setNetAmount(data.net_amount);
                        if (data.total_paid !== undefined) setTotalPaid(data.total_paid);

                        // Sync attachments from server if available
                        if (data.attachments && Array.isArray(data.attachments)) {
                            const { useAuthStore } = require('../../../store/useAuthStore');
                            const serverUrl = useAuthStore.getState().serverUrl || '';
                            const base = serverUrl.replace(/\/+$/, '');
                            const syncedAttachments = data.attachments.map((att: any) => ({
                                id: att.id,
                                name: att.name,
                                file_size: att.file_size,
                                uri: att.url.startsWith('http') ? att.url : `${base}${att.url}`,
                            }));

                            // Get pending attachment actions to keep/hide items optimistically
                            const attachmentPending = pendingActions.filter((a: any) =>
                                (a.action_type === 'upload_attachment' || a.action_type === 'delete_attachment') &&
                                String(a.related_id) === String(result.odoo_id || result.local_id)
                            );

                            const pendingDeletes = new Set(
                                attachmentPending
                                    .filter((a: any) => a.action_type === 'delete_attachment')
                                    .map((a: any) => a.payload.file_name)
                            );

                            const pendingUploadNames = new Set(
                                attachmentPending
                                    .filter((a: any) => a.action_type === 'upload_attachment')
                                    .map((a: any) => a.payload.file_name)
                            );

                            // Retrieve local cached files (contain local file URIs/base64)
                            const stored = await AsyncStorage.getItem('order_attachments_' + orderId);
                            const localCached = stored ? JSON.parse(stored) : [];

                            // Filter out deleted ones from synced
                            let combined = syncedAttachments.filter((att: any) => 
                                !pendingDeletes.has(att.name) && !locallyDeletedFiles.has(att.name)
                            );

                            // Add any pending uploads that aren't already synced yet
                            localCached.forEach((lc: any) => {
                                if (pendingUploadNames.has(lc.name) && !pendingDeletes.has(lc.name)) {
                                    if (!combined.some((c: any) => c.name === lc.name)) {
                                        combined.push({ ...lc, isPending: true });
                                    }
                                }
                            });

                            setAttachments(combined);
                            await AsyncStorage.setItem('order_attachments_' + orderId, JSON.stringify(combined));
                        }

                        try {
                            const pendingReturnsRes = await getPendingReturns(result.odoo_id);
                            if (pendingReturnsRes.data?.success && pendingReturnsRes.data.has_pending_returns) {
                                setPendingReturnPickings(pendingReturnsRes.data.picking_ids);
                            } else {
                                setPendingReturnPickings([]);
                            }
                        } catch (e) {
                            console.log("Error fetching pending returns:", e);
                            setPendingReturnPickings([]);
                        }
                    } else {
                        console.log("Server order details fetch failed or returned false success", data);
                        setAllInvoices(localPendingInvoices);
                        setPendingReturnPickings([]);
                    }
                } catch (e) {
                    console.log("Error fetching server order details:", e);
                    setAllInvoices(localPendingInvoices);
                }
            } else {
                setAllInvoices(localPendingInvoices);
            }
        } catch (err) {
            console.error('Failed to load order:', err);
        } finally {
            setLoading(false);
            isLoadingRef.current = false;  // Always release the lock
        }
    };

    const queueAction = async (actionType: string, payload: any, optimisticState?: string, silent: boolean = false) => {
        setActionLoading(actionType);
        try {
            const result = await recordPendingAction({
                action_type: actionType,
                payload,
                related_id: order.local_id || order.odoo_id?.toString(),
            }, async () => {
                if (optimisticState) {
                    await updateLocalOrderState(
                        orderType === 'local' ? orderId : parseInt(orderId),
                        optimisticState
                    );
                }
            });

            if (result?.success === false && (result.error?.includes('Invalid Operation') || result.error?.includes('Credit Limit'))) {
                showAlert({
                    title: i18n.t('order.credit_exceeded'),
                    message: i18n.t('order.credit_block_server_msg'),
                    confirmText: i18n.t('common.ok'),
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
            } else if (result?.success === false && !silent) {
                showAlert({
                    title: i18n.t('common.error'),
                    message: result.error || 'Server returned failure',
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
            }

            await loadOrder(); // Refresh
        } catch (err: any) {
            if (!silent) showAlert({
                title: i18n.t('common.error'),
                message: err.message,
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setActionLoading(null);
        }
    };

    const [pendingPaymentAmount, setPendingPaymentAmount] = useState(0);

    useFocusEffect(
        useCallback(() => {
            loadOrder();
            loadPendingPayments();
        }, [orderId])
    );

    const loadPendingPayments = async () => {
        if (!orderId) return;
        try {
            const pendingActions = await getPendingActions();
            const relevantActions = pendingActions.filter((a: any) =>
                (a.action_type === 'register_payment' || a.action_type === 'create_payment') &&
                (
                    // Match by related_id
                    String(a.related_id) === String(order?.odoo_id) ||
                    String(a.related_id) === String(order?.local_id) ||
                    // Match by payload order_id (Odoo ID)
                    (a.payload?.order_id && (
                        String(a.payload.order_id) === String(order?.odoo_id) ||
                        String(a.payload.order_id) === String(order?.local_id)
                    )) ||
                    // Match by payload order_local_id
                    (a.payload?.order_local_id && (
                        String(a.payload.order_local_id) === String(order?.odoo_id) ||
                        String(a.payload.order_local_id) === String(order?.local_id)
                    ))
                )
            );

            const totalPending = relevantActions.reduce((sum: number, action: any) => {
                const amount = parseFloat(action.payload?.amount || 0);
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0);

            setPendingPaymentAmount(totalPending);
        } catch (e) {
            console.error("Error loading pending payments:", e);
        }
    };

    // Auto-receive returns if enabled in representative profile
    useEffect(() => {
        const repProfile = useOfflineStore.getState().salesRepProfile;
        if (repProfile?.auto_receive === 1 && pendingReturnPickings.length > 0 && !actionLoading && isFocusedRef.current) {
            console.log("Auto-receiving returns for order:", order?.name);
            validatePendingReturns(true); // Silent mode
        }
    }, [pendingReturnPickings, actionLoading]);

    const handleConfirm = async () => {
        // --- Credit Limit Check ---
        if (customer && (customer.sale_credit_limit > 0)) {
            const limit = customer.sale_credit_limit || 0;
            const syncedUsed = customer.sale_credit_used || 0;
            const allowOverCredit = customer.allow_over_sale_credit || false;

            // Total used = synced (confirmed) + unsynced (not in Odoo) + this order (if in Odoo but not confirmed)
            const isSynced = !!order.is_synced || !!order.odoo_id;
            const thisOrderAmount = order.amount_total || 0;
            const totalUsed = syncedUsed + unsyncedTotal + (isSynced ? thisOrderAmount : 0);

            const usagePercent = (totalUsed / limit) * 100;
            const isExceeded = totalUsed > limit;

            if (isExceeded && !allowOverCredit) {
                const otherPending = unsyncedTotal - (isSynced ? 0 : thisOrderAmount);
                const remaining = Math.max(0, limit - syncedUsed - otherPending);
                showAlert({
                    title: i18n.t('order.credit_exceeded'),
                    message: `${i18n.t('order.credit_block_message')}\n\n` +
                        `${i18n.t('order.credit_limit_label')}: ${i18n.t('common.currency_symbol')}${limit.toFixed(2)}\n` +
                        `${i18n.t('order.credit_used')}: ${i18n.t('common.currency_symbol')}${syncedUsed.toFixed(2)}\n` +
                        (otherPending > 0 ? `${i18n.t('order.credit_pending')}: ${i18n.t('common.currency_symbol')}${otherPending.toFixed(2)}\n` : '') +
                        `${i18n.t('order.this_order')}: ${i18n.t('common.currency_symbol')}${thisOrderAmount.toFixed(2)}\n` +
                        `${i18n.t('order.credit_remaining')}: ${i18n.t('common.currency_symbol')}${remaining.toFixed(2)}`,
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
                return;
            }

            if (isExceeded) {
                const proceed = await new Promise<boolean>((resolve) => {
                    showAlert({
                        title: i18n.t('order.credit_warning'),
                        message: `${i18n.t('order.credit_warn_message')}\n\n` +
                            `${i18n.t('order.credit_usage')}: ${usagePercent.toFixed(0)}%\n` +
                            `${i18n.t('order.credit_limit_label')}: ${i18n.t('common.currency_symbol')}${limit.toFixed(2)}\n` +
                            `${i18n.t('order.credit_total')}: ${i18n.t('common.currency_symbol')}${totalUsed.toFixed(2)}`,
                        confirmText: i18n.t('common.confirm'),
                        cancelText: i18n.t('common.cancel'),
                        onConfirm: () => {
                            setAlertConfig(prev => ({ ...prev, visible: false }));
                            resolve(true);
                        },
                        onCancel: () => {
                            setAlertConfig(prev => ({ ...prev, visible: false }));
                            resolve(false);
                        }
                    });
                });
                if (!proceed) return;
            }
        }
        // --- End Credit Limit Check ---

        const identifier = order.odoo_id ? { order_id: order.odoo_id } : { local_id: order.local_id };
        const autoDelivery = useOfflineStore.getState().salesRepProfile?.auto_delivery;

        showAlert({
            title: i18n.t('order.confirm_order_lock'),
            message: i18n.t('order.confirm_lock_msg'),
            confirmText: i18n.t('common.confirm'),
            cancelText: i18n.t('common.cancel'),
            onConfirm: async () => {
                setAlertConfig(prev => ({ ...prev, visible: false }));
                await queueAction('confirm_order', identifier, 'sale');

                if (!order.odoo_id) {
                    await updateLocalOrderState(order.local_id, 'sale');
                }

                // Recalculate promotions locally so they immediately show as confirmed offline
                await applyLocalPromotion(order.local_id || order.odoo_id);

                // Auto-Delivery & Invoice
                if (autoDelivery) {
                    // Construct "Deliver All" payload
                    const lineQuantities = (order.lines || []).map((l: any) => ({
                        line_id: l.odoo_id || l.id,
                        quantity: l.product_uom_qty // Deliver full qty
                    }));

                    // Build delivered_quantities keyed by product_id (backend expects this format)
                    // SUM quantities when multiple lines share the same product_id
                    // (e.g., paid line qty=3 + free reward line qty=1 → {"17": 4})
                    const deliveredQuantities: Record<string, number> = {};
                    (order.lines || []).forEach((l: any) => {
                        if (l.product_id) {
                            const key = String(l.product_id);
                            // Convert to reference UoM quantity: qty / factor
                            const factor = l.uom_factor || 1;
                            const referenceQty = (l.product_uom_qty || 0) / factor;
                            deliveredQuantities[key] = (deliveredQuantities[key] || 0) + referenceQty;
                        }
                    });

                    const deliveryPayload = {
                        order_id: order.odoo_id || order.local_id,
                        lines: lineQuantities,
                        delivered_quantities: deliveredQuantities,
                    };

                    // 1. Queue Delivery
                    await queueAction('process_delivery', deliveryPayload, undefined, true);

                    // 2. Queue Invoice
                    const repProfile = useOfflineStore.getState().salesRepProfile;
                    const invoicePayload = {
                        order_id: order.odoo_id || order.local_id,
                        journal_id: repProfile?.invoice_journal_id || undefined
                    };
                    await queueAction('create_invoice', invoicePayload, undefined, true);

                    // Optimistic Updates
                    // Update lines to be delivered
                    await Promise.all((order.lines || []).map(async (l: any) => updateLocalOrderLine(l.id, { qty_delivered: l.product_uom_qty })));
                    await updateLocalOrderState(order.local_id || order.odoo_id, undefined, 'full');
                    if (order.odoo_id) {
                        await updateLocalOrderInvoiceStatus(order.odoo_id, 'invoiced');
                        await updateAllLinesInvoiced(order.odoo_id);
                    }


                    // Success alert removed
                }

                loadOrder();
            },
            onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false }))
        });
    };

    const handleCancel = () => {
        // Allow cancelling local orders too
        const identifier = order.odoo_id ? { order_id: order.odoo_id } : { local_id: order.local_id };
        showAlert({
            title: i18n.t('order.cancel_title'),
            message: i18n.t('order.cancel_msg'),
            confirmText: i18n.t('order.yes_cancel'),
            cancelText: i18n.t('common.ok'),
            onConfirm: async () => {
                setAlertConfig(prev => ({ ...prev, visible: false }));
                await queueAction('cancel_order', identifier, 'cancel');
                if (!order.odoo_id) {
                    await updateLocalOrderState(order.local_id, 'cancel');
                    loadOrder();
                }
            },
            onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false }))
        });
    };

    const isReadOnly = order?.state !== 'draft' && order?.state !== 'sent';
    const effectiveIsCash = order?.master_is_cash === 1 ? true : (order?.is_cash === 1);
    const canChange = !isReadOnly && order?.master_is_cash !== 1;

    const handleToggleCash = async (value: boolean) => {
        if (!order || isReadOnly) return;

        try {
            // Update local DB
            await updateOrderCashStatus(order.local_id || order.odoo_id, value);

            // Queue sync action
            if (order.odoo_id) {
                await queueAction('update_order', {
                    order_id: order.odoo_id,
                    is_cash: value
                });
            }

            // Reload UI
            loadOrder();
        } catch (error) {
            console.error('Error toggling cash status:', error);
        }
    };


    const handleProcessDelivery = () => {
        if (!order) return;

        // Allow delivery processing for any confirmed order ('sale' state), 
        // even if it hasn't been synced (no odoo_id) yet.
        router.push({
            pathname: `/customer/${id}/delivery` as any,
            params: {
                orderId: orderType === 'local' ? orderId : order.odoo_id
            }
        });
    };

    const handleUpdateLineQty = async (lineId: number | string, newQty: number) => {
        if (newQty <= 0) {
            handleRemoveLine(lineId);
            return;
        }

        // Find the line to check stock
        const line = order.lines?.find((l: any) => l.id === lineId);
        const maxQty = line?.product_free_qty ?? Infinity;

        if (newQty > maxQty && newQty > (line?.product_uom_qty || 0)) {
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('order.stock_limit_exceeded'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }

        const isLocalOnly = !order.odoo_id || orderType === 'local';

        // 1. Optimistically Update Local DB first
        await updateLocalOrderLine(Number(lineId), { quantity: newQty });

        // 2. Queue appropriate sync actions
        if (!isLocalOnly) {
            if (line?.odoo_id) {
                const payload = { order_id: order.odoo_id, line_id: line.odoo_id, quantity: newQty };
                await queueAction('update_order_line', payload, undefined, true);
            } else {
                const payload = { order_id: order.odoo_id, product_id: line?.product_id, quantity: newQty, price_unit: line?.price_unit };
                await queueAction('add_order_line', payload, undefined, true);
            }
        } else {
            // Local order updating a local line.
            const payload = { local_order_id: order.local_id, line_id: lineId, quantity: newQty, is_local_line: true };
            await queueAction('update_order_line', payload, undefined, true);
        }

        // 3. Recalculate promotions
        await applyLocalPromotion(order.local_id || order.odoo_id);

        // 4. Reload UI state
        await loadOrder();
    };

    const handleUpdateLineUom = async (lineId: number | string, uom: any) => {
        const line = order.lines?.find((l: any) => l.id === lineId);
        if (!line) return;

        // Calculate new unit price
        // price_unit_new = price_unit_old * (old_factor / new_factor)
        // Wait, line.price_unit is the price for line.product_uom_name.
        // We need the reference factor of the current UoM.

        const oldUom = await getUomByOdooId(line.product_uom_id);
        const oldFactor = oldUom?.factor || 1;
        const newFactor = uom.factor || 1;
        const newPriceUnit = (line.price_unit * oldFactor) / newFactor;

        // 1. Update Local DB
        await updateLocalOrderLine(Number(lineId), {
            product_uom_id: uom.odoo_id,
            product_uom_name: uom.name,
            price_unit: newPriceUnit
        });

        // 2. Queue sync action if needed
        if (order.odoo_id) {
            // Backend update_order_line usually accepts uom_id
            const payload = {
                order_id: order.odoo_id,
                line_id: line.odoo_id,
                uom_id: uom.odoo_id,
                quantity: line.product_uom_qty, // Explicitly maintain quantity to prevent backend recalculation
                price_unit: newPriceUnit // Most backends will recalculate anyway, but good to send
            };
            await queueAction('update_order_line', payload, undefined, true);
        }

        // 3. Reload
        await loadOrder();
        setUomPickerVisible(false);
    };

    const handleRemoveLine = (lineId: number | string) => {
        showAlert({
            title: i18n.t('order.remove_line'),
            message: i18n.t('order.remove_confirm'),
            confirmText: i18n.t('common.confirm'),
            cancelText: i18n.t('common.cancel'),
            onConfirm: async () => {
                setAlertConfig(prev => ({ ...prev, visible: false }));
                const line = order.lines?.find((l: any) => l.id === lineId);

                if (order.odoo_id) {
                    if (line?.odoo_id) {
                        const payload = { order_id: order.odoo_id, line_id: line.odoo_id };
                        await queueAction('remove_order_line', payload, undefined, true);
                    } else {
                        const payload = { order_id: order.odoo_id, product_id: line?.product_id, quantity: 0, price_unit: line?.price_unit };
                        await queueAction('add_order_line', payload, undefined, true);
                    }
                }

                await removeLocalOrderLine(Number(lineId));
                // Recalculate promotions
                await applyLocalPromotion(order.local_id || order.odoo_id);
                await loadOrder();
            },
            onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false }))
        });
    };

    const handleReturn = () => {
        const orderIdentifier = order.odoo_id || order.local_id;
        if (!orderIdentifier) return;
        const pickingIds = order.picking_ids ? JSON.parse(order.picking_ids || '[]') : [];

        // If it is a synced order, it MUST have a picking to return.
        // If it is unsynced and pending, it cannot be returned.
        if (pickingIds.length === 0 && (order.odoo_id || order.delivery_status === 'pending')) {
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('returns.no_delivery'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }
        // Prefer allInvoices state (server data) -> falling back to order.invoice_ids (local data)
        const currentInvoiceIds = allInvoices
            .filter(inv => inv.move_type === 'out_invoice')
            .map(inv => inv.odoo_id || inv.id); // inv.id might be odoo_id or local_id

        const localInvoiceIds = order.invoice_ids ? JSON.parse(order.invoice_ids || '[]') : [];

        // Combine and uniquify
        const finalInvoiceIds = Array.from(new Set([...currentInvoiceIds, ...localInvoiceIds]));

        router.push({
            pathname: `/customer/${id}/returns` as any,
            params: {
                orderId: orderIdentifier,
                pickingId: pickingIds.join(','), // Pass all picking IDs as comma-separated
                invoiceId: finalInvoiceIds.join(',') || '', // Support multiple invoices too
            }
        });
    };

    const validatePendingReturns = useCallback(async (silent: boolean = false) => {
        if (pendingReturnPickings.length === 0 || autoProcessingRef.current) return;

        // Filter out pickings we already processed in this session auto-flow
        const toProcess = pendingReturnPickings.filter(id => !processedAutoReceives.current.has(id.toString()));
        if (toProcess.length === 0 && silent) return;

        autoProcessingRef.current = true;
        setActionLoading('receive_returns');
        try {
            // Optimistically mark as processed
            toProcess.forEach(id => processedAutoReceives.current.add(id.toString()));
            const payload = { picking_ids: toProcess };

            // Clear locally immediately to prevent re-triggering useEffect
            setPendingReturnPickings([]);

            await queueAction('receive_returns', payload, undefined, true);

            // Optimistically update order status
            if (order?.odoo_id) {
                // Determine if fully returned by checking if any item still has delivered quantity > 0
                // (This assumes returns have been processed and reflected in qty_delivered or we use local lines)
                const lines = order.lines || [];
                const isFullyReturned = lines.every((l: any) => (l.qty_delivered || 0) <= 0);
                await updateLocalOrderAfterReturn(order.odoo_id, isFullyReturned);
            }

            if (!silent) {
                showAlert({
                    title: i18n.t('common.success'),
                    message: i18n.t('returns.products_received'),
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
            }
            await loadOrder();
        } catch (e: any) {
            console.error("Receive returns failed:", e);
            // If failed, we might want to allow retrying, so remove from processed set
            toProcess.forEach(id => processedAutoReceives.current.delete(id.toString()));

            if (!silent) {
                showAlert({
                    title: i18n.t('common.error'),
                    message: e.message || i18n.t('common.error'),
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
            }
        } finally {
            setActionLoading(null);
            autoProcessingRef.current = false;
        }
    }, [pendingReturnPickings, queueAction, loadOrder]);

    const handleReceiveReturns = async () => {
        if (pendingReturnPickings.length === 0) return;

        showAlert({
            title: i18n.t('returns.receive_products'),
            message: i18n.t('returns.confirm_receive'),
            confirmText: i18n.t('common.confirm'),
            cancelText: i18n.t('common.cancel'),
            onConfirm: () => {
                setAlertConfig(prev => ({ ...prev, visible: false }));
                validatePendingReturns(false);
            },
            onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false }))
        });
    };

    const handleRegisterPayment = () => {
        // Allow payment for local orders if they are confirmed (sales order)
        if (!order.odoo_id && order.state !== 'sale') return;

        router.push({
            pathname: `/customer/${id}/payment` as any,
            params: {
                orderId: order.odoo_id || order.local_id, // Pass local ID if Odoo ID missing
                invoiceAmount: order.amount_residual?.toString() || '0',
                partnerId: order.partner_id?.toString() || order.route_customer_id?.toString(),
                partnerName: partnerName || (Array.isArray(order.partner_id) ? order.partner_id[1] : (order.customer_name || '')),
                orderLocalId: order.local_id || '',
                orderOdooId: order.odoo_id?.toString() || '',
            }
        });
    };

    const handleRefundInvoice = (inv: any) => {
        router.push({
            pathname: `/customer/${id}/payment` as any,
            params: {
                orderId: order.odoo_id || order.local_id,
                invoiceAmount: Math.abs(inv.amount_residual || inv.amount_total).toString(),
                partnerId: order.partner_id?.toString() || order.route_customer_id?.toString(),
                partnerName: partnerName || (Array.isArray(order.partner_id) ? order.partner_id[1] : (order.customer_name || '')),
                orderLocalId: order.local_id || '',
                orderOdooId: order.odoo_id?.toString() || '',
                invoiceId: inv.id?.toString() || '',
                isRefund: 'true'
            }
        });
    };


    const handleCreateInvoice = async () => {
        if (!order.odoo_id) return;

        // --- Credit Limit Check ---
        if (customer && (customer.sale_credit_limit > 0)) {
            const limit = customer.sale_credit_limit || 0;
            const syncedUsed = customer.sale_credit_used || 0;
            const allowOverCredit = customer.allow_over_sale_credit || false;

            const isSynced = !!order.is_synced || !!order.odoo_id;
            const thisOrderAmount = order.amount_total || 0;
            const totalUsed = syncedUsed + unsyncedTotal + (isSynced ? thisOrderAmount : 0);

            const usagePercent = (totalUsed / limit) * 100;
            const isExceeded = totalUsed > limit;

            if (isExceeded && !allowOverCredit) {
                const otherPending = unsyncedTotal - (isSynced ? 0 : thisOrderAmount);
                const remaining = Math.max(0, limit - syncedUsed - otherPending);
                showAlert({
                    title: i18n.t('order.credit_exceeded'),
                    message: `${i18n.t('order.credit_block_message')}\n\n` +
                        `${i18n.t('order.credit_limit_label')}: ${i18n.t('common.currency_symbol')}${limit.toFixed(2)}\n` +
                        `${i18n.t('order.credit_used')}: ${i18n.t('common.currency_symbol')}${syncedUsed.toFixed(2)}\n` +
                        (otherPending > 0 ? `${i18n.t('order.credit_pending')}: ${i18n.t('common.currency_symbol')}${otherPending.toFixed(2)}\n` : '') +
                        `${i18n.t('order.this_order')}: ${i18n.t('common.currency_symbol')}${thisOrderAmount.toFixed(2)}\n` +
                        `${i18n.t('order.credit_remaining')}: ${i18n.t('common.currency_symbol')}${remaining.toFixed(2)}`,
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
                return;
            }

            if (isExceeded) {
                const proceed = await new Promise<boolean>((resolve) => {
                    showAlert({
                        title: i18n.t('order.credit_warning'),
                        message: `${i18n.t('order.credit_warn_message')}\n\n` +
                            `${i18n.t('order.credit_usage')}: ${usagePercent.toFixed(0)}%\n` +
                            `${i18n.t('order.credit_limit_label')}: ${i18n.t('common.currency_symbol')}${limit.toFixed(2)}\n` +
                            `${i18n.t('order.credit_total')}: ${i18n.t('common.currency_symbol')}${totalUsed.toFixed(2)}`,
                        confirmText: i18n.t('common.proceed'),
                        cancelText: i18n.t('common.cancel'),
                        onConfirm: () => {
                            setAlertConfig(prev => ({ ...prev, visible: false }));
                            resolve(true);
                        },
                        onCancel: () => {
                            setAlertConfig(prev => ({ ...prev, visible: false }));
                            resolve(false);
                        }
                    });
                });
                if (!proceed) return;
            }
        }
        // --- End Credit Limit Check ---

        const repProfile = useOfflineStore.getState().salesRepProfile;
        const invoicePayload = {
            order_id: order.odoo_id,
            journal_id: repProfile?.invoice_journal_id || undefined
        };
        showAlert({
            title: i18n.t('order.create_invoice'),
            message: i18n.t('order.create_invoice_msg'),
            confirmText: i18n.t('common.confirm'),
            cancelText: i18n.t('common.cancel'),
            onConfirm: async () => {
                setAlertConfig(prev => ({ ...prev, visible: false }));
                await queueAction('create_invoice', invoicePayload, undefined, false);
                // Optimistic update
                await updateLocalOrderInvoiceStatus(order.odoo_id, 'invoiced');
                await updateAllLinesInvoiced(order.odoo_id);
                await loadOrder();
            },
            onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false }))
        });
    };

    const handlePrintInvoice = async (invoiceId: number) => {
        try {
            setPrinting(invoiceId);
            const response = await getInvoiceDetails(invoiceId);
            if (response.data?.success && response.data.invoice) {
                await PdfService.printInvoice(response.data.invoice);
            } else {
                showAlert({
                    title: i18n.t('common.error'),
                    message: i18n.t('order.fetch_invoice_error'),
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
            }
        } catch (error) {
            console.error('Print error:', error);
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('order.print_error'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setPrinting(null);
        }
    };

    const handlePrintAllInvoices = async () => {
        try {
            setPrinting('all');
            const postedInvoices = allInvoices.filter(inv => inv.state === 'posted');
            if (postedInvoices.length === 0) {
                showAlert({
                    title: i18n.t('common.info'),
                    message: i18n.t('order.no_posted_invoices'),
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
                return;
            }

            // Show a simple loading if there are many
            const invoiceDetailsPromises = postedInvoices.map(inv => getInvoiceDetails(inv.id));
            const responses = await Promise.all(invoiceDetailsPromises);

            const detailedInvoices = responses
                .filter(res => res.data?.success && res.data.invoice)
                .map(res => res.data.invoice);

            if (detailedInvoices.length > 0) {
                await PdfService.printAllInvoices(detailedInvoices);
            } else {
                showAlert({
                    title: i18n.t('common.error'),
                    message: i18n.t('order.fetch_invoice_error'),
                    onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
            }
        } catch (error) {
            console.error('Print All error:', error);
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('order.print_error'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setPrinting(null);
        }
    };

    const formatCurrency = (amount: number | null) => {
        if (amount === null || amount === undefined) return '—';
        const sign = amount < 0 ? '-' : '';
        return `${sign}${i18n.t('common.currency_symbol')}${Math.abs(amount).toFixed(2)}`;
    };

    const [totalDbProducts, setTotalDbProducts] = useState<number | null>(null);

    const fetchCatalog = async () => {
        setLoadingProducts(true);
        try {
            const locId = selectedLocationId ? parseInt(selectedLocationId) : undefined;
            const products = await getProducts(false, locId);
            console.log("Products data in order details", products);
            setTotalDbProducts(products.length);

            // Filter products that are not already in the order from the currently selected location
            let filteredProducts = products.filter((p: any) => {
                const isAlreadyInOrderFromSelectedLocation = order?.lines?.some((l: any) =>
                    String(l.product_id) === String(p.odoo_id || p.id) &&
                    String(l.location_id || '') === selectedLocationId
                );
                return !isAlreadyInOrderFromSelectedLocation;
            });

            if (stockFilter !== 'all') {
                filteredProducts = filteredProducts.filter((p: any) =>
                    stockFilter === 'in_stock'
                        ? (p.free_qty || 0) > 0
                        : (p.free_qty || 0) <= 0
                );
            }

            setCatalog(filteredProducts);
        } catch (error) {
            console.error('Error fetching products:', error);
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('order.error_fetching_products'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setLoadingProducts(false);
        }
    };

    const handleConfirmAddProducts = async () => {
        setActionLoading('add_products');
        try {
            const isLocalOnly = !order.odoo_id || orderType === 'local';

            for (const [prodIdStr, qty] of Object.entries(selectedQuantities)) {
                if (qty <= 0) continue;
                const productId = parseInt(prodIdStr);
                const product = catalog.find(p => (p.odoo_id || p.id) === productId);
                if (!product) continue;

                // First check if the product is already in the order lines
                const existingLine = order.lines?.find((l: any) =>
                    String(l.product_id) === String(product.odoo_id || product.id) &&
                    String(l.location_id || '') === selectedLocationId
                );

                if (existingLine) {
                    // If it exists, just update its quantity
                    await handleUpdateLineQty(existingLine.id, existingLine.product_uom_qty + qty);
                } else {
                    // Completely new line
                    // 1. Optimistically update local database
                    await addLocalOrderLine(order.odoo_id || order.local_id, {
                        id: product.odoo_id || product.id,
                        name: product.name,
                        price: product.list_price,
                        quantity: qty,
                        location_id: selectedLocationId ? parseInt(selectedLocationId) : undefined,
                        location_name: selectedLocationId ? locationsList.find(l => l.id.toString() === selectedLocationId)?.name : undefined
                    });

                    // 2. Queue action for sync
                    if (!isLocalOnly) {
                        // Synced order
                        await queueAction('add_order_line', {
                            order_id: order.odoo_id,
                            product_id: product.odoo_id || product.id,
                            quantity: qty,
                            price_unit: product.list_price,
                            location_id: selectedLocationId ? parseInt(selectedLocationId) : undefined
                        }, undefined, true);
                    } else {
                        // Local order
                        await queueAction('add_order_line', {
                            local_order_id: order.local_id,
                            product_id: product.odoo_id || product.id,
                            quantity: qty,
                            price_unit: product.list_price,
                            is_local_line: true,
                            location_id: selectedLocationId ? parseInt(selectedLocationId) : undefined
                        }, undefined, true);
                    }
                }
            }

            // 3. Recalculate promotions
            await applyLocalPromotion(order.local_id || order.odoo_id);

            // 4. Reload UI state
            await loadOrder();
            setSelectedQuantities({});
            setProductModalVisible(false);
        } catch (error) {
            console.error('Error adding products:', error);
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('order.error_adding_product'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setActionLoading(null);
        }
    };

    useEffect(() => {
        if (productModalVisible) {
            setSelectedQuantities({});
            fetchCatalog();
        }
    }, [productModalVisible, selectedLocationId, stockFilter]);

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
                    <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
                    <Text style={{ color: colors.textSecondary }}>{i18n.t('order.not_found')}</Text>
                </View>
            </SafeAreaView>
        );
    }

    const stateColor = STATE_COLORS[order.state] || '#94a3b8';
    const isConfirmed = order.state === 'sale' || order.state === 'done';
    const isDraft = order.state === 'draft' || order.state === 'sent';
    const isCancelled = order.state === 'cancel';
    // Calculate the value of pending returns to deduct from residual
    const pendingReturnAmount = (order?.lines || []).reduce((sum: number, l: any) => {
        const pendingQty = pendingReturnTally[l.product_id] || 0;
        return sum + (pendingQty * (l.price_unit || 0));
    }, 0);

    // Paid/Remaining Calculation
    const totalAmount = order?.amount_total || 0;

    // Calculate total paid from POSITIVE invoices using payment_state as truth
    // (amount_residual from server is unreliable - shows full amount even when paid)
    let calculatedPaidTotal = 0;
    allInvoices.forEach((inv: any) => {
        if (inv.move_type === 'out_invoice') {
            const amt = parseFloat(inv.amount_total || 0);
            const res = parseFloat(inv.amount_residual || 0);
            const ps = inv.payment_state;

            if (ps === 'paid' || ps === 'in_payment') {
                // Fully paid
                calculatedPaidTotal += amt;
            } else if (ps === 'partial') {
                // Partially paid - use residual
                calculatedPaidTotal += (amt - res);
            }
            // 'not_paid' or other = 0 contribution
        }
    });

    const effectivePaid = Math.max(parseFloat(String(totalPaid || 0)), calculatedPaidTotal) + pendingPaymentAmount;
    const effectiveResidual = Math.max(0, totalAmount - effectivePaid);

    // We still keep the info about refunds for the net-after-returns display
    const hasRefund = allInvoices.some((inv: any) => inv.move_type === 'out_refund');

    const discountsTotal = (order.lines || []).reduce((sum: number, l: any) =>
        sum + (l.is_reward_line ? (parseFloat(l.price_subtotal || 0)) : 0), 0
    );
    const itemsSubtotal = (order.lines || []).reduce((sum: number, l: any) =>
        sum + (!Number(l.is_reward_line) ? (parseFloat(l.price_subtotal || 0)) : 0), 0
    );

    // Hide discounts while in quotation phase
    const effectiveDiscountsTotal = isDraft ? 0 : discountsTotal;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
            >
                <View style={[styles.header, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                        <Ionicons name="arrow-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>
                        {order.name || i18n.t('order.draft_order')}
                    </Text>
                    <View style={{ width: 32 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content}>
                    {/* Credit Limit Status Banner */}
                    {customer && (customer.sale_credit_limit > 0) && (() => {
                        const limit = customer.sale_credit_limit || 0;
                        const syncedUsed = customer.sale_credit_used || 0;

                        // Breakdown exposure
                        const totalConfirmed = syncedUsed + exposureBreakdown.confirmedTotal;
                        const totalDrafts = exposureBreakdown.draftTotal;
                        const totalUsed = totalConfirmed + totalDrafts;

                        const isExceeded = totalUsed > limit;
                        const usagePercent = limit > 0 ? (totalUsed / limit) * 100 : 0;

                        // Show banner if exceeded or usage > 80%
                        if (!isExceeded && usagePercent < 80) return null;

                        const bannerColor = isExceeded ? '#ef4444' : '#f59e0b';
                        const bgColor = bannerColor + '15';

                        return (
                            <View style={[styles.creditBanner, { backgroundColor: bgColor, borderLeftColor: bannerColor, marginBottom: 12 }]}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                        <Ionicons
                                            name={isExceeded ? 'alert-circle' : 'warning'}
                                            size={18}
                                            color={bannerColor}
                                        />
                                        <Text style={[styles.creditBannerTitle, { color: bannerColor, fontWeight: 'bold' }]}>
                                            {isExceeded ? i18n.t('order.credit_exceeded') : i18n.t('order.credit_warning')}
                                        </Text>
                                    </View>
                                    <Text style={[styles.creditBannerPercent, { color: bannerColor, fontWeight: 'bold' }]}>
                                        {usagePercent.toFixed(0)}%
                                    </Text>
                                </View>

                                <View style={styles.creditProgressBar}>
                                    <View style={[styles.creditProgressFill, { width: `${Math.min(100, usagePercent)}%`, backgroundColor: bannerColor }]} />
                                </View>

                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                                    <View>
                                        <Text style={[styles.creditBannerDetail, { color: colors.textSecondary, fontSize: 11 }]}>
                                            {i18n.t('order.credit_limit_label')}: {formatCurrency(limit)}
                                        </Text>
                                        <Text style={[styles.creditBannerDetail, { color: colors.textSecondary, fontSize: 11 }]}>
                                            {i18n.t('order.credit_used')}: {formatCurrency(totalConfirmed)}
                                        </Text>
                                    </View>
                                    <View style={{ alignItems: 'flex-end' }}>
                                        <Text style={[styles.creditBannerDetail, { color: colors.textSecondary, fontSize: 11 }]}>
                                            {i18n.t('order.credit_pending')}: {formatCurrency(totalDrafts)}
                                        </Text>
                                        <Text style={[styles.creditBannerDetail, { color: bannerColor, fontWeight: '600', fontSize: 11 }]}>
                                            {isExceeded ? i18n.t('order.credit_exceeded_by') : i18n.t('order.credit_remaining')}: {formatCurrency(Math.abs(limit - totalUsed))}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        );
                    })()}

                    {/* Status Card */}
                    <View style={[styles.statusCard, { backgroundColor: stateColor + '10', borderColor: stateColor + '30' }]}>
                        <Ionicons name="information-circle-outline" size={20} color={stateColor} />
                        <Text style={[styles.statusLabel, { color: stateColor }]}>
                            {(stateLabels as any)[order.state] || order.state}
                        </Text>
                        {order.is_synced === 0 && (
                            <View style={[styles.syncBadge, { backgroundColor: '#f59e0b20' }]}>
                                <Ionicons name="cloud-offline-outline" size={12} color="#f59e0b" />
                                <Text style={{ fontSize: 10, color: '#f59e0b', marginLeft: 3 }}>{i18n.t('order.unsynced')}</Text>
                            </View>
                        )}
                    </View>
                    {/* Payment Integration Card */}
                    <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12, padding: 0 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <View style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 10,
                                    backgroundColor: !canChange ? (colors.border + '50') : (effectiveIsCash ? '#22c55e15' : '#3b82f615'),
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <Ionicons
                                        name={!canChange ? "lock-closed" : (effectiveIsCash ? "cash-outline" : "card-outline")}
                                        size={18}
                                        color={!canChange ? colors.textSecondary : (effectiveIsCash ? "#22c55e" : "#3b82f6")}
                                    />
                                </View>
                                <View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>
                                            {effectiveIsCash ? i18n.t('order.cash_order') : i18n.t('order.credit_order')}
                                        </Text>
                                        {!canChange && <Ionicons name="lock-closed" size={10} color={colors.textSecondary} style={{ opacity: 0.5 }} />}
                                    </View>
                                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                                        {order?.master_is_cash === 1
                                            ? i18n.t('order.forced_cash_msg')
                                            : (isReadOnly ? i18n.t('order.locked_payment_msg') : i18n.t('order.toggle_payment_msg'))}
                                    </Text>
                                </View>
                            </View>

                            <View style={{ opacity: canChange ? 1 : 0.4 }}>
                                <Switch
                                    value={effectiveIsCash}
                                    onValueChange={handleToggleCash}
                                    disabled={!canChange}
                                    trackColor={{ false: '#d1d5db', true: '#22c55e' }}
                                    thumbColor={effectiveIsCash ? '#ffffff' : '#f4f4f4'}
                                />
                            </View>
                        </View>
                    </View>
                    {/* Summary Card */}
                    <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.summaryHeader}>
                            <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                            <Text style={[styles.summaryDate, { color: colors.textSecondary }]}>
                                {new Date(order.date).toLocaleDateString()}
                            </Text>
                        </View>

                        <View style={styles.summaryBody}>
                            <View style={styles.summaryItem}>
                                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{i18n.t('order.subtotal_items')}</Text>
                                <Text style={[styles.summaryValue, { color: colors.text }]}>{formatCurrency(itemsSubtotal)}</Text>
                            </View>

                            {order.discount_total > 0 && (
                                <View style={styles.summaryItem}>
                                    <Text style={[styles.summaryLabel, { color: colors.danger }]}>{i18n.t('order.fixed_discount')}</Text>
                                    <Text style={[styles.summaryValue, { color: colors.danger }]}>
                                        -{formatCurrency(order.discount_total)}
                                    </Text>
                                </View>
                            )}

                            <View style={[styles.summaryItem, { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }]}>
                                <Text style={[styles.totalLabel, { color: colors.text }]}>{i18n.t('order.total_to_pay')}</Text>
                                <Text style={[styles.totalLabel, { color: colors.primary }]}>{formatCurrency(((itemsSubtotal + effectiveDiscountsTotal) + (order.amount_tax || 0)) - (order.discount_total || 0))}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Paid/Remaining Amount Section */}
                    {isConfirmed && (
                        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
                            <View style={styles.summaryItem}>
                                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                                    {i18n.t('payment.paid_amount')}
                                </Text>
                                <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={[styles.summaryValue, { color: colors.success }]}>
                                        {formatCurrency(effectivePaid)}
                                    </Text>
                                    {pendingPaymentAmount > 0 && (
                                        <Text style={{ fontSize: 10, color: colors.warning }}>
                                            {i18n.t('payment.pending_amount', { amount: formatCurrency(pendingPaymentAmount) })}
                                        </Text>
                                    )}
                                </View>
                            </View>
                            <View style={[styles.summaryItem, { marginTop: 4 }]}>
                                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
                                    {i18n.t('payment.remaining_amount')}
                                </Text>
                                <Text style={[styles.summaryValue, { color: colors.danger }]}>
                                    {formatCurrency(effectiveResidual)}
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* Attachment section */}
                    <AttachmentSection
                        colors={colors}
                        attachments={attachments}
                        isUploadingAttachment={isUploadingAttachment}
                        onTakeAttachment={handleTakeAttachment}
                        onDeleteAttachment={handleDeleteAttachment}
                        onPreviewImage={(uri) => setPreviewImage(uri)}
                    />

                    {/* Order Lines */}
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                        {i18n.t('order.items')} ({(order.lines || []).filter((l: any) => !(isDraft && Number(l.is_reward_line))).length})
                    </Text>
                    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        {(order.lines || []).filter((l: any) => !(isDraft && Number(l.is_reward_line))).map((line: any, idx: number, arr: any[]) => (
                            <View key={line.id || idx} style={[styles.lineItem, idx === arr.length - 1 && { borderBottomWidth: 0 }]}>
                                <View style={styles.lineMain}>
                                    <Text style={[styles.lineName, { color: colors.text }]} numberOfLines={2}>
                                        {line.product_name || line.name || `Product #${line.product_id}`}
                                    </Text>
                                    <Text style={[styles.lineSubtotal, { color: colors.primary }]}>
                                        {formatCurrency(line.price_subtotal ?? (line.product_uom_qty * line.price_unit))}
                                    </Text>
                                </View>
                                <View style={styles.lineDetails}>
                                    {isDraft && (order.odoo_id || order.local_id) ? (
                                        <View style={styles.editRow}>
                                            <TouchableOpacity
                                                style={[styles.qtyBtn, { backgroundColor: colors.background }]}
                                                onPress={() => handleUpdateLineQty(line.id, line.product_uom_qty - 1)}
                                            >
                                                <Ionicons name="remove" size={16} color={colors.text} />
                                            </TouchableOpacity>
                                            <TextInput
                                                style={[styles.qtyDisplay, { color: colors.text, padding: 0, textAlign: 'center', width: 40 }]}
                                                value={String(line.product_uom_qty)}
                                                keyboardType="numeric"
                                                onChangeText={(text) => {
                                                    const parsed = parseInt(text) || 0;
                                                    handleUpdateLineQty(line.id, parsed);
                                                }}
                                                selectTextOnFocus
                                            />
                                            <TouchableOpacity
                                                style={[
                                                    styles.qtyBtn,
                                                    { backgroundColor: colors.background },
                                                    line.product_uom_qty >= (line.product_free_qty ?? Infinity) && { opacity: 0.5 }
                                                ]}
                                                onPress={() => handleUpdateLineQty(line.id, line.product_uom_qty + 1)}
                                                disabled={line.product_uom_qty >= (line.product_free_qty ?? Infinity)}
                                            >
                                                <Ionicons name="add" size={16} color={colors.text} />
                                            </TouchableOpacity>
                                            <View style={{ marginLeft: 8 }}>
                                                <TouchableOpacity
                                                    onPress={async () => {
                                                        // We need the product's UoM category. 
                                                        // Let's assume we can fetch it from the product_product table using line.product_id (odoo_id)
                                                        const db = await (require('../../../services/database').getDB());
                                                        const product = await db.getFirstAsync('SELECT uom_category_id FROM product_product WHERE odoo_id = ?', line.product_id);

                                                        if (product?.uom_category_id) {
                                                            const uoms = await getUomsByCategory(product.uom_category_id);
                                                            setAvailableUoms(uoms);
                                                            setSelectedLine(line);
                                                            setUomPickerVisible(true);
                                                        }
                                                    }}
                                                >
                                                    <Text style={[styles.lineQty, { color: colors.textSecondary }]}>
                                                        × {formatCurrency(line.price_unit)} {i18n.t('order.per')} {line.product_uom_name || ''}
                                                        {isDraft && <Ionicons name="caret-down" size={10} color={colors.textSecondary} style={{ marginLeft: 2 }} />}
                                                    </Text>
                                                </TouchableOpacity>
                                                {line.product_free_qty !== undefined && line.product_free_qty !== null && (
                                                    <Text style={{ fontSize: 10, color: line.product_uom_qty >= line.product_free_qty ? colors.danger : colors.textSecondary }}>
                                                        {i18n.t('order.stock')}: {line.product_free_qty}
                                                    </Text>
                                                )}
                                            </View>
                                            <TouchableOpacity
                                                style={{ marginLeft: 'auto', padding: 4 }}
                                                onPress={() => handleRemoveLine(line.id)}
                                            >
                                                <Ionicons name="trash-outline" size={18} color="#f87171" />
                                            </TouchableOpacity>
                                        </View>
                                    ) : (
                                        <>
                                            <Text style={[styles.lineQty, { color: colors.textSecondary }]}>
                                                {i18n.t('order.qty')}: {line.product_uom_qty} {line.product_uom_name || ''} × {formatCurrency(line.price_unit)}
                                            </Text>
                                            {line.qty_delivered !== undefined && line.qty_delivered !== null && (
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                    <Text style={[styles.lineQty, { color: colors.textSecondary }]}>
                                                        {i18n.t('order.delivered')}: {line.qty_delivered} {line.product_uom_name || ''} | {i18n.t('order.invoiced')}: {line.qty_invoiced || 0} {line.product_uom_name || ''}
                                                    </Text>
                                                    {line.product_type === 'product' && line.product_uom_qty > line.qty_delivered && (
                                                        <View style={{
                                                            backgroundColor: order.delivery_status === 'full' ? (hasRefund ? '#f8717120' : '#ef444420') : '#3b82f620',
                                                            borderRadius: 4,
                                                            paddingHorizontal: 6,
                                                            paddingVertical: 2
                                                        }}>
                                                            <Text style={{
                                                                fontSize: 11,
                                                                color: (order.delivery_status === 'full' || order.state === 'done' || order.state === 'cancel') ? (hasRefund ? '#b91c1c' : '#ef4444') : '#3b82f6',
                                                                fontWeight: '700'
                                                            }}>
                                                                {(order.delivery_status === 'full' || order.state === 'done' || order.state === 'cancel')
                                                                    ? (hasRefund
                                                                        ? `↩️ ${i18n.t('order.returned_prefix')}: ${line.product_uom_qty - line.qty_delivered} ${line.product_uom_name || ''}`
                                                                        : `🚫 ${i18n.t('order.cancelled_prefix')}: ${line.product_uom_qty - line.qty_delivered} ${line.product_uom_name || ''}`)
                                                                    : `📦 ${i18n.t('order.to_deliver')}: ${line.product_uom_qty - line.qty_delivered} ${line.product_uom_name || ''}`
                                                                }
                                                            </Text>
                                                        </View>
                                                    )}
                                                    {(line.qty_returning > 0 || (pendingReturnTally[line.product_id] || 0) > 0) && (
                                                        <View style={{
                                                            backgroundColor: '#fef3c720',
                                                            borderRadius: 4,
                                                            paddingHorizontal: 6,
                                                            paddingVertical: 2
                                                        }}>
                                                            <Text style={{
                                                                fontSize: 11,
                                                                color: '#d97706',
                                                                fontWeight: '700'
                                                            }}>
                                                                ↩️ {i18n.t('order.pending_receipt')}: {line.qty_returning + (pendingReturnTally[line.product_id] || 0)} {line.product_uom_name || ''}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                            )}
                                        </>
                                    )}
                                </View>
                            </View>
                        ))}
                        {(order.lines || []).filter((l: any) => !(isDraft && Number(l.is_reward_line))).length === 0 && (
                            <View style={styles.emptyLines}>
                                <Text style={{ color: colors.textSecondary }}>{i18n.t('order.no_lines')}</Text>
                            </View>
                        )}
                    </View>

                    {/* Add Product button for draft orders */}
                    {isDraft && !!(order.odoo_id || order.local_id) && (
                        <TouchableOpacity
                            style={[styles.addProductBtn, { borderColor: colors.primary + '60', backgroundColor: colors.primary + '10' }]}
                            onPress={() => setProductModalVisible(true)}
                        >
                            <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 15 }}>
                                {i18n.t('order.add_product')}
                            </Text>
                        </TouchableOpacity>
                    )}

                    {/* ── Invoices Section ── */}
                    {allInvoices.length > 0 && (
                        <>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
                                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                                    Invoices ({allInvoices.length})
                                </Text>
                                <TouchableOpacity
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                                    onPress={handlePrintAllInvoices}
                                    disabled={!!printing}
                                >
                                    {printing === 'all' ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    ) : (
                                        <>
                                            <Ionicons name="print-outline" size={18} color={colors.primary} />
                                            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>{i18n.t('common.print_all')}</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>
                            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                {allInvoices.map((inv: any, idx: number) => {
                                    const isCredit = inv.move_type === 'out_refund';
                                    const isPaid = inv.payment_state === 'paid' || inv.payment_state === 'in_payment';
                                    const isPartial = inv.payment_state === 'partial';
                                    const isPosted = inv.state === 'posted';
                                    return (
                                        <View
                                            key={inv.id || idx}
                                            style={[
                                                styles.invoiceRow,
                                                idx < allInvoices.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border + '30' }
                                            ]}
                                        >
                                            <View style={[styles.invTypeBadge, { backgroundColor: isCredit ? '#ef444420' : '#3b82f620' }]}>
                                                <Text style={[styles.invTypeBadgeText, { color: isCredit ? '#ef4444' : '#3b82f6' }]}>
                                                    {isCredit ? i18n.t('order.rtn_abbr') : i18n.t('order.inv_abbr')}
                                                </Text>
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.invName, { color: colors.text }]}>{inv.name || '—'}</Text>
                                                <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                                                    {inv.invoice_date || ''}
                                                </Text>
                                            </View>
                                            <View style={{ alignItems: 'flex-end', gap: 4 }}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                    {inv.state === 'posted' && (
                                                        <TouchableOpacity
                                                            onPress={() => handlePrintInvoice(inv.id)}
                                                            disabled={!!printing}
                                                            style={{ padding: 4 }}
                                                        >
                                                            {printing === inv.id ? (
                                                                <ActivityIndicator size="small" color={colors.primary} />
                                                            ) : (
                                                                <Ionicons name="print-outline" size={20} color={colors.primary} />
                                                            )}
                                                        </TouchableOpacity>
                                                    )}
                                                    <View style={{ width: 0 }} />
                                                    <Text style={[styles.invAmount, { color: isCredit ? '#ef4444' : colors.text }]}>
                                                        {isCredit ? '-' : ''}{formatCurrency(inv.amount_total)}
                                                    </Text>
                                                </View>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                    {isCredit && isPosted && !isPaid && (
                                                        <TouchableOpacity
                                                            onPress={() => handleRefundInvoice(inv)}
                                                            style={{
                                                                backgroundColor: '#ef4444',
                                                                paddingHorizontal: 10,
                                                                paddingVertical: 4,
                                                                borderRadius: 6,
                                                                flexDirection: 'row',
                                                                alignItems: 'center',
                                                                gap: 4
                                                            }}
                                                        >
                                                            <Ionicons name="arrow-undo-outline" size={14} color="#fff" />
                                                            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                                                                {i18n.t('invoice.refund')}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    )}
                                                    <Text style={{
                                                        fontSize: 11, fontWeight: '600',
                                                        color: isPaid ? '#22c55e' : isPartial ? '#f59e0b' : isPosted ? '#ef4444' : colors.textSecondary
                                                    }}>
                                                        {isPaid ? i18n.t('payment.status_paid') : isPartial ? i18n.t('payment.status_partial') : isPosted ? i18n.t('payment.status_not_paid') : inv.state}
                                                    </Text>
                                                </View>
                                            </View>
                                        </View>
                                    );
                                })}
                                {totalCredited > 0 && (
                                    <View style={[styles.invoiceRow, { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }]}>
                                        <Text style={{ flex: 1, fontSize: 13, color: colors.textSecondary, fontWeight: '600' }}>{i18n.t('order.net_after_returns')}</Text>
                                        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.primary }}>
                                            {formatCurrency(netAmount ?? order.amount_total)}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </>
                    )}

                    {/* Fallback: show invoiced badge when no detail loaded yet */}
                    {order.invoice_status === 'invoiced' && allInvoices.length === 0 && (
                        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
                            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                    <Ionicons name="document-text" size={24} color={colors.primary} />
                                    <Text style={[styles.infoLabel, { color: colors.text, fontWeight: 'bold' }]}>
                                        {i18n.t('order.invoice')}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    )}

                    {/* ── Pending Return Banner ── */}
                    {pendingReturnPickings.length > 0 && (
                        <View style={styles.pendingReturnBanner}>
                            <View style={styles.pendingReturnBannerIcon}>
                                <Ionicons name="time-outline" size={20} color="#92400e" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.pendingReturnBannerTitle}>
                                    {pendingReturnPickings.length === 1
                                        ? i18n.t('returns.pending_banner_singular')
                                        : i18n.t('returns.pending_banner_plural', { count: pendingReturnPickings.length })
                                    }
                                </Text>
                                <Text style={styles.pendingReturnBannerSub}>
                                    {i18n.t('returns.pending_banner_sub')}
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* Action Buttons */}
                    {!isCancelled && (
                        <View style={styles.actions}>
                            {(() => {
                                const totalReturnableItemsCount = (order?.lines || []).reduce((sum: number, l: any) => {
                                    const max = (l.qty_delivered !== undefined && l.qty_delivered !== null)
                                        ? l.qty_delivered
                                        : (order.odoo_id ? 0 : (l.product_uom_qty || 0));
                                    const pendingQty = pendingReturnTally[l.product_id] || 0;
                                    return sum + Math.max(0, max - pendingQty);
                                }, 0);

                                const totalPendingOnlineReturnQty = (order?.lines || []).reduce((sum: number, l: any) => sum + (l.qty_returning || 0), 0);
                                const completelyReturned = totalReturnableItemsCount === 0 && totalPendingOnlineReturnQty === 0 && (order?.lines || []).some((l: any) => l.product_uom_qty > 0) && (hasRefund || (order?.lines || []).some((l: any) => l.qty_delivered > 0));
                                const hasItemsToDeliver = order.delivery_status !== 'full' && !hasRefund && (order?.lines || []).some((l: any) => l.product_type === 'product' && l.product_uom_qty > l.qty_delivered);

                                return (
                                    <>
                                        {isDraft && !!(order.odoo_id || order.local_id) && !!useOfflineStore.getState().salesRepProfile?.access_confirm_quotation && (
                                            <TouchableOpacity
                                                style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                                                onPress={handleConfirm}
                                                disabled={!!actionLoading}
                                            >
                                                {actionLoading === 'confirm_order' ? (
                                                    <ActivityIndicator color="#fff" size="small" />
                                                ) : (
                                                    <>
                                                        <Ionicons name="checkmark-circle" size={20} color="#fff" />
                                                        <Text style={styles.actionBtnText}>
                                                            {i18n.t('order.confirm_order_lock')}
                                                        </Text>
                                                    </>
                                                )}
                                            </TouchableOpacity>
                                        )}

                                        {isConfirmed && (
                                            <>
                                                {hasItemsToDeliver && pendingReturnPickings.length === 0 && !completelyReturned && !!salesRepProfile?.access_delivery && (
                                                    <TouchableOpacity
                                                        style={[styles.actionBtn, { backgroundColor: '#60a5fa' }]}
                                                        onPress={handleProcessDelivery}
                                                        disabled={!!actionLoading}
                                                    >
                                                        <Ionicons name="cart-outline" size={20} color="#fff" />
                                                        <Text style={styles.actionBtnText}>{i18n.t('order.process_delivery')}</Text>
                                                    </TouchableOpacity>
                                                )}

                                                {pendingReturnPickings.length > 0 && useOfflineStore.getState().salesRepProfile?.auto_receive !== 1 && (
                                                    <TouchableOpacity
                                                        style={[styles.actionBtn, { backgroundColor: '#f59e0b' }]}
                                                        onPress={handleReceiveReturns}
                                                        disabled={!!actionLoading}
                                                    >
                                                        <Ionicons name="download-outline" size={20} color="#fff" />
                                                        <Text style={styles.actionBtnText}>{i18n.t('returns.receive_products')}</Text>
                                                    </TouchableOpacity>
                                                )}

                                                {!!order.is_returnable && !completelyReturned && pendingReturnPickings.length === 0 && totalReturnableItemsCount > 0 && !!useOfflineStore.getState().salesRepProfile?.access_returns && (
                                                    <TouchableOpacity
                                                        style={[styles.actionBtn, { backgroundColor: '#6366f1' }]}
                                                        onPress={handleReturn}
                                                        disabled={!!actionLoading}
                                                    >
                                                        <Ionicons name="return-up-back" size={20} color="#fff" />
                                                        <Text style={styles.actionBtnText}>{i18n.t('returns.return_items')}</Text>
                                                    </TouchableOpacity>
                                                )}

                                                {/* Automatic Invoice Creation is handled via handleConfirm or Delivery Screen */}
                                                {/* 
                                                {order.invoice_status === 'to invoice' && !completelyReturned && !hasRefund && (effectiveResidual > 0) && (
                                                    <TouchableOpacity
                                                        style={[styles.actionBtn, { backgroundColor: '#8b5cf6' }]}
                                                        onPress={handleCreateInvoice}
                                                        disabled={!!actionLoading}
                                                    >
                                                        {actionLoading === 'create_invoice' ? (
                                                            <ActivityIndicator color="#fff" size="small" />
                                                        ) : (
                                                            <>
                                                                <Ionicons name="receipt-outline" size={20} color="#fff" />
                                                                <Text style={styles.actionBtnText}>{i18n.t('order.create_invoice')}</Text>
                                                            </>
                                                        )}
                                                    </TouchableOpacity>
                                                )}
                                                */}

                                                {order.payment_state !== 'paid' && effectiveResidual > 0 && !!salesRepProfile?.access_payment && (
                                                    <TouchableOpacity
                                                        style={[styles.actionBtn, { backgroundColor: '#10b981' }]}
                                                        onPress={handleRegisterPayment}
                                                        disabled={!!actionLoading}
                                                    >
                                                        <Ionicons name="cash" size={20} color="#fff" />
                                                        <Text style={styles.actionBtnText}>
                                                            {order.payment_state === 'partial' || (isDraft && effectivePaid > 0) ? 'Add Payment' : 'Register Payment'}
                                                        </Text>
                                                    </TouchableOpacity>
                                                )}
                                            </>
                                        )}

                                        {isDraft && !!(order.odoo_id || order.local_id) && !!salesRepProfile?.access_discount && (
                                            <TouchableOpacity
                                                style={[styles.actionBtn, { backgroundColor: '#f59e0b' }]}
                                                onPress={() => {
                                                    setDiscountValue((order.discount_total || 0).toString());
                                                    setDiscountModalVisible(true);
                                                }}
                                                disabled={!!actionLoading}
                                            >
                                                <Ionicons name="pricetag-outline" size={20} color="#fff" />
                                                <Text style={styles.actionBtnText}>{i18n.t('order.set_discount')}</Text>
                                            </TouchableOpacity>
                                        )}

                                        {isDraft && !!(order.odoo_id || order.local_id) && salesRepProfile?.access_cancel_quotation && (
                                            <TouchableOpacity
                                                style={[styles.actionBtn, { backgroundColor: '#f8717130', borderWidth: 1, borderColor: '#f87171' }]}
                                                onPress={handleCancel}
                                                disabled={!!actionLoading}
                                            >
                                                {actionLoading === 'cancel_order' ? (
                                                    <ActivityIndicator color="#f87171" size="small" />
                                                ) : (
                                                    <>
                                                        <Ionicons name="close-circle" size={20} color="#f87171" />
                                                        <Text style={[styles.actionBtnText, { color: '#f87171' }]}>{i18n.t('order.cancel_order')}</Text>
                                                    </>
                                                )}
                                            </TouchableOpacity>
                                        )}
                                    </>
                                );
                            })()}
                        </View>
                    )}
                </ScrollView>

                <BottomSheetModal
                    visible={productModalVisible}
                    onClose={() => setProductModalVisible(false)}
                    title={i18n.t('order.add_product')}
                    scrollable={false}
                >
                    <View style={{ height: Dimensions.get('window').height * 0.8, padding: 16 }}>
                        {/* {locationsList.length > 0 && (
                            <View style={{ marginBottom: 12, zIndex: 1000 }}>
                                <Text style={{ color: colors.textSecondary, marginBottom: 4, fontSize: 12 }}>{i18n.t('order.select_location')}</Text>
                                <Dropdown
                                    items={locationsList.map(l => ({ label: l.name, value: l.id.toString() }))}
                                    selectedValue={selectedLocationId}
                                    onSelect={async (val: any) => {}}
                                    placeholder={i18n.t('storage.select_location')}
                                    disabled={true}
                                />
                            </View>
                        )} */}
                        <View style={[styles.searchContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                            <Ionicons name="search" size={20} color={colors.textSecondary} />
                            <TextInput
                                style={[styles.searchInput, { color: colors.text }]}
                                placeholder={i18n.t('common.search')}
                                placeholderTextColor={colors.textSecondary}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                            />
                        </View>

                        {/* Stock Filter Row */}
                        <View style={[styles.stockFilterRow, { paddingHorizontal: 0, marginBottom: 12, marginTop: -4 }]}>
                            {([
                                { value: 'all', label: i18n.t('orders.filter_all') },
                                { value: 'in_stock', label: i18n.t('storage.in_stock') },
                                { value: 'out_of_stock', label: i18n.t('storage.out_of_stock') }
                            ]).map(f => (
                                <TouchableOpacity
                                    key={f.value}
                                    style={[
                                        styles.stockFilterChip,
                                        stockFilter === f.value
                                            ? { backgroundColor: colors.primary }
                                            : { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }
                                    ]}
                                    onPress={() => setStockFilter(f.value as any)}
                                >
                                    <Text
                                        style={[
                                            styles.stockFilterChipText,
                                            stockFilter === f.value
                                                ? { color: '#ffffff', fontWeight: 'bold' }
                                                : { color: colors.textSecondary }
                                        ]}
                                    >
                                        {f.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {loadingProducts ? (
                            <View style={{ padding: 40, alignItems: 'center' }}>
                                <ActivityIndicator size="large" color={colors.primary} />
                            </View>
                        ) : (
                            <FlatList
                                data={catalog.filter(p =>
                                    (p.name || '').toLowerCase().includes(searchQuery.toLowerCase())
                                )}
                                keyExtractor={item => (item.odoo_id || item.id).toString()}
                                renderItem={({ item }) => {
                                    const isOutOfStock = (item.free_qty || 0) <= 0;
                                    const prodId = item.odoo_id || item.id;
                                    const selectedQty = selectedQuantities[prodId] || 0;

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

                                    return (
                                        <View style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                            <View style={[styles.productImageWrapper, { backgroundColor: colors.background }]}>
                                                {item.image_url ? (
                                                    <Image source={{ uri: getImageUrl(item.image_url) }} style={styles.productImage} />
                                                ) : (
                                                    <Ionicons name="cube-outline" size={32} color={colors.textSecondary} />
                                                )}
                                                {isOutOfStock && (
                                                    <View style={styles.outOfStockOverlay}>
                                                        <Text style={styles.outOfStockLabel}>{i18n.t('order.out_of_stock')}</Text>
                                                    </View>
                                                )}
                                            </View>

                                            <View style={styles.productContent}>
                                                <View style={styles.productMainInfo}>
                                                    <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>{item.name}</Text>
                                                    {item.default_code ? (
                                                        <Text style={[styles.productCode, { color: colors.textSecondary }]}>{item.default_code}</Text>
                                                    ) : null}
                                                </View>

                                                <View style={styles.productFooter}>
                                                    <View style={{ flex: 1, marginRight: 8 }}>
                                                        <Text style={[styles.productPrice, { color: colors.primary }]}>{formatCurrency(item.list_price)}</Text>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                                            <Text style={[styles.uomText, { color: colors.textSecondary, fontSize: 11 }]}>{item.uom_name || ''}</Text>
                                                            <View style={[styles.stockBadge, { backgroundColor: isOutOfStock ? colors.danger + '15' : colors.success + '15' }]}>
                                                                <Text style={[styles.stockText, { color: isOutOfStock ? colors.danger : colors.success }]}>
                                                                    {isOutOfStock ? '0' : (item.free_qty).toFixed(2).replace(/\.?0+$/, '')}
                                                                </Text>
                                                            </View>
                                                        </View>
                                                    </View>

                                                    {selectedQty === 0 ? (
                                                        <TouchableOpacity
                                                            style={[styles.addButton, { backgroundColor: colors.primary, height: 38, paddingHorizontal: 12 }]}
                                                            onPress={() => setSelectedQuantities(prev => ({ ...prev, [prodId]: 1 }))}
                                                            disabled={isOutOfStock}
                                                        >
                                                            <Ionicons name="add" size={18} color="#fff" />
                                                            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>{i18n.t('common.add')}</Text>
                                                        </TouchableOpacity>
                                                    ) : (
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                                            <TouchableOpacity
                                                                onPress={() => setSelectedQuantities(prev => {
                                                                    const newQty = (prev[prodId] || 0) - 1;
                                                                    const copy = { ...prev };
                                                                    if (newQty <= 0) {
                                                                        delete copy[prodId];
                                                                    } else {
                                                                        copy[prodId] = newQty;
                                                                    }
                                                                    return copy;
                                                                })}
                                                            >
                                                                <Ionicons name="remove-circle-outline" size={26} color={colors.danger} />
                                                            </TouchableOpacity>
                                                            <TextInput
                                                                style={{ color: colors.text, fontWeight: 'bold', fontSize: 16, textAlign: 'center', minWidth: 30, padding: 0 }}
                                                                value={String(selectedQty)}
                                                                keyboardType="numeric"
                                                                onChangeText={(text) => {
                                                                    const parsed = parseInt(text) || 0;
                                                                    setSelectedQuantities(prev => ({ ...prev, [prodId]: parsed }));
                                                                }}
                                                                selectTextOnFocus
                                                            />
                                                            <TouchableOpacity
                                                                onPress={() => {
                                                                    const isMaxReached = item.free_qty !== undefined && selectedQty >= item.free_qty;
                                                                    if (!isMaxReached) {
                                                                        setSelectedQuantities(prev => ({ ...prev, [prodId]: (prev[prodId] || 0) + 1 }));
                                                                    }
                                                                }}
                                                                disabled={item.free_qty !== undefined && selectedQty >= item.free_qty}
                                                            >
                                                                <Ionicons name="add-circle-outline" size={26} color={(item.free_qty !== undefined && selectedQty >= item.free_qty) ? colors.textSecondary : colors.success} />
                                                            </TouchableOpacity>
                                                        </View>
                                                    )}
                                                </View>
                                            </View>
                                        </View>
                                    );
                                }}
                                ListEmptyComponent={
                                    <View style={{ padding: 40, alignItems: 'center' }}>
                                        <Text style={{ color: colors.textSecondary }}>{i18n.t('common.no_results')}</Text>
                                        {totalDbProducts !== null && (
                                            <Text style={{ fontSize: 12, color: colors.textSecondary + '80', marginTop: 8 }}>
                                                Total DB items: {totalDbProducts}
                                            </Text>
                                        )}
                                    </View>
                                }
                                style={{ flex: 1 }}
                                contentContainerStyle={{ paddingBottom: 40 }}
                            />
                        )}

                        <TouchableOpacity
                            style={{
                                backgroundColor: colors.primary,
                                padding: 14,
                                borderRadius: 12,
                                alignItems: 'center',
                                marginTop: 12,
                                opacity: Object.keys(selectedQuantities).length === 0 ? 0.6 : 1
                            }}
                            disabled={Object.keys(selectedQuantities).length === 0 || actionLoading === 'add_products'}
                            onPress={handleConfirmAddProducts}
                        >
                            {actionLoading === 'add_products' ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>
                                    {i18n.t('common.confirm')}
                                    {Object.keys(selectedQuantities).length > 0 ? ` (${Object.keys(selectedQuantities).length})` : ''}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </BottomSheetModal>

                {/* Discount Modal */}
                <BottomSheetModal
                    visible={discountModalVisible}
                    onClose={() => setDiscountModalVisible(false)}
                    title={i18n.t('order.apply_fixed_discount')}
                >
                    <View style={{ padding: 20 }}>
                        <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 14 }}>
                            {i18n.t('order.enter_discount_amount')}
                        </Text>
                        <View style={[styles.searchContainer, { backgroundColor: colors.background, borderColor: colors.border, marginBottom: 20 }]}>
                            <Ionicons name="cash-outline" size={20} color={colors.textSecondary} />
                            <TextInput
                                style={[styles.searchInput, { color: colors.text, fontSize: 18 }]}
                                placeholder="0.00"
                                placeholderTextColor={colors.textSecondary}
                                value={discountValue}
                                onChangeText={setDiscountValue}
                                keyboardType="numeric"
                                autoFocus
                            />
                        </View>

                        <View style={{ flexDirection: 'row', gap: 12 }}>
                            <TouchableOpacity
                                style={[styles.actionBtn, { flex: 1, backgroundColor: colors.border }]}
                                onPress={() => setDiscountModalVisible(false)}
                            >
                                <Text style={[styles.actionBtnText, { color: colors.text }]}>{i18n.t('common.cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.actionBtn, { flex: 2, backgroundColor: colors.primary }]}
                                onPress={handleApplyDiscount}
                                disabled={actionLoading === 'apply_discount'}
                            >
                                {actionLoading === 'apply_discount' ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <>
                                        <Ionicons name="checkmark-circle" size={20} color="#fff" />
                                        <Text style={styles.actionBtnText}>{i18n.t('common.apply')}</Text>
                                    </>
                                )}
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
                                        backgroundColor: selectedLine?.product_uom_id === uom.odoo_id ? colors.primary + '10' : 'transparent'
                                    }
                                ]}
                                onPress={() => handleUpdateLineUom(selectedLine.id, uom)}
                            >
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.uomOptionName, { color: selectedLine?.product_uom_id === uom.odoo_id ? colors.primary : colors.text }]}>
                                        {uom.name}
                                    </Text>
                                    <Text style={[styles.uomOptionFactor, { color: colors.textSecondary }]}>
                                        Factor: {uom.factor}
                                    </Text>
                                </View>
                                {selectedLine?.product_uom_id === uom.odoo_id && (
                                    <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                                )}
                            </TouchableOpacity>
                        ))}
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
            </KeyboardAvoidingView>

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
    backBtn: {
        width: 32,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 18,
        fontWeight: 'bold'
    },
    content: { padding: 16, gap: 16, paddingBottom: 40 },
    statusCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
    },
    statusLabel: { fontSize: 15, fontWeight: '600', flex: 1 },
    syncBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    section: {
        borderRadius: 14,
        borderWidth: 1,
        overflow: 'hidden',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: -8,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(150,150,150,0.1)',
    },
    infoLabel: { fontSize: 14 },
    infoValue: { fontSize: 14, fontWeight: '500' },
    infoCol: { flex: 1 },
    summaryCard: {
        borderRadius: 16,
        borderWidth: 1,
        overflow: 'hidden',
        padding: 16,
        gap: 12,
    },
    summaryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(150,150,150,0.1)',
    },
    summaryDate: {
        fontSize: 13,
        fontWeight: '500',
    },
    summaryBody: {
        gap: 8,
    },
    summaryItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    summaryLabel: {
        fontSize: 14,
    },
    summaryValue: {
        fontSize: 14,
        fontWeight: '600',
    },
    summaryFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 4,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    totalLabel: {
        fontSize: 16,
        fontWeight: '700',
    },
    totalValue: {
        fontSize: 22,
        fontWeight: '800',
    },
    lineItem: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(150,150,150,0.1)',
    },
    lineMain: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    lineName: { fontSize: 14, fontWeight: '500', flex: 1, marginRight: 8 },
    lineSubtotal: { fontSize: 14, fontWeight: '600' },
    lineDetails: { gap: 2 },
    lineQty: { fontSize: 12 },
    emptyLines: {
        padding: 20,
        alignItems: 'center',
    },
    actions: {
        gap: 10,
        marginTop: 8,
    },
    statusRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: -4,
    },
    miniTag: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
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
    editRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    qtyBtn: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    qtyDisplay: {
        fontSize: 15,
        fontWeight: '600',
        minWidth: 32,
        textAlign: 'center',
    },
    addProductBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    invoiceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    invTypeBadge: {
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
        minWidth: 42,
        alignItems: 'center',
    },
    invTypeBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    invName: { fontSize: 13, fontWeight: '600' },
    invAmount: { fontSize: 14, fontWeight: '700' },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        height: 44,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 16,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        paddingVertical: 8,
    },
    stockFilterRow: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        marginTop: 12,
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
    catalogItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    catalogName: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 2,
    },
    productCard: {
        flexDirection: 'row',
        borderRadius: 12,
        borderWidth: 1,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        marginBottom: 12,
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
        fontSize: 15,
        fontWeight: 'bold',
        lineHeight: 18,
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
        fontSize: 16,
        fontWeight: '800',
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
    uomText: {
        fontSize: 12,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    pendingReturnBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#fef3c7',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#f59e0b50',
        padding: 14,
        marginTop: 12,
        marginBottom: 4,
    },
    pendingReturnBannerIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#f59e0b20',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pendingReturnBannerTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#92400e',
        marginBottom: 2,
    },
    pendingReturnBannerSub: {
        fontSize: 12,
        color: '#b45309',
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
    // Credit Limit Banner Styles
    creditBanner: {
        padding: 12,
        borderRadius: 12,
        borderLeftWidth: 4,
        marginTop: 4,
    },
    creditBannerTitle: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    creditBannerPercent: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    creditProgressBar: {
        height: 6,
        backgroundColor: 'rgba(0,0,0,0.05)',
        borderRadius: 3,
        marginVertical: 10,
        overflow: 'hidden',
    },
    creditProgressFill: {
        height: '100%',
        borderRadius: 3,
    },
    creditBannerDetail: {
        fontSize: 12,
        lineHeight: 18,
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

export default OrderDetails;
