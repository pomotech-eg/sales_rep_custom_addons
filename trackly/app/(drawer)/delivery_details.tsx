import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl, StatusBar, Platform, KeyboardAvoidingView, TextInput, Image, Modal } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import i18n from '../../i18n';
import Animated, { FadeIn } from 'react-native-reanimated';
import { getDB } from '../../services/database/index';
import { getStockPickingMoves } from '../../services/database/repositories';
import * as Location from 'expo-location';
import BottomSheetModal from '../../components/BottomSheetModal';
import OSMMap from '@/components/OSMMap';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { AttachmentSection } from '../../components/AttachmentSection';

const getDistanceFromLatLonInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // metres
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

export default function DeliveryDetailsScreen() {
    const { odoo_id } = useLocalSearchParams();
    const { colors } = useThemeStore();
    const router = useRouter();
    const { isOffline, performSync } = useOfflineStore();
    const navigation = useNavigation();

    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            setRefreshTrigger(prev => prev + 1);
        });
        return unsubscribe;
    }, [navigation]);

    const [picking, setPicking] = useState<any>(null);
    const [pickingMoves, setPickingMoves] = useState<any[]>([]);
    const [partner, setPartner] = useState<any>(null);
    const [isDistanceModalVisible, setDistanceModalVisible] = useState(false);
    const [distanceData, setDistanceData] = useState<{ customer: any, distance: number, userLat: number, userLng: number, allowedRadius: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [quantities, setQuantities] = useState<Record<number, number>>({});

    const [attachments, setAttachments] = useState<any[]>([]);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

    const loadAttachments = useCallback(async () => {
        try {
            const stored = await AsyncStorage.getItem('picking_attachments_' + odoo_id);
            if (stored) {
                setAttachments(JSON.parse(stored));
            } else {
                setAttachments([]);
            }
        } catch (e) {
            console.error("Failed to load attachments from AsyncStorage:", e);
        }
    }, [odoo_id, refreshTrigger]);

    useEffect(() => {
        loadAttachments();
    }, [loadAttachments]);

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

                const name = uri.substring(uri.lastIndexOf('/') + 1) || `attachment_${Date.now()}.jpg`;
                const fileSize = asset.fileSize ? `${(asset.fileSize / 1024).toFixed(1)} KB` : 'Unknown size';

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
                await AsyncStorage.setItem('picking_attachments_' + odoo_id, JSON.stringify(updated));

                const pickId = parseInt(odoo_id as string);
                await useOfflineStore.getState().recordPendingAction({
                    action_type: 'upload_attachment',
                    payload: {
                        res_model: 'stock.picking',
                        res_id: pickId,
                        file_base64: newAttachment.base64,
                        file_name: newAttachment.name,
                    },
                    related_id: String(pickId),
                });

                const { syncPendingActionsLightweight } = useOfflineStore.getState();
                await syncPendingActionsLightweight();
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
            const updated = attachments.filter(att => att.name !== fileName);
            setAttachments(updated);
            await AsyncStorage.setItem('picking_attachments_' + odoo_id, JSON.stringify(updated));

            const pickId = parseInt(odoo_id as string);
            await useOfflineStore.getState().recordPendingAction({
                action_type: 'delete_attachment',
                payload: {
                    res_model: 'stock.picking',
                    res_id: pickId,
                    file_name: fileName,
                },
                related_id: String(pickId),
            });

            const { syncPendingActionsLightweight } = useOfflineStore.getState();
            await syncPendingActionsLightweight();
        } catch (e: any) {
            console.error("Failed to delete attachment:", e);
            Alert.alert(i18n.t('common.error') || 'Error', e.message);
        }
    };

    const loadDetails = useCallback(async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const db = await getDB();
            const pickId = parseInt(odoo_id as string);

            // Query picking
            const result = await db.getFirstAsync<any>('SELECT * FROM stock_picking WHERE odoo_id = ?', pickId);

            if (result) {
                setPicking(result);
                // Query partner
                if (result.partner_id) {
                    const partnerObj = await db.getFirstAsync<any>('SELECT * FROM res_partner WHERE odoo_id = ?', result.partner_id);
                    setPartner(partnerObj);
                } else {
                    setPartner(null);
                }
                
                // Query moves
                const moves = await getStockPickingMoves(pickId);
                setPickingMoves(moves);

                // Initialize quantities
                const initQty: Record<number, number> = {};
                for (const move of (moves as any[])) {
                    initQty[move.odoo_id] = result.state === 'done' ? (move.quantity || 0) : (move.quantity || move.product_uom_qty || 0);
                }
                setQuantities(initQty);
            } else {
                Alert.alert(i18n.t('common.error'), "Delivery not found.");
                router.back();
            }
        } catch (error) {
            console.error("Failed to load delivery details:", error);
            Alert.alert(i18n.t('common.error'), "Failed to load details.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [odoo_id, refreshTrigger]);

    useEffect(() => {
        loadDetails();
    }, [loadDetails]);

    const handleRefresh = async () => {
        setRefreshing(true);
        if (!isOffline) {
            try {
                await performSync();
            } catch (error) {
                console.error("Sync failed:", error);
            }
        }
        await loadDetails(false);
        setRefreshing(false);
    };

    const updateQty = (moveOdooId: number, value: string) => {
        let num = parseFloat(value) || 0;
        const move = pickingMoves.find(m => m.odoo_id === moveOdooId);
        if (move) {
            const maxVal = move.product_uom_qty || 0;
            if (num > maxVal) {
                num = maxVal;
            }
        }
        if (num < 0) num = 0;
        setQuantities(prev => ({ ...prev, [moveOdooId]: num }));
    };

    const processDelivery = async (createBackorder: boolean) => {
        setSubmitting(true);
        try {
            const db = await getDB();
            let orderIdVal = null;
            if (picking.origin) {
                const so = await db.getFirstAsync<any>('SELECT odoo_id FROM sales_order WHERE name = ?', picking.origin);
                if (so) {
                    orderIdVal = so.odoo_id;
                }
            }

            if (!orderIdVal) {
                if (picking.origin && /^\d+$/.test(picking.origin)) {
                    orderIdVal = parseInt(picking.origin);
                } else {
                    Alert.alert(i18n.t('common.error'), "Could not resolve associated sales order.");
                    setSubmitting(false);
                    return;
                }
            }

            const lineQuantities = [];
            const deliveredQuantities: Record<string, number> = {};
            
            for (const move of pickingMoves) {
                const qty = quantities[move.odoo_id] ?? 0;
                if (qty > 0) {
                    const sol = await db.getFirstAsync<any>(
                        'SELECT odoo_id, product_uom_id FROM sales_order_line WHERE order_odoo_id = ? AND product_id = ?',
                        orderIdVal,
                        move.product_id
                    );
                    
                    lineQuantities.push({
                        line_id: sol ? sol.odoo_id : move.odoo_id,
                        quantity: qty,
                        uom_id: sol ? sol.product_uom_id : undefined
                    });
                    
                    deliveredQuantities[String(move.product_id)] = qty;
                }
            }

            await useOfflineStore.getState().recordPendingAction({
                action_type: 'process_delivery',
                payload: {
                    order_id: orderIdVal,
                    lines: lineQuantities,
                    delivered_quantities: deliveredQuantities,
                    create_backorder: createBackorder,
                },
                related_id: orderIdVal,
            });

            // Update local DB
            for (const move of pickingMoves) {
                const qty = quantities[move.odoo_id] ?? 0;
                await db.runAsync(
                    'UPDATE stock_move SET quantity = ? WHERE odoo_id = ?',
                    qty,
                    move.odoo_id
                );
            }

            await db.runAsync(
                "UPDATE stock_picking SET state = 'done' WHERE odoo_id = ?",
                picking.odoo_id
            );

            if (orderIdVal) {
                const allFull = pickingMoves.every((move) => {
                    const qty = quantities[move.odoo_id] ?? 0;
                    return qty >= (move.product_uom_qty - 0.001);
                });
                
                const finalStatus = (allFull || !createBackorder) ? 'full' : 'partial';
                
                await db.runAsync(
                    "UPDATE sales_order SET delivery_status = ?, invoice_status = 'to invoice' WHERE odoo_id = ?",
                    finalStatus,
                    orderIdVal
                );
                
                for (const move of pickingMoves) {
                    const qty = quantities[move.odoo_id] ?? 0;
                    await db.runAsync(
                        "UPDATE sales_order_line SET qty_delivered = qty_delivered + ? WHERE order_odoo_id = ? AND product_id = ?",
                        qty,
                        orderIdVal,
                        move.product_id
                    );
                }
                
                const repProfile = useOfflineStore.getState().salesRepProfile;
                await useOfflineStore.getState().recordPendingAction({
                    action_type: 'create_invoice',
                    payload: {
                        order_id: orderIdVal,
                        journal_id: repProfile?.invoice_journal_id || undefined
                    },
                    related_id: orderIdVal
                });

                await db.runAsync(
                    "UPDATE sales_order SET invoice_status = 'invoiced' WHERE odoo_id = ?",
                    orderIdVal
                );
            }

            Alert.alert(i18n.t('common.success'), i18n.t('delivery.queued_success') || "Delivery processed successfully", [
                {
                    text: i18n.t('common.ok'),
                    onPress: () => {
                        router.replace('/delivery');
                    }
                }
            ]);
        } catch (err: any) {
            Alert.alert(i18n.t('common.error'), err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const checkLocationAndProceed = async (onSuccess: () => void) => {
        console.log("delivery_details checkLocationAndProceed partner:", {
            id: partner?.id,
            odoo_id: partner?.odoo_id,
            name: partner?.name,
            enable_location: partner?.enable_location,
            latitude: partner?.latitude,
            longitude: partner?.longitude
        });
        if (!partner) {
            onSuccess();
            return;
        }

        if (partner.enable_location == 1 || partner.enable_location === true || partner.enable_location === '1' || partner.enable_location === 'true') {
            // 1. Get Current Location
            let latitude = 0;
            let longitude = 0;
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const loc = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    });
                    latitude = loc.coords.latitude;
                    longitude = loc.coords.longitude;
                } else {
                    Alert.alert(
                        i18n.t('common.error'),
                        i18n.t('routes.location_permission_required') || 'Location permission is required.'
                    );
                    setSubmitting(false);
                    return;
                }
            } catch (err) {
                console.warn("Location capture failed", err);
                Alert.alert(
                    i18n.t('common.error'),
                    i18n.t('routes.could_not_verify_location') || 'Could not verify your location.'
                );
                setSubmitting(false);
                return;
            }

            // 2. Geofencing Check
            if (partner.latitude && partner.longitude) {
                const distance = getDistanceFromLatLonInMeters(
                    latitude,
                    longitude,
                    partner.latitude,
                    partner.longitude
                );

                const allowedRadius = partner.location_radius > 0 ? partner.location_radius : 500; // Default 500m
                if (distance > allowedRadius) {
                    setDistanceData({
                        customer: {
                            ...partner,
                            radius: allowedRadius
                        },
                        distance,
                        userLat: latitude,
                        userLng: longitude,
                        allowedRadius
                    });
                    setDistanceModalVisible(true);
                    setSubmitting(false);
                    return; // Stop here, user must get closer
                }
            }
        }

        onSuccess();
    };

    const handleSubmit = async () => {
        const hasQty = Object.values(quantities).some(q => q > 0);
        if (!hasQty) {
            Alert.alert(i18n.t('common.warning'), i18n.t('delivery.enter_qty_error') || "Please enter quantity");
            return;
        }

        setSubmitting(true);
        try {
            await checkLocationAndProceed(() => {
                const isPartial = pickingMoves.some((move) => {
                    const currentQty = quantities[move.odoo_id] ?? 0;
                    return currentQty < (move.product_uom_qty - 0.001);
                });

                if (isPartial) {
                    Alert.alert(
                        i18n.t('delivery.backorder_title') || "Create Backorder?",
                        i18n.t('delivery.backorder_msg') || "You have processed less than the demanded quantity. Do you want to create a backorder?",
                        [
                            { 
                                text: i18n.t('common.cancel'), 
                                style: 'cancel',
                                onPress: () => setSubmitting(false)
                            },
                            {
                                text: i18n.t('delivery.no_backorder') || "No Backorder",
                                onPress: () => processDelivery(false)
                            },
                            {
                                text: i18n.t('delivery.create_backorder') || "Create Backorder",
                                onPress: () => processDelivery(true),
                                style: 'default'
                            }
                        ]
                    );
                } else {
                    Alert.alert(
                        i18n.t('delivery.process_title') || "Process Delivery",
                        i18n.t('delivery.process_msg') || "Are you sure you want to process this delivery?",
                        [
                            { 
                                text: i18n.t('common.cancel'), 
                                style: 'cancel',
                                onPress: () => setSubmitting(false)
                            },
                            {
                                text: i18n.t('delivery.process') || "Process",
                                onPress: () => processDelivery(false)
                            }
                        ]
                    );
                }
            });
        } catch (err) {
            setSubmitting(false);
        }
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

    if (loading) {
        return (
            <View style={[styles.centered, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (!picking) return null;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.container}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 94 : 0}
            >
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.replace('/delivery')} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>
                        {i18n.t('delivery.details_title') || 'Delivery Details'}
                    </Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Content Scroll View */}
                <ScrollView
                    style={styles.content}
                    contentContainerStyle={styles.scrollContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} />
                    }
                >
                    <Animated.View entering={FadeIn}>
                        <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
                            <View style={styles.detailCardHeader}>
                                <Text style={[styles.detailCardName, { color: colors.text }]}>
                                    {picking.name}
                                </Text>
                                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(picking.state) + '15' }]}>
                                    <Text style={[styles.statusText, { color: getStatusColor(picking.state) }]}>
                                        {getStatusTranslation(picking.state)}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.divider} />

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                                    {i18n.t('delivery.partner') || 'Customer'}
                                </Text>
                                <Text style={[styles.detailValue, { color: colors.text }]}>
                                    {picking.partner_name || '-'}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                                    {i18n.t('delivery.source_doc') || 'Source Document'}
                                </Text>
                                <Text style={[styles.detailValue, { color: colors.text }]}>
                                    {picking.origin || '-'}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                                    {i18n.t('delivery.from_location') || 'From'}
                                </Text>
                                <Text style={[styles.detailValue, { color: colors.text }]}>
                                    {picking.location_name || '-'}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                                    {i18n.t('delivery.to_location') || 'To'}
                                </Text>
                                <Text style={[styles.detailValue, { color: colors.text }]}>
                                    {picking.location_dest_name || '-'}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                                    {i18n.t('common.date') || 'Date'}
                                </Text>
                                <Text style={[styles.detailValue, { color: colors.text }]}>
                                    {dayjs(picking.date).format('YYYY-MM-DD HH:mm')}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                                    {i18n.t('delivery.effective_date') || 'Effective Date'}
                                </Text>
                                <Text style={[styles.detailValue, { color: colors.text }]}>
                                    {dayjs(picking.effective_date).format('YYYY-MM-DD HH:mm')}
                                </Text>
                            </View>
                        </View>

                        {/* Attachment section */}
                        <AttachmentSection
                            colors={colors}
                            attachments={attachments}
                            isUploadingAttachment={isUploadingAttachment}
                            onTakeAttachment={handleTakeAttachment}
                            onDeleteAttachment={handleDeleteAttachment}
                            onPreviewImage={(uri) => setPreviewImage(uri)}
                            disabled={picking.state === 'done'}
                        />

                        <Text style={[styles.movesTitle, { color: colors.text, marginTop: 16 }]}>
                            {i18n.t('drawer.storage') || 'Items'}
                        </Text>

                        <View style={styles.movesList}>
                            {pickingMoves.map((move) => (
                                <View key={move.odoo_id} style={[styles.moveItemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                    <View style={styles.moveItemHeader}>
                                        <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                                            {move.product_name}
                                        </Text>
                                        <Text style={[styles.moveUom, { color: colors.textSecondary }]}>
                                            {move.product_uom}
                                        </Text>
                                    </View>
                                    <View style={styles.moveItemRow}>
                                        <View style={styles.demandInfo}>
                                            <Text style={[styles.qtyLabel, { color: colors.textSecondary }]}>
                                                {i18n.t('delivery.qty_demand') || 'Demanded'}:
                                            </Text>
                                            <Text style={[styles.qtyValue, { color: colors.text, fontWeight: '600' }]}>
                                                {move.product_uom_qty}
                                            </Text>
                                        </View>
                                        <View style={styles.doneInfo}>
                                            <Text style={[styles.qtyLabel, { color: colors.textSecondary }]}>
                                                {i18n.t('delivery.qty_done') || 'Done'}:
                                            </Text>
                                            {picking.state === 'done' ? (
                                                <Text style={[styles.qtyValue, { color: colors.success, fontWeight: 'bold' }]}>
                                                    {move.quantity}
                                                </Text>
                                            ) : (
                                                <View style={styles.qtyControls}>
                                                    <TouchableOpacity
                                                        style={[styles.qtyBtn, { backgroundColor: colors.border }]}
                                                        onPress={() => updateQty(move.odoo_id, String(Math.max(0, (quantities[move.odoo_id] ?? 0) - 1)))}
                                                    >
                                                        <Ionicons name="remove" size={18} color={colors.text} />
                                                    </TouchableOpacity>
                                                    <TextInput
                                                        style={[styles.qtyInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                                                        value={String(quantities[move.odoo_id] ?? 0)}
                                                        onChangeText={(v) => updateQty(move.odoo_id, v)}
                                                        keyboardType="numeric"
                                                        textAlign="center"
                                                    />
                                                    <TouchableOpacity
                                                        style={[styles.qtyBtn, { backgroundColor: colors.primary + '30' }]}
                                                        onPress={() => updateQty(move.odoo_id, String(Math.min(move.product_uom_qty, (quantities[move.odoo_id] ?? 0) + 1)))}
                                                    >
                                                        <Ionicons name="add" size={18} color={colors.primary} />
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                </View>
                            ))}
                        </View>
                        {picking.state !== 'done' && (
                            <View style={styles.buttonContainer}>
                                <TouchableOpacity 
                                    onPress={handleSubmit} 
                                    style={[styles.confirmButton, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
                                    disabled={submitting}
                                >
                                    {submitting ? (
                                        <ActivityIndicator color="#fff" />
                                    ) : (
                                        <Text style={styles.confirmButtonText}>
                                            {i18n.t('delivery.confirm') || 'Confirm'}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        )}
                    </Animated.View>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Distance Modal */}
            <BottomSheetModal
                visible={isDistanceModalVisible}
                onClose={() => setDistanceModalVisible(false)}
                title={i18n.t('routes.distance_warning_title') || 'Location Too Far'}
            >
                {distanceData && (
                    <View style={{ padding: 20 }}>
                        <Text style={{ color: colors.text, marginBottom: 15, fontSize: 16 }}>
                            {i18n.t('routes.too_far_msg') || 'You are too far from the customer.'}
                        </Text>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, backgroundColor: colors.card, padding: 15, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                            <View>
                                <Text style={{ color: colors.subtext, fontSize: 12 }}>{i18n.t('routes.current_distance') || 'Current Distance'}</Text>
                                <Text style={{ color: colors.danger, fontSize: 18, fontWeight: 'bold' }}>{Math.round(distanceData.distance)}m</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                                <Text style={{ color: colors.subtext, fontSize: 12 }}>{i18n.t('routes.allowed_radius') || 'Allowed Radius'}</Text>
                                <Text style={{ color: colors.success, fontSize: 18, fontWeight: 'bold' }}>{distanceData.allowedRadius}m</Text>
                            </View>
                        </View>

                        <View style={{ height: 250, borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                            <OSMMap
                                latitude={distanceData.customer.latitude}
                                longitude={distanceData.customer.longitude}
                                userLocation={{
                                    latitude: distanceData.userLat,
                                    longitude: distanceData.userLng
                                }}
                                radius={distanceData.allowedRadius}
                                isStatic={false}
                                height={250}
                                zoom={16}
                            />
                        </View>

                        <Text style={{ color: colors.subtext, textAlign: 'center', marginBottom: 20 }}>
                            {i18n.t('routes.move_closer_msg') || 'Please move closer to the customer to process this delivery.'}
                        </Text>

                        <TouchableOpacity
                            style={{ backgroundColor: colors.primary, borderRadius: 8, padding: 15 }}
                            onPress={() => setDistanceModalVisible(false)}
                        >
                            <Text style={{ color: 'white', fontWeight: 'bold', textAlign: 'center', fontSize: 16 }}>
                                {i18n.t('common.ok') || 'OK'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
            </BottomSheetModal>

            {/* Image Preview Modal */}
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
                            <Ionicons name="close-circle" size={36} color="#fff" />
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
        padding: 8,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    content: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    detailCard: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 20,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
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
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
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
        marginBottom: 20,
    },
    moveItemCard: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 16,
        marginBottom: 12,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.02,
        shadowRadius: 4,
    },
    moveItemHeader: {
        marginBottom: 12,
        gap: 4,
    },
    productName: {
        fontSize: 15,
        fontWeight: '600',
    },
    moveUom: {
        fontSize: 12,
    },
    moveItemRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#00000008',
        paddingTop: 12,
    },
    demandInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    doneInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    qtyLabel: {
        fontSize: 11,
        marginBottom: 2,
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
    qtyInput: {
        width: 60,
        height: 36,
        borderWidth: 1,
        borderRadius: 8,
        fontSize: 16,
        fontWeight: 'bold',
        padding: 0,
    },
    qtyValue: {
        fontSize: 14,
    },
    buttonContainer: {
        flexDirection: 'column',
        gap: 16,
        marginBottom: 16,
    },
    scanButton: {
        paddingVertical: 16,
        borderRadius: 16,
        borderWidth: 2,
        borderColor: '#FF6B00',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    scanButtonText: {
        color: '#FF6B00',
        fontSize: 16,
        fontWeight: '600',
    },
    confirmButton: {
        paddingVertical: 16,
        borderRadius: 16,
        borderWidth: 2,
        borderColor: '#20c997',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    confirmButtonText: {
        color: '#20c997',
        fontSize: 16,
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
