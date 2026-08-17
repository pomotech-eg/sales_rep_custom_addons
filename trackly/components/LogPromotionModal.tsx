import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView, Platform } from 'react-native';
import { useThemeStore } from '../store/useThemeStore';
import { Ionicons } from '@expo/vector-icons';
import { insertPendingAction } from '../services/database/repositories';
import i18n from '../i18n';

interface PromotionsModalProps {
    visible: boolean;
    customerId: number | string; // odoo_id or local_id
    onClose: () => void;
}

export default function PromotionsModal({ visible, customerId, onClose }: PromotionsModalProps) {
    const { colors } = useThemeStore();
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [selectedType, setSelectedType] = useState<'discount' | 'bogo' | 'gift'>('discount');

    const handleSubmit = async () => {
        if (!note.trim()) {
            Alert.alert(i18n.t('common.error'), i18n.t('promotions.error_note_required') || 'Please enter a description for the promotion.');
            return;
        }

        setLoading(true);
        try {
            await insertPendingAction({
                action_type: 'log_promotion',
                payload: {
                    customer_id: customerId,
                    promotion_type: selectedType,
                    note: note.trim(),
                    date: new Date().toISOString(),
                },
                related_id: String(customerId),
            });

            Alert.alert(
                i18n.t('common.success'),
                i18n.t('promotions.success_message') || 'Promotion logged successfully (offline-first).',
                [{ text: 'OK', onPress: onClose }]
            );
            setNote('');
        } catch (error: any) {
            Alert.alert(i18n.t('common.error'), error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" transparent>
            <View style={styles.overlay}>
                <View style={[styles.container, { backgroundColor: colors.card }]}>
                    <View style={[styles.header, { borderBottomColor: colors.border }]}>
                        <Text style={[styles.title, { color: colors.text }]}>
                            {i18n.t('promotions.title') || 'Log Promotion'}
                        </Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <Ionicons name="close" size={24} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView contentContainerStyle={styles.content}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>
                            {i18n.t('promotions.type_label') || 'Promotion Type'}
                        </Text>
                        <View style={styles.typeContainer}>
                            {(['discount', 'bogo', 'gift'] as const).map((type) => (
                                <TouchableOpacity
                                    key={type}
                                    style={[
                                        styles.typeBtn,
                                        {
                                            borderColor: selectedType === type ? colors.primary : colors.border,
                                            backgroundColor: selectedType === type ? colors.primary + '15' : 'transparent',
                                        }
                                    ]}
                                    onPress={() => setSelectedType(type)}
                                >
                                    <Ionicons
                                        name={type === 'discount' ? 'pricetag' : type === 'bogo' ? 'layers' : 'gift'}
                                        size={20}
                                        color={selectedType === type ? colors.primary : colors.textSecondary}
                                    />
                                    <Text style={[
                                        styles.typeText,
                                        { color: selectedType === type ? colors.primary : colors.textSecondary }
                                    ]}>
                                        {type === 'discount' ? 'Discount' : type === 'bogo' ? 'Buy 1 Get 1' : 'Free Gift'}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={[styles.label, { color: colors.textSecondary }]}>
                            {i18n.t('promotions.details_label') || 'Details / Note'}
                        </Text>
                        <TextInput
                            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                            placeholder={i18n.t('promotions.placeholder') || "e.g., 10% off for new product launch..."}
                            placeholderTextColor={colors.textSecondary}
                            multiline
                            numberOfLines={4}
                            value={note}
                            onChangeText={setNote}
                        />
                    </ScrollView>

                    <View style={[styles.footer, { borderTopColor: colors.border }]}>
                        <TouchableOpacity
                            style={[styles.cancelBtn, { borderColor: colors.border }]}
                            onPress={onClose}
                            disabled={loading}
                        >
                            <Text style={{ color: colors.text }}>{i18n.t('common.cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                            onPress={handleSubmit}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <Text style={styles.submitText}>{i18n.t('common.submit')}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    container: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
    },
    title: { fontSize: 18, fontWeight: 'bold' },
    closeBtn: { padding: 4 },
    content: { padding: 16 },
    label: { fontSize: 14, marginBottom: 8, fontWeight: '600' },
    typeContainer: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 20,
    },
    typeBtn: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        gap: 6,
    },
    typeText: { fontSize: 13, fontWeight: '500' },
    input: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        textAlignVertical: 'top',
        height: 100,
        fontSize: 16,
    },
    footer: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        gap: 12,
        paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    },
    cancelBtn: {
        flex: 1,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitBtn: {
        flex: 1,
        padding: 14,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
});
