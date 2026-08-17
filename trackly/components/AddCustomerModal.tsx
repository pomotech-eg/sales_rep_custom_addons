import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeStore } from '../store/useThemeStore';
import { Ionicons } from '@expo/vector-icons';
import { createLocalPartner, insertPendingAction, getPricelists, getPaymentTerms, createLocalRouteCustomer } from '../services/database/repositories';
import i18n from '../i18n';
import * as Location from 'expo-location';
import OSMMap from './OSMMap';

interface AddCustomerModalProps {
    visible: boolean;
    routeId?: number;
    onClose: () => void;
    onSuccess: (newCustomer: any) => void;
}

export default function AddCustomerModal({ visible, routeId, onClose, onSuccess }: AddCustomerModalProps) {
    const { colors } = useThemeStore();
    const [loading, setLoading] = useState(false);
    const [pricelists, setPricelists] = useState<any[]>([]);
    const [paymentTerms, setPaymentTerms] = useState<any[]>([]);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        mobile: '',
        street: '',
        city: '',
        vat: '',
        property_product_pricelist: null as number | null,
        property_payment_term_id: null as number | null,
        comment: '', // internal notes
    });

    const [mapRegion, setMapRegion] = useState({
        latitude: 30.0444, // Default (Cairo or neutral)
        longitude: 31.2357,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
    });
    // For OSMMap, userLocation is passed separately to show the blue dot, but map center is controlled by region
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [markerCoords, setMarkerCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [isLoadingLocation, setIsLoadingLocation] = useState(false);
    const [scrollEnabled, setScrollEnabled] = useState(true);

    const getCurrentLocation = async () => {
        setIsLoadingLocation(true);
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert(i18n.t('common.error'), i18n.t('common.location_permission_denied') || 'Permission to access location was denied');
            setIsLoadingLocation(false);
            return;
        }

        try {
            let location = await Location.getCurrentPositionAsync({});
            const { latitude, longitude } = location.coords;
            setUserLocation({ latitude, longitude });
            setMapRegion({
                latitude,
                longitude,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
            });
            // Auto-set marker if creating new
            setMarkerCoords({ latitude, longitude });
        } catch (error) {
            console.log("Could not fetch location", error);
        } finally {
            setIsLoadingLocation(false);
        }
    };

    const loadOptions = async () => {
        try {
            const [pl, pt] = await Promise.all([getPricelists(), getPaymentTerms()]);
            setPricelists(pl);
            setPaymentTerms(pt);
            if (pl.length > 0) setFormData(prev => ({ ...prev, property_product_pricelist: Number(pl[0].odoo_id) }));
            if (pt.length > 0) setFormData(prev => ({ ...prev, property_payment_term_id: Number(pt[0].odoo_id) }));
        } catch (err) {
            console.error('Failed to load options:', err);
        }
    };

    useEffect(() => {
        if (visible) {
            loadOptions();
            getCurrentLocation();
        }
    }, [visible]);

    const handleChange = (field: keyof typeof formData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async () => {
        if (!formData.name.trim()) {
            Alert.alert(i18n.t('common.error'), i18n.t('customer.error_name_required') || 'Customer name is required.');
            return;
        }
        if (!formData.phone) {
            Alert.alert(i18n.t('common.error'), i18n.t('customer.error_phone_required') || 'Customer phone is required.');
            return;
        }

        setLoading(true);
        try {
            // 1. Create local partner record
            const localId = await createLocalPartner({
                ...formData,
                latitude: markerCoords?.latitude || null,
                longitude: markerCoords?.longitude || null,
                is_synced: 0,
            });

            let tempRouteCustomerId = null;
            if (routeId) {
                // 1.5 Create local route customer link for immediate display
                tempRouteCustomerId = await createLocalRouteCustomer({
                    route_id: routeId,
                    partner_id: null, // Linked via action payload for backend
                    name: formData.name,
                    address: formData.street,
                    phone: formData.phone,
                    email: formData.email,
                    latitude: markerCoords?.latitude || null,
                    longitude: markerCoords?.longitude || null,
                    state: 'pending',
                    sequence: 999 // Append to end
                });
            }

            // 2. Queue sync action
            await insertPendingAction({
                action_type: 'create_customer',
                payload: {
                    route_id: routeId,
                    customer_data: {
                        ...formData,
                        local_id: localId,
                        latitude: markerCoords?.latitude || null,
                        longitude: markerCoords?.longitude || null,
                    },
                    temp_route_customer_id: tempRouteCustomerId // Pass for cleanup after sync
                },
                related_id: localId,
            });

            Alert.alert(
                i18n.t('common.success'),
                i18n.t('customer.success_message') || 'Customer created locally. Sync will occur when online.',
                [{
                    text: i18n.t('common.ok'), onPress: () => {
                        // Pass the temp route customer ID if available (for routes with customers), 
                        // otherwise fallback to local_id (for standalone customers)
                        onSuccess({
                            ...formData,
                            local_id: tempRouteCustomerId || localId
                        });
                        handleClose();
                    }
                }]
            );
        } catch (error: any) {
            Alert.alert(i18n.t('common.error'), error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        onClose();
        setFormData({
            name: '', email: '', phone: '', mobile: '', street: '', city: '', vat: '',
            property_product_pricelist: null, property_payment_term_id: null, comment: ''
        });
        setMarkerCoords(null);
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
            <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
                    <View style={styles.headerContent}>
                        <Ionicons name="business" size={24} color={colors.primary} />
                        <Text style={[styles.title, { color: colors.text }]}>
                            {i18n.t('customer.add_title') || 'Add New Customer'}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={handleClose} style={[styles.closeBtn, { backgroundColor: colors.background }]}>
                        <Ionicons name="close" size={24} color={colors.textSecondary} />
                    </TouchableOpacity>
                </View>

                <ScrollView
                    contentContainerStyle={styles.content}
                    scrollEnabled={scrollEnabled}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Company Information Section */}
                    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.sectionTitle}>
                            <Ionicons name="business-outline" size={18} color={colors.primary} />
                            <Text style={[styles.sectionTitleText, { color: colors.text }]}>
                                {i18n.t('customer.information') || 'Information'}
                            </Text>
                        </View>

                        <InputField label={i18n.t('customer.name_label') || "Name *"} value={formData.name} onChange={(v: string) => handleChange('name', v)} colors={colors} autoFocus />
                        <InputField label={i18n.t('customer.tax_id_label') || "Tax ID"} value={formData.vat} onChange={(v: string) => handleChange('vat', v)} colors={colors} />
                        <InputField label={i18n.t('customer.address_label') || "Address"} value={formData.street} onChange={(v: string) => handleChange('street', v)} colors={colors} multiline numberOfLines={3} />
                        <InputField label={i18n.t('customer.city_label') || "City"} value={formData.city} onChange={(v: string) => handleChange('city', v)} colors={colors} />
                    </View>

                    {/* Location Section */}
                    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, padding: 0, overflow: 'hidden' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Ionicons name="map-outline" size={18} color={colors.primary} />
                                <Text style={[styles.sectionTitleText, { color: colors.text }]}>
                                    {i18n.t('customer.location') || 'Customer Location'}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={getCurrentLocation} disabled={isLoadingLocation}>
                                {isLoadingLocation ? (
                                    <ActivityIndicator size="small" color={colors.primary} />
                                ) : (
                                    <Ionicons name="locate" size={20} color={colors.primary} />
                                )}
                            </TouchableOpacity>
                        </View>

                        <View style={{ height: 300, position: 'relative' }}>
                            <OSMMap
                                latitude={mapRegion.latitude}
                                longitude={mapRegion.longitude}
                                userLocation={userLocation}
                                isStatic={false}
                                height="100%"
                                onRegionChange={(region) => {
                                    setMapRegion(prev => ({ ...prev, latitude: region.latitude, longitude: region.longitude }));
                                    setMarkerCoords({ latitude: region.latitude, longitude: region.longitude });
                                }}
                                onMapTouchStart={() => setScrollEnabled(false)}
                                onMapTouchEnd={() => setScrollEnabled(true)}
                            />
                            <View style={{ position: 'absolute', top: 10, left: '10%', right: '10%', backgroundColor: 'rgba(255,255,255,0.9)', padding: 8, borderRadius: 20, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 }}>
                                <Text style={{ fontSize: 12, color: '#555' }}>{i18n.t('customer.drag_marker_instruction') || "Drag marker to adjust location"}</Text>
                            </View>
                        </View>
                    </View>

                    {/* Contact Information Section */}
                    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.sectionTitle}>
                            <Ionicons name="call-outline" size={18} color={colors.primary} />
                            <Text style={[styles.sectionTitleText, { color: colors.text }]}>
                                {i18n.t('customer.contact_information') || 'Contact Information'}
                            </Text>
                        </View>
                        <View style={styles.row}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                                <InputField label={i18n.t('customer.phone_label') || "Phone *"} value={formData.phone} onChange={(v: string) => handleChange('phone', v)} colors={colors} keyboardType="phone-pad" />
                            </View>
                            <View style={{ flex: 1, marginLeft: 8 }}>
                                <InputField label={i18n.t('customer.email_label') || "Email"} value={formData.email} onChange={(v: string) => handleChange('email', v)} colors={colors} keyboardType="email-address" />
                            </View>
                        </View>
                        <InputField label={i18n.t('customer.mobile_label') || "Mobile"} value={formData.mobile} onChange={(v: string) => handleChange('mobile', v)} colors={colors} keyboardType="phone-pad" />
                    </View>


                    {/* Business Settings Section */}
                    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.sectionTitle}>
                            <Ionicons name="settings-outline" size={18} color={colors.primary} />
                            <Text style={[styles.sectionTitleText, { color: colors.text }]}>
                                {i18n.t('customer.business_settings') || 'Business Settings'}
                            </Text>
                        </View>

                        {pricelists.length > 0 && (
                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>{i18n.t('customer.pricelist_label') || "Pricelist *"}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
                                    {pricelists.map(pl => (
                                        <TouchableOpacity
                                            key={pl.odoo_id}
                                            style={[
                                                styles.chip,
                                                {
                                                    borderColor: formData.property_product_pricelist === pl.odoo_id ? colors.primary : colors.border,
                                                    backgroundColor: formData.property_product_pricelist === pl.odoo_id ? colors.primary + '15' : 'transparent',
                                                }
                                            ]}
                                            onPress={() => setFormData(p => ({ ...p, property_product_pricelist: Number(pl.odoo_id) }))}
                                        >
                                            <Text style={{
                                                color: formData.property_product_pricelist === pl.odoo_id ? colors.primary : colors.text,
                                                fontWeight: formData.property_product_pricelist === pl.odoo_id ? '600' : '400'
                                            }}>
                                                {pl.name}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </View>
                        )}
                        {paymentTerms.length > 0 && (
                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>{i18n.t('customer.payment_terms') || 'Payment Terms'} *</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
                                    {paymentTerms.map(pt => (
                                        <TouchableOpacity
                                            key={pt.odoo_id}
                                            style={[
                                                styles.chip,
                                                {
                                                    borderColor: formData.property_payment_term_id === pt.odoo_id ? colors.primary : colors.border,
                                                    backgroundColor: formData.property_payment_term_id === pt.odoo_id ? colors.primary + '15' : 'transparent',
                                                }
                                            ]}
                                            onPress={() => setFormData(p => ({ ...p, property_payment_term_id: Number(pt.odoo_id) }))}
                                        >
                                            <Text style={{
                                                color: formData.property_payment_term_id === pt.odoo_id ? colors.primary : colors.text,
                                                fontWeight: formData.property_payment_term_id === pt.odoo_id ? '600' : '400'
                                            }}>
                                                {pt.name}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </View>
                        )}
                    </View>

                    {/* Additional Information Section */}
                    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.sectionTitle}>
                            <Ionicons name="document-text-outline" size={18} color={colors.primary} />
                            <Text style={[styles.sectionTitleText, { color: colors.text }]}>
                                {i18n.t('customer.additional_information') || 'Additional Information'}
                            </Text>
                        </View>
                        <InputField label={i18n.t('customer.internal_notes_label') || "Internal Notes"} value={formData.comment} onChange={(v: string) => handleChange('comment', v)} colors={colors} multiline numberOfLines={4} />
                    </View>

                </ScrollView>

                {/* Footer Actions */}
                <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
                    <TouchableOpacity
                        style={[styles.cancelBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                        onPress={handleClose}
                        disabled={loading}
                    >
                        <Ionicons name="close-circle-outline" size={20} color={colors.textSecondary} />
                        <Text style={{ color: colors.text, marginLeft: 8 }}>{i18n.t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                        onPress={handleSubmit}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <>
                                <Ionicons name="person-add" size={20} color="#fff" />
                                <Text style={styles.submitText}>{i18n.t('customer.add_customer') || 'Add Customer'}</Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </Modal>
    );
}

const InputField = ({ label, value, onChange, colors, keyboardType, autoFocus, multiline, numberOfLines }: any) => (
    <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
        <TextInput
            style={[
                styles.input,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
                multiline && { minHeight: 100, textAlignVertical: 'top' }
            ]}
            value={value}
            onChangeText={onChange}
            placeholderTextColor={colors.textSecondary}
            keyboardType={keyboardType}
            autoFocus={autoFocus}
            multiline={multiline}
            numberOfLines={numberOfLines}
        />
    </View>
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    title: { fontSize: 22, fontWeight: '700' },
    closeBtn: { padding: 8, borderRadius: 20 },
    content: { padding: 20 },

    section: {
        marginBottom: 24,
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
        elevation: 2,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
    },
    sectionTitle: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
    },
    sectionTitleText: {
        fontSize: 18,
        fontWeight: '600',
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },

    inputGroup: { marginBottom: 16 },
    label: { fontSize: 14, marginBottom: 8, fontWeight: '600' },
    input: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
    },
    chipsScroll: { flexDirection: 'row' },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        marginRight: 8,
    },

    footer: {
        flexDirection: 'row',
        padding: 20,
        borderTopWidth: 1,
        gap: 12,
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    },
    cancelBtn: {
        flex: 1,
        flexDirection: 'row',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitBtn: {
        flex: 1,
        flexDirection: 'row',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    submitText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
});
