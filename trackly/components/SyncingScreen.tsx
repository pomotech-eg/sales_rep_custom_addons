import React, { useEffect, useState, useRef } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useOfflineStore } from '../store/useOfflineStore';
import i18n from '@/i18n';
import { SPACING } from '@/theme';
import { Ionicons } from '@expo/vector-icons';

export const SyncingScreen = () => {
    const { colors } = useThemeStore();
    const { syncProgress } = useOfflineStore();
    
    const progressAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(0.85)).current;
    const rotateAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: syncProgress,
            duration: 400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
        }).start();
    }, [syncProgress]);

    // Pulsing backdrop glow animation
    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.15,
                    duration: 2500,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 0.85,
                    duration: 2500,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                })
            ])
        ).start();
    }, []);

    // Rotating loader animation
    useEffect(() => {
        Animated.loop(
            Animated.timing(rotateAnim, {
                toValue: 1,
                duration: 2000,
                easing: Easing.linear,
                useNativeDriver: true,
            })
        ).start();
    }, []);

    const widthInterpolated = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    });

    const rotateInterpolated = rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    // Dynamic sync step messages
    const getStepMessage = () => {
        if (syncProgress < 0.2) {
            return i18n.t('sync.preparing') || 'Preparing local database...';
        } else if (syncProgress < 0.5) {
            return i18n.t('sync.uploading') || 'Uploading pending transactions...';
        } else if (syncProgress < 0.7) {
            return i18n.t('sync.downloading_catalog') || 'Downloading catalog & UoMs...';
        } else if (syncProgress < 0.9) {
            return i18n.t('sync.downloading_prices') || 'Syncing pricelists & partners...';
        } else {
            return i18n.t('sync.finalizing') || 'Finalizing data structures...';
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Glowing background blob */}
            <Animated.View
                style={[
                    styles.glowBlob,
                    {
                        backgroundColor: colors.primary + '20',
                        transform: [{ scale: pulseAnim }],
                    },
                ]}
            />

            <View style={[styles.card, { backgroundColor: colors.card + 'd0', borderColor: colors.border }]}>
                {/* Logo & App title */}
                {/* <View style={styles.brandHeader}>
                    <Animated.View style={{ transform: [{ rotate: rotateInterpolated }] }}>
                        <Ionicons name="sync" size={40} color={colors.primary} />
                    </Animated.View>
                    <Text style={[styles.title, { color: colors.text }]}>Pomo Track</Text>
                </View> */}

                {/* Progress bar container */}
                <View style={styles.progressContainer}>
                    <View style={styles.progressLabelRow}>
                        <Text style={[styles.progressStepLabel, { color: colors.textSecondary }]}>
                            {getStepMessage()}
                        </Text>
                        <Text style={[styles.progressPercent, { color: colors.primary }]}>
                            {Math.round(syncProgress * 100)}%
                        </Text>
                    </View>

                    <View style={[styles.progressBarBackground, { backgroundColor: colors.border + '50' }]}>
                        <Animated.View
                            style={[
                                styles.progressBarFill,
                                {
                                    backgroundColor: colors.primary,
                                    width: widthInterpolated
                                }
                            ]}
                        />
                    </View>
                </View>

                <View style={styles.infoRow}>
                    <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
                    <Text style={[styles.message, { color: colors.text }]}>
                        {i18n.t('common.syncing_data') || 'Syncing Data'}
                    </Text>
                </View>

                <Text style={[styles.submessage, { color: colors.textSecondary }]}>
                    {i18n.t('common.please_wait') || 'Please wait while we sync with the server...'}
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.l,
    },
    glowBlob: {
        position: 'absolute',
        width: 280,
        height: 280,
        borderRadius: 140,
        filter: 'blur(60px)',
        zIndex: 0,
    },
    card: {
        zIndex: 1,
        width: '100%',
        maxWidth: 360,
        borderRadius: 24,
        borderWidth: 1,
        padding: SPACING.xl,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 10,
    },
    brandHeader: {
        alignItems: 'center',
        gap: SPACING.xs,
        marginBottom: SPACING.xl,
    },
    title: {
        fontSize: 26,
        fontWeight: 'bold',
        letterSpacing: 0.5,
        marginTop: SPACING.s,
    },
    progressContainer: {
        width: '100%',
        marginBottom: SPACING.xl,
        gap: SPACING.s,
    },
    progressLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 2,
    },
    progressStepLabel: {
        fontSize: 13,
        fontWeight: '500',
    },
    progressPercent: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    progressBarBackground: {
        width: '100%',
        height: 8,
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 4,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.s,
        marginBottom: SPACING.s,
    },
    spinner: {
        marginRight: 2,
    },
    message: {
        fontSize: 16,
        fontWeight: '600',
    },
    submessage: {
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 18,
    }
});
