import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, Platform, StatusBar as RNStatusBar,
    TouchableOpacity, Alert, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../../i18n';
import OSMMap from '../../components/OSMMap';
import * as Location from 'expo-location';


/* ──────────────────────── Main Screen ──────────────────────── */
export default function CustomerProfile() {
    const { id } = useLocalSearchParams();
    const { colors, mode } = useThemeStore();
    const { currentRouteCustomers, endVisit, isSyncing } = useOfflineStore();
    const router = useRouter();

    const [customer, setCustomer] = useState<any>(null);
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [scrollEnabled, setScrollEnabled] = useState(true);

    useEffect(() => {
        getCurrentLocation();
    }, []);

    useEffect(() => {
        if (id && !isSyncing) {
            const found = currentRouteCustomers.find(c => c.id.toString() === id);
            console.log("FOUND CUSTOMER", found);
            if (found) setCustomer(found);
            else {
                console.warn(`Customer ${id} not found in current route`);
                // If it's a sync result, the customer might have been deleted/updated. Navigate back.
                router.replace('/(drawer)/routes');
            }
        }
    }, [id, currentRouteCustomers, isSyncing]);

    const getCurrentLocation = async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert(i18n.t('common.error'), i18n.t('common.location_permission_denied') || 'Permission to access location was denied');
            return;
        }

        try {
            let location = await Location.getCurrentPositionAsync({});
            const { latitude, longitude } = location.coords;
            setUserLocation({ latitude, longitude });
        } catch (error) {
            console.log("Could not fetch location", error);
        }
    };

    /* ── Directions handler ── */
    const handleGetDirections = () => {
        if (!customer?.latitude || !customer?.longitude) return;

        const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
        const latLng = `${customer.latitude},${customer.longitude}`;
        const label = customer.name;
        const url = Platform.select({
            ios: `${scheme}${label}@${latLng}`,
            android: `${scheme}${latLng}(${label})`
        });

        if (url) {
            Linking.openURL(url);
        }
    };

    const isVisitInProgress = customer?.state === 'in_progress';

    if (!customer) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ color: colors.text }}>{i18n.t('customer.loading')}</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            <RNStatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
            <View style={styles.headerNav}>
                <TouchableOpacity
                    onPress={() => router.push('/(drawer)/routes')}
                    style={[styles.circButton, { backgroundColor: 'rgba(0,0,0,0.05)' }]}
                >
                    <Ionicons name="arrow-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerNavTitle, { color: colors.text }]} numberOfLines={1}>{i18n.t('customer.profile_title')}</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                scrollEnabled={scrollEnabled}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {/* ── Profile Header Section ── */}
                <View style={styles.profileSection}>
                    <View style={styles.avatarContainer}>
                        <View style={[styles.avatar, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
                            <Text style={[styles.avatarText, { color: colors.primary }]}>
                                {customer.name?.charAt(0).toUpperCase()}
                            </Text>
                        </View>
                        {isVisitInProgress && (
                            <View style={styles.liveIndicatorContainer}>
                                <View style={styles.livePulse} />
                            </View>
                        )}
                    </View>

                    <Text style={[styles.customerName, { color: colors.primary }]}>{customer.name}</Text>
                    {isVisitInProgress && (
                        <View style={[styles.progressBadge, { backgroundColor: colors.primary + '20' }]}>
                            <Text style={[styles.progressText, { color: colors.primary }]}>{i18n.t('visit.in_progress')}</Text>
                        </View>
                    )}
                </View>

                {/* ── Contact Card ── */}
                <View style={[styles.glassCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <DetailRow icon="location" label={i18n.t('customer.address')} value={customer.address || i18n.t('common.na')} colors={colors} />
                    <DetailRow
                        icon="call"
                        label={i18n.t('customer.phone')}
                        value={customer.phone || i18n.t('common.na')}
                        colors={colors}
                        onPress={customer.phone ? () => Linking.openURL(`tel:${customer.phone}`) : undefined}
                    />
                    <DetailRow
                        icon="mail"
                        label={i18n.t('customer.email')}
                        value={customer.email || i18n.t('common.na')}
                        colors={colors}
                        last
                        onPress={customer.email ? () => Linking.openURL(`mailto:${customer.email}`) : undefined}
                    />
                </View>

                {/* ── Business Card ── */}
                <View style={[styles.glassCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <DetailRow icon="scan" label={i18n.t('customer.radius')} value={(customer.radius || 0) + i18n.t('common.unit_meters')} colors={colors} />
                    <DetailRow icon="briefcase" label={i18n.t('customer.vat')} value={customer.vat || i18n.t('common.na')} colors={colors} last />
                </View>

                {/* ── Financial Details Card ── */}
                <View style={[styles.glassCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <DetailRow 
                        icon="card" 
                        label={i18n.t('customer.sale_credit_limit')} 
                        value={(i18n.t('common.currency_symbol')) + (customer.sale_credit_limit || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} 
                        colors={colors} 
                    />
                    <DetailRow 
                        icon="pie-chart" 
                        label={i18n.t('customer.sale_credit_used')} 
                        value={(i18n.t('common.currency_symbol')) + (customer.sale_credit_used || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} 
                        colors={colors} 
                    />
                    <DetailRow 
                        icon="checkmark-circle" 
                        label={i18n.t('customer.allow_over_sale_credit')} 
                        value={customer.allow_over_sale_credit ? i18n.t('common.yes') : i18n.t('common.no')} 
                        colors={colors} 
                        last 
                    />
                </View>

                {/* ── Map Card with Navigation ── */}
                {!!(customer.latitude && customer.longitude) && (
                    <View style={[styles.glassCard, { padding: 0, backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.mapHeader}>
                            <Ionicons name="map" size={18} color={colors.primary} />
                            <Text style={[styles.mapHeaderText, { color: colors.text }]}>{i18n.t('customer.location')}</Text>
                            <TouchableOpacity style={styles.navButton} onPress={handleGetDirections}>
                                <Ionicons name="navigate" size={16} color="#fff" />
                                <Text style={styles.navButtonText}>{i18n.t('customer.navigate')}</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.mapContainer}>
                            <OSMMap
                                userLocation={userLocation}
                                latitude={customer.latitude}
                                longitude={customer.longitude}
                                isStatic={false}
                                height={220}
                                zoom={15}
                                radius={customer.radius}
                                onMapTouchStart={() => setScrollEnabled(false)}
                                onMapTouchEnd={() => setScrollEnabled(true)}
                            />
                        </View>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

/* ────────────── Detail Row Helper ────────────── */
const DetailRow = ({ icon, label, value, colors, last, onPress }: any) => {
    const Content = (
        <View style={[styles.detailRow, !last && { borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.1)' }]}>
            <Ionicons name={icon} size={20} color={colors.primary} style={{ marginRight: 15 }} />
            <View style={{ flex: 1 }}>
                <Text style={[styles.detailLabel, { color: colors.subtext }]}>{label}</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
            </View>
            {onPress && (
                <Ionicons name="chevron-forward" size={16} color={colors.subtext} style={{ opacity: 0.5 }} />
            )}
        </View>
    );

    if (onPress) {
        return (
            <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
                {Content}
            </TouchableOpacity>
        );
    }
    return Content;
};

/* ──────────────────────── Styles ──────────────────────── */
const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    headerBackground: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 200,
        borderBottomLeftRadius: 30,
        borderBottomRightRadius: 30,
    },
    headerNav: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 10,
        justifyContent: 'space-between',
    },
    headerNavTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
        flex: 1,
        textAlign: 'center',
    },
    circButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        paddingTop: 10,
    },
    profileSection: {
        alignItems: 'center',
        marginBottom: 20,
    },
    avatarContainer: {
        marginBottom: 12,
        position: 'relative',
    },
    avatar: {
        width: 90,
        height: 90,
        borderRadius: 45,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
    },
    avatarText: {
        fontSize: 36,
        fontWeight: 'bold',
    },
    liveIndicatorContainer: {
        position: 'absolute',
        bottom: 2,
        right: 2,
        backgroundColor: '#fff',
        padding: 4,
        borderRadius: 10,
    },
    livePulse: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#10b981',
    },
    customerName: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    progressBadge: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 20,
    },
    progressText: {
        fontSize: 12,
        fontWeight: '600',
    },
    glassCard: {
        marginHorizontal: 20,
        marginBottom: 16,
        borderRadius: 20,
        borderWidth: 1,
        padding: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
    },
    detailLabel: {
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    detailValue: {
        fontSize: 15,
        fontWeight: '600',
    },
    mapHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
    },
    mapHeaderText: {
        marginLeft: 10,
        fontSize: 14,
        fontWeight: '600',
        flex: 1,
    },
    navButton: {
        backgroundColor: '#3b82f6',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
        gap: 6,
    },
    navButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    mapContainer: {
        borderRadius: 20,
        overflow: 'hidden',
    },
});
