import React, { useState } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/useThemeStore';
import { SPACING } from '../theme';

interface CustomTextInputProps extends TextInputProps {
    icon?: keyof typeof Ionicons.glyphMap;
    showPasswordToggle?: boolean;
}

export const CustomTextInput: React.FC<CustomTextInputProps> = ({
    icon,
    showPasswordToggle,
    secureTextEntry,
    style,
    ...props
}) => {
    const { colors } = useThemeStore();
    // Initialize isPasswordVisible based on secureTextEntry.
    // If secureTextEntry is true, password is NOT visible (hidden).
    // So isPasswordVisible should be false.
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);

    const togglePasswordVisibility = () => {
        setIsPasswordVisible(!isPasswordVisible);
    };

    // If showPasswordToggle is active, we control security with state.
    // If visible -> secureTextEntry should be false.
    // If hidden -> secureTextEntry should be true.
    const isSecure = showPasswordToggle ? !isPasswordVisible : secureTextEntry;

    return (
        <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {icon && (
                <Ionicons
                    name={icon}
                    size={20}
                    color={colors.text}
                    style={styles.icon}
                />
            )}
            <TextInput
                style={[styles.input, { color: colors.text }, style]}
                placeholderTextColor={colors.text + '80'}
                secureTextEntry={isSecure}
                {...props}
            />
            {showPasswordToggle && (
                <TouchableOpacity onPress={togglePasswordVisibility}>
                    <Ionicons
                        name={isPasswordVisible ? "eye-off-outline" : "eye-outline"}
                        size={20}
                        color={colors.text}
                    />
                </TouchableOpacity>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        marginBottom: SPACING.m,
        paddingHorizontal: SPACING.m,
        height: 56,
    },
    icon: {
        marginRight: SPACING.s,
    },
    input: {
        flex: 1,
        height: '100%',
        fontSize: 16,
    },
});
