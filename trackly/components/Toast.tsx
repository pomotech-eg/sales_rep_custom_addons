import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, Dimensions } from 'react-native';
import Animated, {
    FadeInUp,
    FadeInDown,
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/useThemeStore';

export type ToastType = 'success' | 'error' | 'info';
export type ToastPosition = 'top' | 'bottom';

const SCREEN_WIDTH = Dimensions.get('window').width;

export interface ToastOptions {
    position?: ToastPosition;
    duration?: number;
    action?: {
        label: string;
        onPress: () => void;
    };
}

interface ToastProps {
    message: string;
    type: ToastType;
    options?: ToastOptions;
    onDismiss?: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, options, onDismiss }) => {
    const { colors } = useThemeStore();
    const position = options?.position || 'top';
    const duration = options?.duration || 3000;

    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const opacity = useSharedValue(1);

    useEffect(() => {
        const timer = setTimeout(() => {
            // Auto dismiss animation (Fade up/down)
            translateY.value = withTiming(position === 'top' ? -50 : 50, { duration: 300 });
            opacity.value = withTiming(0, { duration: 300 }, (finished) => {
                if (finished && onDismiss) {
                    runOnJS(onDismiss)();
                }
            });
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, position, onDismiss]);

    const handleDismissSwipe = () => {
        'worklet';
        if (onDismiss) {
            runOnJS(onDismiss)();
        }
    };

    const pan = Gesture.Pan()
        .onUpdate((event) => {
            translateX.value = event.translationX;
        })
        .onEnd((event) => {
            if (Math.abs(event.translationX) > SCREEN_WIDTH * 0.25) {
                // Swipe threshold met - dismiss horizontally
                translateX.value = withTiming(
                    event.translationX > 0 ? SCREEN_WIDTH : -SCREEN_WIDTH,
                    { duration: 200 },
                    () => handleDismissSwipe()
                );
                opacity.value = withTiming(0, { duration: 200 });
            } else {
                // Spring back
                translateX.value = withSpring(0);
            }
        });

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value }
        ],
        opacity: opacity.value,
    }));

    const getIconName = () => {
        switch (type) {
            case 'success': return 'checkmark-circle';
            case 'error': return 'alert-circle';
            case 'info': return 'information-circle';
            default: return 'information-circle';
        }
    };

    const getBackgroundColor = () => {
        switch (type) {
            case 'success': return '#4CAF50';
            case 'error': return '#F44336';
            case 'info': return '#2196F3';
            default: return '#2196F3';
        }
    };

    const enteringAnimation = position === 'top' ? FadeInUp.springify() : FadeInDown.springify();

    return (
        <Animated.View
            entering={enteringAnimation}
            style={[
                styles.wrapper,
                position === 'top' ? styles.top : styles.bottom,
            ]}
        >
            <GestureDetector gesture={pan}>
                <Animated.View
                    style={[
                        styles.container,
                        animatedStyle,
                        { backgroundColor: getBackgroundColor() }
                    ]}
                >
                    <Ionicons name={getIconName()} size={24} color="#FFF" style={styles.icon} />
                    <Text style={styles.message}>{message}</Text>

                    {options?.action && (
                        <TouchableOpacity onPress={options?.action.onPress} style={styles.actionButton}>
                            <Text style={styles.actionText}>{options.action.label}</Text>
                        </TouchableOpacity>
                    )}
                </Animated.View>
            </GestureDetector>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        position: 'absolute',
        left: 20,
        right: 20,
        zIndex: 9999,
    },
    container: {
        padding: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4.65,
        elevation: 8,
    },
    top: {
        top: 60,
    },
    bottom: {
        bottom: 40,
    },
    icon: {
        marginRight: 12,
    },
    message: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
        flex: 1,
        marginRight: 8,
    },
    actionButton: {
        marginLeft: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderRadius: 4,
    },
    actionText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 14,
    },
});
