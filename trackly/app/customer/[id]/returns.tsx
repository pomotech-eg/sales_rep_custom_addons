import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, StatusBar as RNStatusBar, Platform, TouchableOpacity, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, ActivityIndicator } from 'react-native-paper';
import { getOrderWithLines, getPendingReturnsForOrder, getReturnReasons } from '../../../services/database/repositories';
import { useOfflineStore } from '../../../store/useOfflineStore';
import { useThemeStore } from '../../../store/useThemeStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Dropdown } from '../../../components/CustomDropdown';
import { Button } from '../../../components/Button';
import * as stockService from '../../../services/api/stockService';
import i18n from '../../../i18n';
import { CustomAlert } from '../../../components/CustomAlert';
import { RADIUS, SHADOW, SPACING } from '../../../theme';

interface ReturnLine {
    product_id: number;
    product_name: string;
    maxQuantity: number;
    quantity: number;
    uom_id: number;
    uom_factor: number;
}

export default function ReturnsScreen() {
    const { id, orderId, pickingId, invoiceId } = useLocalSearchParams<{
        id: string; orderId: string; pickingId: string; invoiceId: string;
    }>();
    const { colors, mode } = useThemeStore();
    const { isOffline } = useOfflineStore();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [lines, setLines] = useState<ReturnLine[]>([]);
    const [reasons, setReasons] = useState<any[]>([]);
    const [selectedReasonId, setSelectedReasonId] = useState<string>('');
    const [selectedLocationId, setSelectedLocationId] = useState<string>('');
    const [locationsList, setLocationsList] = useState<any[]>([]);
    const scrollRef = React.useRef<ScrollView>(null);

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

    useEffect(() => { loadReturnData(); }, []);

    const loadReturnData = async () => {
        try {
            const pickIdStr = Array.isArray(pickingId) ? pickingId[0] : pickingId;
            const validPidsString = pickIdStr ? pickIdStr.split(',').filter((p: string) => p.trim() !== '').join(',') : '';

            const parsedOrderId = isNaN(Number(orderId)) ? (orderId as string) : parseInt(orderId as string);
            const localOrder = orderId ? await getOrderWithLines(parsedOrderId) : null;
            const pendingReturns = orderId ? await getPendingReturnsForOrder(parsedOrderId) : {};

            const deliveredTotals: { [key: number]: number } = {};
            (localOrder?.lines || []).forEach((l: any) => {
                const qty = l.qty_delivered !== undefined && l.qty_delivered !== null
                    ? l.qty_delivered
                    : (l.product_uom_qty || 0);
                deliveredTotals[l.product_id] = (deliveredTotals[l.product_id] || 0) + qty;
            });

            const aggregateLines = (rawLines: any[], ceilingMap?: { [key: number]: number }) => {
                const grouped = rawLines.reduce((acc: { [key: number]: ReturnLine }, l: any) => {
                    const pid = l.product_id;
                    if (!acc[pid]) {
                        acc[pid] = {
                            product_id: pid,
                            product_name: l.product_name || `Product #${pid} `,
                            maxQuantity: 0,
                            quantity: 0,
                            uom_id: l.product_uom_id || l.uom_id || 1,
                            uom_factor: l.uom_factor || 1,
                        };
                    }
                    const max = l.qty_delivered !== undefined && l.qty_delivered !== null
                        ? l.qty_delivered
                        : (l.product_uom_qty || l.maxQuantity || 0);

                    acc[pid].maxQuantity += max;
                    return acc;
                }, {});

                return Object.values(grouped).map(l => {
                    const pid = l.product_id;
                    const pendingQty = pendingReturns[pid] || 0;
                    let finalMax = l.maxQuantity;

                    if (ceilingMap && ceilingMap[pid] !== undefined) {
                        finalMax = Math.min(finalMax, ceilingMap[pid]);
                    }

                    l.maxQuantity = Math.max(0, finalMax - pendingQty);
                    return l;
                }).filter(l => l.maxQuantity > 0);
            };

            const localLinesRaw = (localOrder?.lines || []).filter((l: any) => {
                const max = l.qty_delivered !== undefined && l.qty_delivered !== null
                    ? l.qty_delivered
                    : (l.product_uom_qty || 0);
                return max > 0;
            });
            let finalLines = aggregateLines(localLinesRaw, deliveredTotals);

            if (!isOffline && validPidsString) {
                try {
                    const proposal = await stockService.getReturnProposal(validPidsString);
                    if (proposal?.data?.success && proposal.data.lines?.length > 0) {
                        finalLines = aggregateLines(proposal.data.lines, deliveredTotals);
                    }
                } catch (err) {
                    console.warn('Return proposal API failed, using local data:', err);
                }
            }

            setLines(finalLines);
            if (finalLines.length === 0) {
                showAlert({
                    title: i18n.t('common.info'),
                    message: i18n.t('returns.nothing_to_return'),
                    onConfirm: () => {
                        setAlertConfig(prev => ({ ...prev, visible: false }));
                        router.back();
                    }
                });
                return;
            }

            const reasonRes: any = await getReturnReasons();
            const reasonsList: any[] = reasonRes?.data?.reasons || reasonRes;
            if (reasonsList && Array.isArray(reasonsList) && reasonsList.length > 0) {
                setReasons(reasonsList);
                setSelectedReasonId(reasonsList[0].id.toString());
            }

            // Load return locations
            const repProfile = useOfflineStore.getState().salesRepProfile;
            let returnLocations: any[] = [];
            if (repProfile && repProfile.return_location_ids) {
                try {
                    const parsed = typeof repProfile.return_location_ids === 'string'
                        ? JSON.parse(repProfile.return_location_ids)
                        : repProfile.return_location_ids;
                    if (Array.isArray(parsed)) {
                        returnLocations = parsed.map((loc: any) => {
                            if (typeof loc === 'object' && loc !== null) {
                                return { id: loc.id, name: loc.display_name || loc.name };
                            }
                            return { id: loc, name: `Location #${loc}` };
                        });
                    }
                } catch (e) {
                    console.warn("Failed to parse return_location_ids:", e);
                }
            }
            if (returnLocations.length === 0 && repProfile?.return_location_id) {
                returnLocations = [{
                    id: repProfile.return_location_id,
                    name: repProfile.return_location_name || `Location #${repProfile.return_location_id}`
                }];
            }
            setLocationsList(returnLocations);
            if (returnLocations.length > 0) {
                setSelectedLocationId(returnLocations[0].id.toString());
            }
        } catch (e: any) {
            showAlert({
                title: i18n.t('common.error'),
                message: e.message || i18n.t('returns.load_data_error'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setLoading(false);
        }
    };

    const updateQty = (productId: number, delta: number) => {
        setLines(prev =>
            prev.map(l =>
                l.product_id === productId
                    ? { ...l, quantity: Math.min(Math.max(0, l.quantity + delta), l.maxQuantity) }
                    : l
            )
        );
    };

    const setQty = (productId: number, text: string) => {
        const num = parseFloat(text) || 0;
        setLines(prev =>
            prev.map(l =>
                l.product_id === productId
                    ? { ...l, quantity: Math.min(Math.max(0, num), l.maxQuantity) }
                    : l
            )
        );
    };

    const selectedReasonName = reasons.find(r => r.id.toString() === selectedReasonId)?.name || '';
    const totalReturning = lines.reduce((s, l) => s + l.quantity, 0);

    const handleSubmit = async () => {
        if (!lines.some(l => l.quantity > 0)) {
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('returns.enter_qty'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }

        setSubmitting(true);
        try {
            const pickIdStr = Array.isArray(pickingId) ? pickingId[0] : pickingId;
            const pidList = pickIdStr ? pickIdStr.split(',').map((id: string) => parseInt(id)).filter((id: number) => !isNaN(id)) : [];

            const returnLineData = lines
                .filter(l => l.quantity > 0)
                .map(l => ({ 
                    product_id: l.product_id, 
                    quantity: l.quantity / (l.uom_factor || 1), 
                    uom_id: l.uom_id 
                }));

            const repProfile = useOfflineStore.getState().salesRepProfile;

            await useOfflineStore.getState().recordPendingAction({
                action_type: 'return_picking',
                payload: {
                    order_id: orderId,
                    picking_ids: pidList,
                    lines: returnLineData,
                    return_reason_id: selectedReasonId ? parseInt(selectedReasonId) : undefined,
                    return_reason: selectedReasonName,
                    location_id: selectedLocationId ? parseInt(selectedLocationId) : (repProfile?.return_location_id || undefined),
                }
            });

            setSubmitting(false);
            setTimeout(() => {
                showAlert({
                    title: i18n.t('common.success'),
                    message: i18n.t('returns.queued'),
                    onConfirm: () => {
                        setAlertConfig(prev => ({ ...prev, visible: false }));
                        router.dismiss(2);
                    }
                });
            }, 100);
        } catch (e: any) {
            setSubmitting(false);
            showAlert({
                title: i18n.t('common.error'),
                message: e.message || i18n.t('returns.queue_error'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        }
    };

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={{ color: colors.textSecondary, marginTop: 12 }}>{i18n.t('returns.loading_proposal')}</Text>
                </View>
            </SafeAreaView>
        );
    }

    const reasonItems = reasons.map(r => ({ label: r.name, value: r.id.toString() }));

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            <RNStatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />

            {/* ── Header ── */}
            <View style={styles.headerNav}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backBtn}
                >
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerNavTitle, { color: colors.text }]}>{i18n.t('returns.title')}</Text>
                <View style={{ width: 44 }} />
            </View>

            <ScrollView
                ref={scrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {/* ── Products Section ── */}
                <View style={styles.sectionHeader}>
                    <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
                        <Ionicons name="cube" size={16} color={colors.primary} />
                    </View>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{i18n.t('returns.products')}</Text>
                </View>

                <View style={[styles.glassCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {lines.map((line, idx) => {
                        const isSelected = line.quantity > 0;
                        return (
                            <View
                                key={line.product_id}
                                style={[
                                    styles.lineItem,
                                    idx < lines.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border + '40' }
                                ]}
                            >
                                <View style={{ flex: 1, marginRight: 12 }}>
                                    <Text style={[styles.lineName, { color: isSelected ? colors.primary : colors.text }]} numberOfLines={2}>
                                        {line.product_name}
                                    </Text>
                                    <Text style={[styles.maxLabel, { color: colors.textSecondary }]}>
                                        {i18n.t('returns.max') || 'Max'}: <Text style={{ fontWeight: '700', color: colors.text }}>{line.maxQuantity}</Text>
                                    </Text>
                                </View>

                                <View style={[styles.stepper, { backgroundColor: colors.background, borderColor: colors.border }]}>
                                    <TouchableOpacity
                                        style={[styles.stepBtn, line.quantity === 0 && { opacity: 0.3 }]}
                                        onPress={() => updateQty(line.product_id, -1)}
                                        disabled={line.quantity === 0}
                                    >
                                        <Ionicons name="remove" size={18} color={colors.text} />
                                    </TouchableOpacity>
                                    <TextInput
                                        style={[styles.stepInput, { color: colors.text }]}
                                        value={line.quantity.toString()}
                                        onChangeText={val => setQty(line.product_id, val)}
                                        keyboardType="numeric"
                                        textAlign="center"
                                        selectTextOnFocus
                                    />
                                    <TouchableOpacity
                                        style={[styles.stepBtn, line.quantity >= line.maxQuantity && { opacity: 0.3 }]}
                                        onPress={() => updateQty(line.product_id, 1)}
                                        disabled={line.quantity >= line.maxQuantity}
                                    >
                                        <Ionicons name="add" size={18} color={colors.text} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        );
                    })}
                </View>

                {/* ── Reason Section ── */}
                <View style={[styles.sectionHeader, { marginTop: 12 }]}>
                    <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
                        <Ionicons name="chatbubble" size={16} color={colors.primary} />
                    </View>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{i18n.t('returns.reason')}</Text>
                </View>

                {reasons.length > 0 ? (
                    <Dropdown
                        items={reasonItems}
                        selectedValue={selectedReasonId}
                        onSelect={setSelectedReasonId}
                        placeholder={i18n.t('returns.select_reason')}
                    />
                ) : (
                    <View style={[styles.emptyBox, { borderColor: colors.border, backgroundColor: colors.card }]}>
                        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                            {i18n.t('returns.no_reasons')}
                        </Text>
                    </View>
                )}

                {/* ── Return Location Section ── */}
                {locationsList.length > 1 && (
                    <>
                        <View style={[styles.sectionHeader, { marginTop: 20 }]}>
                            <View style={[styles.iconBox, { backgroundColor: colors.primary + '15' }]}>
                                <Ionicons name="location" size={16} color={colors.primary} />
                            </View>
                            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                                {i18n.t('returns.return_location') || 'Return Location'}
                            </Text>
                        </View>
                        <Dropdown
                            items={locationsList.map(loc => ({ label: loc.name, value: loc.id.toString() }))}
                            selectedValue={selectedLocationId}
                            onSelect={setSelectedLocationId}
                            placeholder={i18n.t('returns.select_location') || 'Select Return Location'}
                        />
                    </>
                )}

                {/* ── Message Banner ── */}
                <View style={[styles.infoBanner, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '20' }]}>
                    <Ionicons name="information-circle" size={20} color={colors.primary} />
                    <Text style={[styles.infoBannerText, { color: colors.textSecondary }]}>
                        {i18n.t('returns.credit_auto_info') || 'A credit note will be generated automatically once the returned products are received at the warehouse.'}
                    </Text>
                </View>
            </ScrollView>

            {/* ── Footer ── */}
            <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
                <View style={styles.footerInfo}>
                    <Text style={[styles.footerSub, { color: colors.textSecondary }]}>{i18n.t('returns.items_to_return')}</Text>
                    <Text style={[styles.footerPrice, { color: colors.text }]}>{totalReturning}</Text>
                </View>
                <Button
                    title={i18n.t('returns.process_return')}
                    onPress={handleSubmit}
                    disabled={submitting || totalReturning === 0}
                    style={styles.submitBtn}
                    variant={totalReturning > 0 ? 'primary' : 'outline'}
                />
            </View>

            <CustomAlert
                visible={alertConfig.visible}
                title={alertConfig.title}
                message={alertConfig.message}
                onConfirm={alertConfig.onConfirm}
                onCancel={alertConfig.onCancel}
                confirmText={alertConfig.confirmText}
                cancelText={alertConfig.cancelText}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    headerNav: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 15, paddingTop: 10,
    },
    backBtn: {
        width: 44, height: 44, borderRadius: 22,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.05)',
    },
    headerNavTitle: { fontSize: 20, fontWeight: 'bold', flex: 1, textAlign: 'center' },
    content: { paddingHorizontal: 20, paddingBottom: 30 },

    sectionHeader: {
        flexDirection: 'row', alignItems: 'center',
        gap: 12, marginBottom: 12, paddingHorizontal: 4,
    },
    iconBox: {
        width: 32, height: 32, borderRadius: 10,
        alignItems: 'center', justifyContent: 'center',
    },
    sectionTitle: { fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },

    glassCard: {
        borderRadius: 20, borderWidth: 1, marginBottom: 20,
        ...SHADOW, shadowOpacity: 0.05, elevation: 2,
    },
    lineItem: { flexDirection: 'row', alignItems: 'center', padding: 18 },
    lineName: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
    maxLabel: { fontSize: 13 },

    stepper: {
        flexDirection: 'row', alignItems: 'center',
        borderRadius: 12, borderWidth: 1.5, overflow: 'hidden'
    },
    stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    stepInput: { width: 48, height: 40, fontSize: 17, fontWeight: 'bold' },

    emptyBox: {
        padding: 20, borderRadius: 16, borderWidth: 1,
        alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed'
    },
    infoBanner: {
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        padding: 16, borderRadius: 16, borderWidth: 1, marginTop: 15,
    },
    infoBannerText: { flex: 1, fontSize: 13, lineHeight: 20, opacity: 0.8 },

    footer: {
        padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
        borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 20,
        ...SHADOW, shadowOffset: { width: 0, height: -4 },
    },
    footerInfo: { flex: 1 },
    footerSub: { fontSize: 12, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' },
    footerPrice: { fontSize: 28, fontWeight: '800' },
    submitBtn: { flex: 1.8, height: 58, borderRadius: 18 },
});
