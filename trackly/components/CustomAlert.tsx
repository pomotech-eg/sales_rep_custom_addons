import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useThemeStore } from '../store/useThemeStore';
import i18n from '../i18n';

interface CustomAlertProps {
    visible: boolean;
    title: string;
    message: string;
    icon?: React.ReactNode;
    onConfirm: () => void;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: string;
    cancelColor?: string;
}

export const CustomAlert: React.FC<CustomAlertProps> = ({
    visible,
    title,
    message,
    icon,
    onConfirm,
    onCancel,
    confirmText,
    cancelText,
    confirmColor,
    cancelColor,
}) => {
    const { colors } = useThemeStore();

    const finalConfirmText = confirmText || i18n.t('common.ok');
    const finalCancelText = cancelText || i18n.t('common.cancel');

    if (!visible) return null;

    return (
        <Modal transparent animationType="fade" visible={visible}>
            <View style={styles.overlay}>
                <View style={[styles.alertBox, { backgroundColor: colors.card }]}>
                    {icon && (
                        <View style={styles.iconContainer}>
                            {icon}
                        </View>
                    )}
                    <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                    <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

                    <View style={styles.buttonContainer}>
                        {onCancel && (
                            <TouchableOpacity onPress={onCancel} style={styles.button}>
                                <Text style={[styles.buttonText, { color: cancelColor || colors.textSecondary, fontWeight: 'bold' }]}>
                                    {finalCancelText}
                                </Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={onConfirm} style={[styles.button, !onCancel && { width: '100%' }]}>
                            <Text style={[styles.buttonText, { color: confirmColor || colors.primary, fontWeight: 'bold' }]}>
                                {finalConfirmText}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    alertBox: {
        width: '80%',
        padding: 24,
        borderRadius: 16,
        alignItems: 'center',
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    iconContainer: {
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 8,
        textAlign: 'center',
    },
    message: {
        fontSize: 16,
        marginBottom: 24,
        lineHeight: 22,
        textAlign: 'center',
    },
    buttonContainer: {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'center',
        gap: 24,
    },
    button: {
        width: '50%',
        paddingVertical: 10,
        paddingHorizontal: 20,
    },
    buttonText: {
        fontSize: 16,
        textAlign: 'center',
    },
});
