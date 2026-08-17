import React, { useEffect, useState, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Platform,
    StatusBar as RNStatusBar,
    FlatList,
    TextInput,
    Alert,
    ActivityIndicator,
    Linking
} from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useOfflineStore } from '../../store/useOfflineStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import BottomSheetModal from '../../components/BottomSheetModal';
import i18n from '../../i18n';
import { CustomAlert } from '../../components/CustomAlert';
import { CustomDropdown, DropdownItem } from '../../components/CustomDropdown';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import dayjs from 'dayjs';
import AddCustomerModal from '@/components/AddCustomerModal';
import * as Location from 'expo-location';
import OSMMap from '@/components/OSMMap';
import { getTraccarDevice, updateRouteCustomerSequence, insertPendingAction } from '@/services/database/repositories';

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

export default function Routes() {
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const { colors } = useThemeStore();
    const { routes, currentRoute, currentRouteCustomers, fetchLocalRoutes, selectRoute, startVisit, salesRepProfile, performSync } = useOfflineStore();
    const router = useRouter();
    const [isRouteModalVisible, setRouteModalVisible] = useState(false);
    const { scrollToCustomerId } = useLocalSearchParams<{ scrollToCustomerId: string }>();
    const flatListRef = useRef<FlatList>(null);
    // Force update for timer
    const [_, setTick] = useState(0);
    const today = dayjs().format('YYYY-MM-DD');
    const isTodayRoute = currentRoute?.date === today;
    const hasTodayRoute = routes.some((r: any) => r.date === today);

    // Search & Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [isFilterModalVisible, setFilterModalVisible] = useState(false);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [sortOption, setSortOption] = useState<'default' | 'name_asc' | 'name_desc' | 'location_asc' | 'location_desc'>('default');
    const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
    const [isFetchingLocation, setIsFetchingLocation] = useState(false);

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
    const activeVisitCustomer = (currentRouteCustomers || []).find(c => c.state === 'in_progress');

    // Timer effect
    useEffect(() => {
        const interval = setInterval(() => {
            setTick(t => t + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        fetchLocalRoutes();
    }, []);

    // Scroll to customer effect
    useEffect(() => {
        if (scrollToCustomerId && currentRouteCustomers.length > 0 && flatListRef.current) {
            const index = currentRouteCustomers.findIndex(c => c.id.toString() === scrollToCustomerId);
            if (index !== -1) {
                // Small delay to ensure layout is ready
                setTimeout(() => {
                    flatListRef.current?.scrollToIndex({
                        index,
                        animated: true,
                        viewPosition: 0.5 // Center the item
                    });
                }, 300);
            }
        }
    }, [scrollToCustomerId, currentRouteCustomers]);

    // Stale Visit Check
    useEffect(() => {
        if (activeVisitCustomer && activeVisitCustomer.visit_start_time) {
            const start = dayjs(activeVisitCustomer.visit_start_time);
            const now = dayjs();
            const diffHours = now.diff(start, 'hour');

            if (diffHours >= 4) {
                showAlert({
                    title: i18n.t('common.warning'),
                    message: i18n.t('routes.stale_visit_msg', { hours: diffHours }),
                    confirmText: i18n.t('routes.end_visit'),
                    cancelText: i18n.t('common.ok'),
                    onConfirm: async () => {
                        const { cancelVisit } = useOfflineStore.getState();
                        await cancelVisit(activeVisitCustomer.id);
                        setAlertConfig(prev => ({ ...prev, visible: false }));
                    },
                    onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                });
            }
        }
    }, [activeVisitCustomer?.id]);

    const handleSelectRoute = (route: any) => {
        selectRoute(route);
        setRouteModalVisible(false); // Close modal
        setSearchQuery('');
        setFilterStatus('all');
        setSortOption('default');
    };

    const [isAddCustomerModalVisible, setAddCustomerModalVisible] = useState(false);

    // Distance Modal State
    const [isDistanceModalVisible, setDistanceModalVisible] = useState(false);
    const [distanceData, setDistanceData] = useState<{ customer: any, distance: number, userLat: number, userLng: number, allowedRadius: number } | null>(null);

    // Start Visit Loading State
    const [isStartingVisit, setIsStartingVisit] = useState(false);
    const [startingCustomerId, setStartingCustomerId] = useState<number | null>(null);

    const handleAddCustomer = () => {
        if (!currentRoute) {
            showAlert({
                title: i18n.t('common.warning') || 'Warning',
                message: i18n.t('routes.select_route_first') || 'Please select a route first.',
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }
        setAddCustomerModalVisible(true);
    };

    const handleStartVisit = async (customer: any) => {
        if (isStartingVisit) return;

        setIsStartingVisit(true);
        setStartingCustomerId(customer.id);

        try {
            let latitude = 0;
            let longitude = 0;

            // 1. Attempt to get current location for ALL visits (to record start location)
            try {
                let { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                    latitude = location.coords.latitude;
                    longitude = location.coords.longitude;
                } else if (customer.enable_location == 1 || customer.enable_location === true || customer.enable_location === '1' || customer.enable_location === 'true') {
                    // If geofencing is REQUIRED, we must stop if permission denied
                    showAlert({
                        title: i18n.t('common.error'),
                        message: i18n.t('routes.location_permission_required'),
                        onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                    });
                    return;
                }
            } catch (err) {
                console.warn("Location capture failed", err);
                if (customer.enable_location == 1 || customer.enable_location === true || customer.enable_location === '1' || customer.enable_location === 'true') {
                    showAlert({
                        title: i18n.t('common.error'),
                        message: i18n.t('routes.could_not_verify_location'),
                        onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                    });
                    return;
                }
            }

            // 2. Geofencing Check (Only if enabled for this customer)
            if ((customer.enable_location == 1 || customer.enable_location === true || customer.enable_location === '1' || customer.enable_location === 'true') && customer.latitude && customer.longitude) {
                const distance = getDistanceFromLatLonInMeters(
                    latitude,
                    longitude,
                    customer.latitude,
                    customer.longitude
                );

                const allowedRadius = customer.radius > 0 ? customer.radius : 500; // Default 500m
                if (distance > allowedRadius) {
                    setDistanceData({
                        customer,
                        distance,
                        userLat: latitude,
                        userLng: longitude,
                        allowedRadius
                    });
                    setDistanceModalVisible(true);
                    return; // Stop here, user must acknowledge via modal or get closer
                }
            }

            // 3. Visit Type Notification
            if (customer.visit_type_name) {
                // Notifying only, can be auto-confirmed or removed if too annoying
                // But for now, using CustomAlert as requested
                showAlert({
                    title: i18n.t('common.warning'),
                    message: i18n.t('routes.visit_type_notification', { type: customer.visit_type_name }),
                    onConfirm: () => {
                        setAlertConfig(prev => ({ ...prev, visible: false }));
                        startVisit(customer.id, latitude, longitude);
                    }
                });
                return;
            }

            await startVisit(customer.id, latitude, longitude);
        } catch (error) {
            console.error("Start Visit Error:", error);
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('routes.failed_start_visit'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        } finally {
            setIsStartingVisit(false);
            setStartingCustomerId(null);
        }
    };

    const handleCustomerAdded = async (newCustomer: any) => {
        // Refresh the current route to show the new customer
        if (currentRoute) {
            await selectRoute(currentRoute);
        }
        router.push(`/customer/${newCustomer.local_id}` as any);
    };

    const openRouteInGoogleMaps = async () => {
        const validCustomers = (currentRouteCustomers || []).filter(
            (c: any) => c.latitude && c.longitude && Number(c.latitude) !== 0 && Number(c.longitude) !== 0
        );

        if (validCustomers.length === 0) {
            showAlert({
                title: i18n.t('routes.no_locations_title'),
                message: i18n.t('routes.no_locations_msg'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
            return;
        }

        let sortedCustomers = [...validCustomers];

        try {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                const userLat = Number(location.coords.latitude);
                const userLng = Number(location.coords.longitude);

                // Point-to-Point Nearest Neighbor algorithm
                const unvisited = [...validCustomers];
                const sorted: any[] = [];
                let currentLat = userLat;
                let currentLng = userLng;

                while (unvisited.length > 0) {
                    let nearestIdx = 0;
                    let minDistance = Infinity;

                    for (let i = 0; i < unvisited.length; i++) {
                        const lat = Number(unvisited[i].latitude);
                        const lng = Number(unvisited[i].longitude);
                        const dist = getDistanceFromLatLonInMeters(currentLat, currentLng, lat, lng);
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestIdx = i;
                        }
                    }

                    const nearestCustomer = unvisited.splice(nearestIdx, 1)[0];
                    sorted.push(nearestCustomer);
                    currentLat = Number(nearestCustomer.latitude);
                    currentLng = Number(nearestCustomer.longitude);
                }
                
                sortedCustomers = sorted;

                // 2. Update sequence in SQLite and application store
                for (let i = 0; i < sortedCustomers.length; i++) {
                    const newSeq = i + 1;
                    sortedCustomers[i].sequence = newSeq;
                    await updateRouteCustomerSequence(sortedCustomers[i].id, newSeq);
                }
                
                // Update zustand store state to update application UI immediately
                useOfflineStore.setState({ currentRouteCustomers: sortedCustomers });

                // 3. Queue the reorder pending action for Odoo
                if (currentRoute?.odoo_id) {
                    const sequencesPayload = sortedCustomers.map((c) => ({
                        route_customer_id: c.odoo_id || null,
                        local_route_customer_id: c.id,
                        sequence: c.sequence,
                        partner_local_id: c.partner_local_id || null
                    }));
                    await insertPendingAction({
                        action_type: 'reorder_route_customers',
                        payload: {
                            route_id: currentRoute.odoo_id,
                            sequences: sequencesPayload
                        }
                    });

                    // Trigger immediate sync to update the backend sequence
                    performSync().catch((err) => console.warn("Auto-sync of route sequence failed:", err));
                }
            }
        } catch (err) {
            console.warn("Could not retrieve current location for sorting. Falling back to default order.", err);
        }

        let url = '';
        if (validCustomers.length === 1) {
            const dest = validCustomers[0];
            url = `https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}`;
        } else {
            const dest = sortedCustomers[sortedCustomers.length - 1];
            const waypoints = sortedCustomers
                .slice(0, -1)
                .map((c: any) => `${c.latitude},${c.longitude}`)
                .join('%7C');
            url = `https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}&waypoints=${waypoints}`;
        }

        Linking.openURL(url).catch((err) => {
            console.error("Failed to open maps", err);
            showAlert({
                title: i18n.t('common.error'),
                message: i18n.t('routes.could_not_open_maps'),
                onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
            });
        });
    };

    const formatDuration = (startTime: string) => {
        if (!startTime) return "00:00:00";
        const start = dayjs(startTime);
        const now = dayjs();
        const diff = now.diff(start, 'second');

        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;

        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const renderCustomerItem = ({ item }: { item: any }) => {
        if (item.name === 'Unknown Customer') {
            console.log("Routes: Found Unknown Customer item:", JSON.stringify(item, null, 2));
        }
        const isActiveVisit = activeVisitCustomer?.id === item.id;

        return (
            <View style={[
                styles.customerCard,
                { backgroundColor: colors.card, borderColor: isActiveVisit ? colors.primary : colors.border },
                isActiveVisit && { borderWidth: 2 } // Make it more prominent
            ]}>
                <View style={styles.cardHeader}>
                    <View style={styles.customerInfo}>
                        <Text style={[styles.customerName, { color: colors.text }]}>{item.name}</Text>
                        <Text style={[styles.customerAddress, { color: colors.subtext }]}>{item.address}</Text>
                        {/* {item.sale_credit_limit > 0 && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                                <Ionicons name="card-outline" size={12} color={colors.primary} />
                                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '500' }}>
                                    {i18n.t('common.credit_limit')}: {i18n.t('common.currency_symbol')}{item.sale_credit_limit.toLocaleString()}
                                </Text>
                            </View>
                        )} */}
                    </View>
                    <View style={styles.customerStatus}>
                        <Ionicons
                            name={item.state === 'visited' ? 'checkmark-circle' : 'time-outline'}
                            size={24}
                            color={item.state === 'visited' ? colors.success : colors.warning}
                        />
                    </View>
                </View>

                <View style={[styles.cardActions, { borderTopColor: colors.border }]}>
                    {item.state === 'in_progress' ? (
                        <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'center', padding: 10, backgroundColor: colors.primary + '10' }}>
                                <Ionicons name="timer-outline" size={20} color={colors.primary} />
                                <Text style={{ marginLeft: 8, fontSize: 16, fontWeight: 'bold', color: colors.primary }}>
                                    {formatDuration(item.visit_start_time)}
                                </Text>
                            </View>
                            {item.visit_type_name && (
                                <View style={{ paddingBottom: 10, alignItems: 'center', backgroundColor: colors.primary + '10' }}>
                                    <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '500' }}>
                                        {i18n.t('routes.visit_type_msg', { type: item.visit_type_name })}
                                    </Text>
                                </View>
                            )}
                            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border }}>
                                {salesRepProfile?.access_visit_order && (
                                    <TouchableOpacity style={styles.actionButton} onPress={() => router.push(`/customer/${item.id}/order`)}>
                                        <Ionicons name="cart-outline" size={20} color={colors.text} />
                                        <Text style={[styles.actionText, { color: colors.text }]}>{i18n.t('routes.order')}</Text>
                                    </TouchableOpacity>
                                )}
                                {salesRepProfile?.access_visit_payment && (
                                    <TouchableOpacity style={styles.actionButton} onPress={() => router.push(`/customer/${item.id}/payment`)}>
                                        <Ionicons name="cash-outline" size={20} color={colors.text} />
                                        <Text style={[styles.actionText, { color: colors.text }]}>{i18n.t('routes.payment')}</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity style={styles.actionButton} onPress={() => openEndVisitModal(item)}>
                                    <Ionicons name="stop-circle-outline" size={20} color={colors.danger} />
                                    <Text style={[styles.actionText, { color: colors.danger, fontSize: 12 }]}>{i18n.t('routes.end_visit')}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : (
                        <>
                            <TouchableOpacity
                                style={[styles.actionButton, (isStartingVisit || activeVisitCustomer) && { opacity: 0.5 }]}
                                onPress={() => handleStartVisit(item)}
                                disabled={isStartingVisit || !!activeVisitCustomer}
                            >
                                {isStartingVisit && startingCustomerId === item.id ? (
                                    <ActivityIndicator size="small" color={colors.primary} />
                                ) : (
                                    <Ionicons name="play-circle-outline" size={20} color={colors.primary} />
                                )}
                                <Text style={[styles.actionText, { color: colors.primary }]}>{i18n.t('routes.start_visit')}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={() => router.push(`/customer/${item.id}`)}
                            >
                                <Ionicons name="person-outline" size={20} color={colors.text} />
                                <Text style={[styles.actionText, { color: colors.text }]}>{i18n.t('routes.profile')}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={() => router.push(`/customer/${item.id}/orders` as any)}
                            >
                                <Ionicons name="list-outline" size={20} color={colors.text} />
                                <Text style={[styles.actionText, { color: colors.text }]}>{i18n.t('routes.history')}</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            </View>
        );
    };


    // End Visit State
    const [isEndVisitModalVisible, setEndVisitModalVisible] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
    const [visitReason, setVisitReason] = useState('customer_unavailable'); // Default value
    const [visitResult, setVisitResult] = useState('successful');
    const [visitNotes, setVisitNotes] = useState('');
    const [isFollowUpNeeded, setIsFollowUpNeeded] = useState(false);
    const [followUpDate, setFollowUpDate] = useState(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);

    const onDateChange = (event: any, selectedDate?: Date) => {
        const currentDate = selectedDate || followUpDate;
        if (Platform.OS === 'ios') {
            setShowDatePicker(false);
        }
        setFollowUpDate(currentDate);
    };

    const showAndroidDatePicker = () => {
        DateTimePickerAndroid.open({
            value: followUpDate,
            mode: 'date',
            is24Hour: true,
            onChange: (event, selectedDate) => {
                if (event.type === 'set' && selectedDate) {
                    setFollowUpDate(selectedDate);
                }
            },
        });
    };

    const openEndVisitModal = (customer: any) => {
        setSelectedCustomer(customer);
        setVisitResult('successful');
        setVisitNotes('');
        setIsFollowUpNeeded(false);
        // setFollowUpDate(new Date()); // Keep previous selection if any, or default is set in state init
        setEndVisitModalVisible(true);
    };

    const handleEndVisit = async () => {
        if (!selectedCustomer) return;
        const { endVisit } = useOfflineStore.getState();

        const visitData = {
            visit_result: visitResult,
            notes: visitNotes,
            follow_up_date: isFollowUpNeeded ? dayjs(followUpDate).format('YYYY-MM-DD') : null
        };

        await endVisit(selectedCustomer.id, visitData);
        setEndVisitModalVisible(false);
        showAlert({
            title: i18n.t('common.success'),
            message: i18n.t('routes.visit_ended'),
            onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false }))
        });
    };

    const handleCancelVisit = (customer: any) => {
        showAlert({
            title: i18n.t('common.confirm'),
            message: i18n.t('routes.cancel_visit_confirm'),
            confirmText: i18n.t('common.confirm'),
            cancelText: i18n.t('common.cancel'),
            onConfirm: async () => {
                const { cancelVisit } = useOfflineStore.getState();
                await cancelVisit(customer.id);
                setAlertConfig(prev => ({ ...prev, visible: false }));
            },
            onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false }))
        });
    };

    const filteredCustomers = (currentRouteCustomers || []).filter((c: any) => {
        const matchesSearch = !searchQuery || 
                              c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              c.address?.toLowerCase().includes(searchQuery.toLowerCase());
        
        let matchesStatus = true;
        if (filterStatus === 'visited') {
            matchesStatus = c.state === 'visited';
        } else if (filterStatus === 'pending') {
            matchesStatus = c.state !== 'visited' && c.state !== 'in_progress';
        } else if (filterStatus === 'in_progress') {
            matchesStatus = c.state === 'in_progress';
        }
        
        return matchesSearch && matchesStatus;
    });

    const sortedCustomers = [...filteredCustomers].sort((a: any, b: any) => {
        if (sortOption === 'name_asc') {
            return (a.name || '').localeCompare(b.name || '');
        } else if (sortOption === 'name_desc') {
            return (b.name || '').localeCompare(a.name || '');
        } else if (sortOption === 'location' && userLocation) {
            const latA = Number(a.latitude) || 0;
            const lngA = Number(a.longitude) || 0;
            const latB = Number(b.latitude) || 0;
            const lngB = Number(b.longitude) || 0;

            const distA = getDistanceFromLatLonInMeters(userLocation.lat, userLocation.lng, latA, lngA);
            const distB = getDistanceFromLatLonInMeters(userLocation.lat, userLocation.lng, latB, lngB);

            return distA - distB;
        } else if (sortOption === 'location_desc' && userLocation) {
            const latA = Number(a.latitude) || 0;
            const lngA = Number(a.longitude) || 0;
            const latB = Number(b.latitude) || 0;
            const lngB = Number(b.longitude) || 0;

            const distA = getDistanceFromLatLonInMeters(userLocation.lat, userLocation.lng, latA, lngA);
            const distB = getDistanceFromLatLonInMeters(userLocation.lat, userLocation.lng, latB, lngB);

            return distB - distA;
        }
        return 0; // default
    });

    const handleSortByLocation = async (type: 'location_asc' | 'location_desc') => {
        setIsFetchingLocation(true);
        try {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                setUserLocation({ lat: location.coords.latitude, lng: location.coords.longitude });
                setSortOption(type);
            } else {
                setSortOption('default');
                Alert.alert(i18n.t('common.error') || "Error", i18n.t('routes.location_permission_required') || "Location permission required.");
            }
        } catch (e) {
            console.warn("Could not get location", e);
            setSortOption('default');
        } finally {
            setIsFetchingLocation(false);
        }
    };

    return (
        <SafeAreaProvider style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 12 }}>
                        <Ionicons name="menu-outline" size={28} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>{i18n.t('routes.title')}</Text>
                </View>

                <View style={styles.headerActions}>
                    {currentRoute && currentRouteCustomers.length > 0 && (
                        <TouchableOpacity onPress={openRouteInGoogleMaps} style={styles.addButton}>
                            <Ionicons name="map-outline" size={28} color={colors.primary} />
                        </TouchableOpacity>
                    )}
                    {salesRepProfile?.access_create_customer && (
                        <TouchableOpacity onPress={handleAddCustomer} style={styles.addButton}>
                            <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Search and Filter */}
            {currentRoute && (
                <View style={{ flexDirection: 'row', paddingHorizontal: 20, marginBottom: 10, gap: 10 }}>
                    <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Ionicons name="search" size={20} color={colors.subtext} style={{ marginLeft: 10 }} />
                        <TextInput
                            style={[styles.searchInput, { color: colors.text }]}
                            placeholder={i18n.t('common.search') || "Search..."}
                            placeholderTextColor={colors.subtext}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                    </View>
                    <TouchableOpacity 
                        style={[styles.filterBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => setFilterModalVisible(true)}
                    >
                        <Ionicons name="filter-outline" size={22} color={colors.primary} />
                    </TouchableOpacity>
                </View>
            )}

            {/* Route Selector */}
            <TouchableOpacity
                style={[styles.routeSelector, { backgroundColor: colors.card }]}
                onPress={() => setRouteModalVisible(true)}
            >
                <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={[styles.routeSelectorText, { color: colors.text }]}>
                            {currentRoute ? currentRoute.name : (hasTodayRoute ? i18n.t('routes.select_todays_route') : i18n.t('routes.no_route_today'))}
                        </Text>
                        {isTodayRoute && (
                            <View style={{ backgroundColor: colors.primary + '20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 }}>
                                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: 'bold' }}>{i18n.t('common.today')}</Text>
                            </View>
                        )}
                    </View>
                    {currentRoute && (
                        <Text style={{ fontSize: 12, color: colors.subtext }}>{currentRoute.date}</Text>
                    )}
                </View>
                <Ionicons name="chevron-down" size={20} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.content}>
                {currentRoute ? (
                    <FlatList
                        ref={flatListRef}
                        data={sortedCustomers}
                        renderItem={renderCustomerItem}
                        keyExtractor={(item) => item.id.toString()}
                        onScrollToIndexFailed={(info) => {
                            // Workaround for scrolling before layout
                            flatListRef.current?.scrollToOffset({
                                offset: info.averageItemLength * info.index,
                                animated: true
                            });
                        }}
                        contentContainerStyle={styles.listContent}
                        ListEmptyComponent={
                            <Text style={[styles.emptyText, { color: colors.subtext }]}>{i18n.t('routes.no_customers')}</Text>
                        }
                    />
                ) : (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                        <Ionicons name="calendar-outline" size={64} color={colors.subtext} />
                        <Text style={[styles.emptyText, { color: colors.subtext, marginTop: 20 }]}>
                            {hasTodayRoute ? i18n.t('routes.select_route_msg') : i18n.t('routes.no_route_scheduled')}
                        </Text>
                    </View>
                )}
            </View>

            {/* Route Selection Modal */}
            <BottomSheetModal
                visible={isRouteModalVisible}
                onClose={() => setRouteModalVisible(false)}
                title={i18n.t('routes.select_route_modal')}
                scrollable={false}
            >
                <FlatList
                    data={routes}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={[styles.modalItem, { borderBottomColor: colors.border }]}
                            onPress={() => handleSelectRoute(item)}
                        >
                            <View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                    <Text style={[styles.modalItemText, { color: colors.text }]}>
                                        {item.name}
                                    </Text>
                                    {item.date === today && (
                                        <View style={{ backgroundColor: colors.primary + '20', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 }}>
                                            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: 'bold' }}>{i18n.t('common.today')}</Text>
                                        </View>
                                    )}
                                </View>
                                <Text style={{ fontSize: 12, color: colors.subtext }}>{item.date}</Text>
                            </View>
                            {currentRoute?.id === item.id && (
                                <Ionicons name="checkmark" size={20} color={colors.primary} />
                            )}
                        </TouchableOpacity>
                    )}
                />
            </BottomSheetModal>

            {/* End Visit Modal */}
            <BottomSheetModal
                visible={isEndVisitModalVisible}
                onClose={() => setEndVisitModalVisible(false)}
                title={i18n.t('routes.end_visit')}
            >
                <View style={{ padding: 20 }}>
                    <Text style={{ color: colors.text, marginBottom: 8 }}>{i18n.t('routes.visit_result')}</Text>
                    <CustomDropdown
                        items={[
                            { label: i18n.t('routes.visit_result_successful'), value: 'successful' },
                            { label: i18n.t('routes.visit_result_customer_unavailable'), value: 'customer_unavailable' },
                            { label: i18n.t('routes.visit_result_refused'), value: 'refused' },
                            { label: i18n.t('routes.visit_result_closed'), value: 'closed' },
                            { label: i18n.t('routes.visit_result_rescheduled'), value: 'rescheduled' },
                            { label: i18n.t('routes.visit_result_other'), value: 'other' },
                        ]}
                        selectedValue={visitResult}
                        onSelect={(value) => setVisitResult(value as string)}
                        style={{ marginBottom: 12 }}
                    />

                    <Text style={{ color: colors.text, marginBottom: 8 }}>{i18n.t('routes.notes')}</Text>
                    <TextInput
                        style={[styles.input, { borderColor: colors.border, color: colors.text, height: 80 }]}
                        placeholder={i18n.t('routes.notes_placeholder')}
                        placeholderTextColor={colors.subtext}
                        value={visitNotes}
                        onChangeText={setVisitNotes}
                        multiline
                    />

                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 16 }}>
                        <TouchableOpacity onPress={() => setIsFollowUpNeeded(!isFollowUpNeeded)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name={isFollowUpNeeded ? "checkbox" : "square-outline"} size={24} color={colors.primary} />
                            <Text style={{ marginLeft: 8, color: colors.text }}>{i18n.t('routes.follow_up_needed')}</Text>
                        </TouchableOpacity>
                    </View>

                    {isFollowUpNeeded && (
                        <View>
                            <Text style={{ color: colors.text, marginBottom: 8 }}>{i18n.t('routes.follow_up_date')}</Text>
                            <TouchableOpacity
                                style={[styles.input, { borderColor: colors.border, justifyContent: 'center' }]}
                                onPress={() => {
                                    if (Platform.OS === 'android') {
                                        showAndroidDatePicker();
                                    } else {
                                        setShowDatePicker(true);
                                    }
                                }}
                            >
                                <Text style={{ color: colors.text }}>{dayjs(followUpDate).format('YYYY-MM-DD')}</Text>
                            </TouchableOpacity>
                            {showDatePicker && Platform.OS === 'ios' && (
                                <DateTimePicker
                                    testID="dateTimePicker"
                                    value={followUpDate}
                                    mode="date"
                                    is24Hour={true}
                                    display="default"
                                    onChange={onDateChange}
                                />
                            )}
                        </View>
                    )}

                    <TouchableOpacity
                        style={[styles.endVisitButton, { backgroundColor: colors.danger, marginTop: 24 }]}
                        onPress={handleEndVisit}
                    >
                        <Text style={styles.endVisitButtonText}>{i18n.t('routes.end_visit_stop_timer')}</Text>
                    </TouchableOpacity>
                </View>
            </BottomSheetModal>

            {/* Filter Modal */}
            <BottomSheetModal
                visible={isFilterModalVisible}
                onClose={() => setFilterModalVisible(false)}
                title={i18n.t('common.filter') || "Filter"}
                scrollable={false}
            >
                <View style={{ padding: 20 }}>
                    <Text style={{ color: colors.textSecondary, marginBottom: 12, fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {i18n.t('routes.status') || "Status"}
                    </Text>
                    <View style={styles.chipContainer}>
                        {[
                            { id: 'all', label: i18n.t('common.all') || "All", icon: "grid-outline" },
                            { id: 'pending', label: i18n.t('routes.pending') || "Pending", icon: "time-outline" },
                            { id: 'in_progress', label: i18n.t('routes.in_progress') || "In Progress", icon: "play-circle-outline" },
                            { id: 'visited', label: i18n.t('routes.visited') || "Visited", icon: "checkmark-circle-outline" },
                        ].map((opt) => (
                            <TouchableOpacity
                                key={opt.id}
                                style={[
                                    styles.chip,
                                    { 
                                        backgroundColor: filterStatus === opt.id ? colors.primary : colors.card, 
                                        borderColor: filterStatus === opt.id ? colors.primary : colors.border,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        paddingHorizontal: 14,
                                        paddingVertical: 8,
                                    }
                                ]}
                                onPress={() => setFilterStatus(opt.id)}
                            >
                                <Ionicons 
                                    name={opt.icon as any} 
                                    size={16} 
                                    color={filterStatus === opt.id ? '#fff' : colors.textSecondary} 
                                    style={{ marginRight: 6 }} 
                                />
                                <Text style={[
                                    styles.chipText,
                                    { color: filterStatus === opt.id ? '#fff' : colors.textSecondary, fontWeight: filterStatus === opt.id ? '700' : '500' }
                                ]}>
                                    {opt.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    
                    <Text style={{ color: colors.textSecondary, marginBottom: 12, marginTop: 24, fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {i18n.t('routes.sort_by') || "Sort By"}
                    </Text>
                    <View style={styles.chipContainer}>
                        {[
                            { id: 'default', label: i18n.t('routes.sort_default') || "Default", icon: "swap-vertical-outline" },
                            { id: 'name_asc', label: i18n.t('routes.sort_name_asc') || "Name (A-Z)", icon: "trending-up-outline" },
                            { id: 'name_desc', label: i18n.t('routes.sort_name_desc') || "Name (Z-A)", icon: "trending-down-outline" },
                            { id: 'location_asc', label: i18n.t('routes.sort_location_asc') || "Location (Near to Far)", icon: "location-outline" },
                            { id: 'location_desc', label: i18n.t('routes.sort_location_desc') || "Location (Far to Near)", icon: "location-outline" },
                        ].map((opt) => (
                            <TouchableOpacity
                                key={`sort-${opt.id}`}
                                style={[
                                    styles.chip,
                                    { 
                                        backgroundColor: sortOption === opt.id ? colors.primary : colors.card, 
                                        borderColor: sortOption === opt.id ? colors.primary : colors.border,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        paddingHorizontal: 14,
                                        paddingVertical: 8,
                                    }
                                ]}
                                onPress={() => {
                                    if (opt.id === 'location_asc' || opt.id === 'location_desc') {
                                        handleSortByLocation(opt.id);
                                    } else {
                                        setSortOption(opt.id as any);
                                    }
                                }}
                                disabled={isFetchingLocation && (opt.id === 'location_asc' || opt.id === 'location_desc')}
                            >
                                <Ionicons 
                                    name={opt.icon as any} 
                                    size={16} 
                                    color={sortOption === opt.id ? '#fff' : colors.textSecondary} 
                                    style={{ marginRight: 6 }} 
                                />
                                <Text style={[
                                    styles.chipText,
                                    { color: sortOption === opt.id ? '#fff' : colors.textSecondary, fontWeight: sortOption === opt.id ? '700' : '500' }
                                ]}>
                                    {isFetchingLocation && (opt.id === 'location_asc' || opt.id === 'location_desc') && sortOption === opt.id ? i18n.t('common.please_wait') || 'Please wait...' : opt.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <View style={styles.modalFooter}>
                        <TouchableOpacity 
                            style={[styles.clearBtn, { borderColor: colors.border }]}
                            onPress={() => {
                                setFilterStatus('all');
                                setSortOption('default');
                            }}
                        >
                            <Text style={[styles.clearBtnText, { color: colors.textSecondary, fontWeight: '600' }]}>
                                {i18n.t('orders.clear_filters') || "Clear All"}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                            style={[styles.applyBtn, { backgroundColor: colors.primary }]}
                            onPress={() => setFilterModalVisible(false)}
                        >
                            <Text style={styles.applyBtnText}>{i18n.t('orders.apply_filters') || "Apply Filters"}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </BottomSheetModal>

            {/* Add Customer Modal */}
            <AddCustomerModal
                visible={isAddCustomerModalVisible}
                routeId={currentRoute?.odoo_id}
                onClose={() => setAddCustomerModalVisible(false)}
                onSuccess={handleCustomerAdded}
            />

            {/* Distance Modal */}
            <BottomSheetModal
                visible={isDistanceModalVisible}
                onClose={() => setDistanceModalVisible(false)}
                title={i18n.t('routes.distance_warning_title') || 'Location Too Far'}
            >
                {distanceData && (
                    <View style={{ padding: 20 }}>
                        <Text style={{ color: colors.text, marginBottom: 15, fontSize: 16 }}>
                            {i18n.t('routes.too_far_msg')}
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
                            {i18n.t('routes.move_closer_msg') || 'Please move closer to the customer to start the visit.'}
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

            <CustomAlert
                visible={alertConfig.visible}
                title={alertConfig.title}
                message={alertConfig.message}
                confirmText={alertConfig.confirmText}
                cancelText={alertConfig.cancelText}
                onConfirm={alertConfig.onConfirm}
                onCancel={alertConfig.onCancel}
            />

        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 15,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    addButton: {
        padding: 4,
    },
    routeSelector: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginHorizontal: 20,
        padding: 12,
        borderRadius: 8,
        marginBottom: 10,
    },
    routeSelectorText: {
        fontSize: 16,
        fontWeight: '600',
    },
    content: {
        flex: 1,
    },
    listContent: {
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    customerCard: {
        borderRadius: 12,
        marginBottom: 10,
        borderWidth: 1,
        overflow: 'hidden',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 15,
    },
    customerInfo: {
        flex: 1,
    },
    customerName: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    customerAddress: {
        fontSize: 14,
    },
    customerStatus: {
        marginLeft: 10,
    },
    cardActions: {
        flexDirection: 'row',
        borderTopWidth: 1,
    },
    actionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        gap: 6,
    },
    actionText: {
        fontSize: 14,
        fontWeight: '600',
    },
    emptyText: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 40,
    },
    // Modal Item Styles mainly, modal layout is in component
    modalItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 15,
        borderBottomWidth: 1,
    },
    modalItemText: {
        fontSize: 16,
    },
    input: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        fontSize: 16,
    },
    endVisitButton: {
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    endVisitButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    activeVisitBanner: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#4CAF50', // Fallback, will be overridden by theme
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: -2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    activeVisitInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    activeVisitTitle: {
        color: 'white',
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
    },
    activeVisitCustomer: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    returnButton: {
        backgroundColor: 'white',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    returnButtonText: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    searchContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 8,
        height: 44,
    },
    searchInput: {
        flex: 1,
        paddingHorizontal: 10,
        height: '100%',
    },
    filterBtn: {
        width: 44,
        height: 44,
        borderWidth: 1,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    filterOption: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 15,
        borderWidth: 1,
        borderRadius: 8,
        marginBottom: 10,
    },
    chipContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 8,
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
    }
});
