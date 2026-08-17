import React, { useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, FlatList,
    RefreshControl, ActivityIndicator,
} from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { useFocusEffect, useRouter, useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import i18n from '../../i18n';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as stockService from '../../services/api/stockService';
import { CustomAlert } from '../../components/CustomAlert';

interface GeneralReturnItem {
    id: number;
    name: string;
    partner_id: number;
    partner_name?: string;
    state: string;
    return_date: string;
}

export default function GeneralReturnListScreen() {
    const { colors } = useThemeStore();
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const router = useRouter();
    const { isOffline } = useOfflineStore();

    const [requests, setRequests] = useState<GeneralReturnItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [alertConfig, setAlertConfig] = useState({
        visible: false,
        title: '',
        message: '',
        onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })),
    });

    const loadRequests = useCallback(async () => {
        if (isOffline) {
            setRequests([]);
            setLoading(false);
            return;
        }
        try {
            const response = await stockService.getGeneralReturnList();
            if (response?.data?.success) {
                setRequests(response.data.requests || []);
            } else {
                throw new Error(response?.data?.message || response?.data?.error || 'Failed to load returns');
            }
        } catch (e: any) {
            setRequests([]);
            setAlertConfig({
                visible: true,
                title: i18n.t('common.error'),
                message: e.message || i18n.t('general_return.load_error'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })),
            });
        } finally {
            setLoading(false);
        }
    }, [isOffline]);

    useFocusEffect(
        useCallback(() => {
            setLoading(true);
            loadRequests();
        }, [loadRequests])
    );

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadRequests();
        setRefreshing(false);
    };

    const handleCreate = () => {
        if (isOffline) {
            setAlertConfig({
                visible: true,
                title: i18n.t('common.error'),
                message: i18n.t('general_return.requires_online'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })),
            });
            return;
        }
        router.push('/(drawer)/general_return_form');
    };

    const handleSelect = (item: GeneralReturnItem) => {
        router.push({
            pathname: '/(drawer)/general_return_form',
            params: { request_id: item.id.toString() },
        });
    };

    const getStatusColor = (state: string) => {
        switch (state) {
            case 'draft': return colors.textSecondary || '#6b7280';
            case 'submitted': return '#3b82f6';
            case 'waiting_approval': return '#f59e0b';
            case 'approved': return colors.primary || '#6366f1';
            case 'rejected': return colors.danger || '#ef4444';
            case 'done': return colors.success || '#10b981';
            case 'cancelled': return colors.danger || '#ef4444';
            default: return colors.primary || '#6366f1';
        }
    };

    const getStatusLabel = (state: string) => {
        const key = `general_return.state_${state}`;
        const translated = i18n.t(key);
        if (translated !== key) return translated;
        return state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    const renderItem = ({ item, index }: { item: GeneralReturnItem; index: number }) => (
        <Animated.View entering={FadeInDown.delay(index * 40)} style={[styles.card, { backgroundColor: colors.card }]}>
            <TouchableOpacity onPress={() => handleSelect(item)} activeOpacity={0.8}>
                <View style={styles.cardHeader}>
                    <Text style={[styles.requestName, { color: colors.text }]}>{item.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.state) + '15' }]}>
                        <Text style={[styles.statusText, { color: getStatusColor(item.state) }]}>
                            {getStatusLabel(item.state)}
                        </Text>
                    </View>
                </View>

                {item.partner_name ? (
                    <View style={styles.cardRow}>
                        <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
                        <Text style={[styles.cardText, { color: colors.textSecondary }]}>{item.partner_name}</Text>
                    </View>
                ) : null}

                <View style={styles.cardFooter}>
                    <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.dateText, { color: colors.textSecondary }]}>
                        {item.return_date ? dayjs(item.return_date).format('YYYY-MM-DD') : '—'}
                    </Text>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.menuButton}>
                    <Ionicons name="menu" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                    {i18n.t('general_return.title')}
                </Text>
                <View style={{ width: 40 }} />
            </View>

            {isOffline && (
                <View style={[styles.offlineBanner, { backgroundColor: colors.danger + '15' }]}>
                    <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
                    <Text style={[styles.offlineText, { color: colors.danger }]}>
                        {i18n.t('general_return.requires_online')}
                    </Text>
                </View>
            )}

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <FlatList
                    data={requests}
                    renderItem={renderItem}
                    keyExtractor={item => item.id.toString()}
                    contentContainerStyle={styles.listContainer}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Ionicons name="return-down-back-outline" size={64} color={colors.textSecondary + '40'} />
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                {isOffline
                                    ? i18n.t('general_return.offline_empty')
                                    : i18n.t('general_return.no_returns')}
                            </Text>
                        </View>
                    }
                />
            )}

            <TouchableOpacity
                style={[styles.fab, { backgroundColor: colors.primary }]}
                onPress={handleCreate}
                activeOpacity={0.85}
            >
                <Ionicons name="add" size={28} color="#fff" />
            </TouchableOpacity>

            <CustomAlert
                visible={alertConfig.visible}
                title={alertConfig.title}
                message={alertConfig.message}
                onConfirm={alertConfig.onConfirm}
            />
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
        paddingVertical: 12,
    },
    menuButton: { padding: 8 },
    headerTitle: { fontSize: 20, fontWeight: 'bold' },
    offlineBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 12,
        borderRadius: 12,
    },
    offlineText: { flex: 1, fontSize: 13, fontWeight: '500' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    listContainer: { padding: 16, paddingBottom: 100, gap: 12 },
    card: { borderRadius: 16, padding: 16 },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 10,
        gap: 8,
    },
    requestName: { fontSize: 16, fontWeight: '700', flex: 1 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    statusText: { fontSize: 12, fontWeight: '600' },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    cardText: { fontSize: 14, flex: 1 },
    cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    dateText: { fontSize: 13 },
    emptyContainer: { alignItems: 'center', paddingTop: 80, gap: 12 },
    emptyText: { fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
    fab: {
        position: 'absolute',
        right: 20,
        bottom: 24,
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
    },
});
