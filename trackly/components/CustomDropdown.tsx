import React, { useState, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, Animated,
    ScrollView, StyleProp, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/useThemeStore';

export interface DropdownItem<T = string | number> {
    label: string;
    value: T;
}

interface DropdownProps<T = string | number> {
    items: DropdownItem<T>[];
    selectedValue: T | null;
    onSelect: (value: T) => void;
    placeholder?: string;
    label?: string;
    /** Max visible items before scrolling (default 5) */
    maxVisible?: number;
    style?: StyleProp<ViewStyle>;
    triggerStyle?: StyleProp<ViewStyle>;
    hideBorder?: boolean;
    disabled?: boolean;
    onToggle?: (open: boolean) => void;
    /** 'absolute' (overlay) or 'static' (push content). Default 'absolute' */
    positionMode?: 'absolute' | 'static';
}

const ITEM_HEIGHT = 48;

export function Dropdown<T extends string | number>({
    items,
    selectedValue,
    onSelect,
    placeholder = 'Select…',
    label,
    maxVisible = 5,
    style,
    triggerStyle,
    hideBorder = false,
    disabled = false,
    onToggle,
    positionMode = 'absolute',
}: DropdownProps<T>) {
    const { colors } = useThemeStore();
    const [open, setOpen] = useState(false);
    const rotation = useRef(new Animated.Value(0)).current;

    const toggle = () => {
        if (disabled) return;
        const nextState = !open;
        Animated.spring(rotation, {
            toValue: nextState ? 1 : 0,
            useNativeDriver: true,
            tension: 120,
            friction: 8,
        }).start();
        setOpen(nextState);
        onToggle?.(nextState);
    };

    const handleSelect = (value: T) => {
        Animated.spring(rotation, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 8,
        }).start();
        setOpen(false);
        onToggle?.(false);
        onSelect(value);
    };

    const iconRotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
    const selected = items.find(i => i.value === selectedValue);
    const listHeight = Math.min(items.length, maxVisible) * ITEM_HEIGHT;

    return (
        <View style={[styles.container, open && styles.containerOpen, style]}>
            {label && (
                <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
            )}

            {/* ── Trigger ── */}
            <TouchableOpacity
                activeOpacity={0.8}
                onPress={toggle}
                style={[
                    styles.trigger,
                    {
                        borderColor: open ? colors.primary : colors.border,
                        backgroundColor: colors.card,
                    },
                    hideBorder && { borderWidth: 0 },
                    triggerStyle,
                    disabled && { opacity: 0.5 },
                ]}
            >
                <Text
                    style={[
                        styles.triggerText,
                        { color: selected ? colors.text : colors.textSecondary }
                    ]}
                    numberOfLines={1}
                >
                    {selected?.label ?? placeholder}
                </Text>
                <Animated.View style={{ transform: [{ rotate: iconRotate }] }}>
                    <Ionicons name="chevron-down" size={18} color={open ? colors.primary : colors.textSecondary} />
                </Animated.View>
            </TouchableOpacity>

            {/* ── Options list ── */}
            {open && (
                <View
                    style={[
                        styles.optionsList,
                        {
                            borderColor: colors.primary,
                            backgroundColor: colors.card,
                            maxHeight: listHeight,
                            position: positionMode === 'static' ? 'relative' : 'absolute',
                            top: positionMode === 'static' ? undefined : (label ? 22 + 6 : 0) + 50,
                            marginTop: positionMode === 'static' ? 8 : 0,
                        },
                    ]}
                >
                    <ScrollView
                        bounces={false}
                        showsVerticalScrollIndicator={items.length > maxVisible}
                        nestedScrollEnabled
                    >
                        {items.map((item, idx) => {
                            const isSelected = item.value === selectedValue;
                            const isLast = idx === items.length - 1;
                            return (
                                <TouchableOpacity
                                    key={item.value.toString()}
                                    activeOpacity={0.7}
                                    onPress={() => handleSelect(item.value)}
                                    style={[
                                        styles.option,
                                        { height: ITEM_HEIGHT },
                                        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border + '40' },
                                        isSelected && { backgroundColor: colors.primary + '15' },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.optionText,
                                            { color: isSelected ? colors.primary : colors.text, fontWeight: isSelected ? '700' : '400' },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {item.label}
                                    </Text>
                                    {isSelected && (
                                        <View style={[styles.checkDot, { backgroundColor: colors.primary }]}>
                                            <Ionicons name="checkmark" size={11} color="#fff" />
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>
            )}
        </View>
    );
}

// Keep the old name as an alias so existing usages don't break
export const CustomDropdown = Dropdown;

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        zIndex: 1,
    },
    containerOpen: {
        zIndex: 9999,
    },
    label: {
        fontSize: 12, fontWeight: '600', marginBottom: 6,
        textTransform: 'uppercase', letterSpacing: 0.4,
    },
    trigger: {
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14, height: 50,
        borderWidth: 1.5,
        borderRadius: 14,
        gap: 8,
    },
    triggerText: { fontSize: 14, fontWeight: '500', flex: 1 },
    optionsList: {
        position: 'absolute',
        left: 0,
        right: 0,
        borderWidth: 1.5,
        borderRadius: 14,
        overflow: 'hidden',
        zIndex: 9999,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
    },
    option: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14, gap: 8,
    },
    optionText: { fontSize: 14, flex: 1 },
    checkDot: {
        width: 18, height: 18, borderRadius: 9,
        alignItems: 'center', justifyContent: 'center',
    },
});
