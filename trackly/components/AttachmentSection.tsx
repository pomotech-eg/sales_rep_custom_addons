import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import i18n from '@/i18n';

export interface Attachment {
    name: string;
    uri: string;
    file_size?: string;
}

interface AttachmentSectionProps {
    colors: {
        primary: string;
        card: string;
        border: string;
        text: string;
        textSecondary: string;
        background: string;
        success: string;
        danger: string;
    };
    attachments: Attachment[];
    isUploadingAttachment: boolean;
    onTakeAttachment: () => void;
    onDeleteAttachment: (name: string) => void;
    onPreviewImage: (uri: string) => void;
    disabled?: boolean;
}

export const AttachmentSection: React.FC<AttachmentSectionProps> = ({
    colors,
    attachments,
    isUploadingAttachment,
    onTakeAttachment,
    onDeleteAttachment,
    onPreviewImage,
    disabled = false,
}) => {
    return (
        <View style={{ padding: 16, backgroundColor: colors.card, borderRadius: 16, marginTop: 12, borderWidth: 1, borderColor: colors.border + '40', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border + '20' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="attach-outline" size={16} color={colors.primary} />
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>
                        {i18n.t('order.attachments') || 'Attachments'}
                    </Text>
                    {attachments.length > 0 && (
                        <View style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>{attachments.length}</Text>
                        </View>
                    )}
                </View>
                {isUploadingAttachment ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ padding: 6 }} />
                ) : (
                    !disabled && (
                        <TouchableOpacity 
                            onPress={onTakeAttachment} 
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary + '10', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
                            disabled={isUploadingAttachment}
                        >
                            <Ionicons name="camera-outline" size={16} color={colors.primary} />
                            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 12 }}>{i18n.t('common.add') || 'Add'}</Text>
                        </TouchableOpacity>
                    )
                )}
            </View>
            <View>
                {attachments && attachments.length > 0 ? (
                    attachments.map((attachment, index) => (
                        <View
                            key={index}
                            style={{ 
                                flexDirection: 'row', 
                                alignItems: 'center', 
                                gap: 12, 
                                paddingVertical: 10, 
                                borderBottomWidth: index < attachments.length - 1 ? 1 : 0, 
                                borderBottomColor: colors.border + '15' 
                            }}
                        >
                            <TouchableOpacity
                                onPress={() => onPreviewImage(attachment.uri)}
                                style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 }}
                            >
                                <View style={{ position: 'relative' }}>
                                    <Image
                                        source={{ uri: attachment.uri }}
                                        style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border + '30' }}
                                    />
                                    <View style={{ position: 'absolute', bottom: -2, right: -2, backgroundColor: colors.success, width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="checkmark" size={9} color="#fff" />
                                    </View>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
                                        {attachment.name}
                                    </Text>
                                    <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                                        {attachment.file_size || ''}
                                    </Text>
                                </View>
                                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
                                    <Ionicons name="eye-outline" size={14} color={colors.textSecondary} />
                                </View>
                            </TouchableOpacity>

                            {!disabled && (
                                <TouchableOpacity
                                    onPress={() => onDeleteAttachment(attachment.name)}
                                    style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.danger + '10', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                                </TouchableOpacity>
                            )}
                        </View>
                    ))
                ) : !isUploadingAttachment ? (
                    <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}>
                        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border + '20' }}>
                            <Ionicons name="images-outline" size={20} color={colors.textSecondary} />
                        </View>
                        <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center' }}>
                            {i18n.t('order.no_attachments') || 'No attachments yet'}
                        </Text>
                        {!disabled && (
                            <TouchableOpacity 
                                onPress={onTakeAttachment} 
                                style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, marginTop: 4 }}
                            >
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Capture Photo</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                ) : null}
            </View>
        </View>
    );
};
