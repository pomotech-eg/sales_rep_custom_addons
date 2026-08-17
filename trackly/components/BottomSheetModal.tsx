import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    Animated,
    PanResponder,
    Dimensions,
    TouchableWithoutFeedback,
    Keyboard,
    Platform,
    LayoutChangeEvent,
    ScrollView,
} from 'react-native';
import { useThemeStore } from '../store/useThemeStore';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface BottomSheetModalProps {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    title?: string;
    scrollable?: boolean;
}

export default function BottomSheetModal({
    visible,
    onClose,
    children,
    title,
    scrollable = true,
}: BottomSheetModalProps) {
    const { colors } = useThemeStore();

    const [contentHeight, setContentHeight] = useState(0);
    const [isLayoutReady, setIsLayoutReady] = useState(false);

    const panY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;
    // Tracks how far up to slide the sheet when keyboard is open
    const keyboardOffset = useRef(new Animated.Value(0)).current;

    // ── Keyboard listeners ──────────────────────────────────────────────────
    // Instead of KeyboardAvoidingView (which causes height corruption inside
    // Modals), we listen to keyboard events and translateY the sheet up by
    // the exact keyboard height, then back to 0 when the keyboard hides.
    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSub = Keyboard.addListener(showEvent, (e) => {
            Animated.timing(keyboardOffset, {
                toValue: -e.endCoordinates.height,
                duration: e.duration ?? 250,
                useNativeDriver: true,
            }).start();
        });

        const hideSub = Keyboard.addListener(hideEvent, (e) => {
            Animated.timing(keyboardOffset, {
                toValue: 0,
                duration: (e as any).duration ?? 200,
                useNativeDriver: true,
            }).start();
        });

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    // ── Drag to dismiss ─────────────────────────────────────────────────────
    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 5,
            onPanResponderGrant: () => { panY.extractOffset(); },
            onPanResponderMove: (_, gs) => {
                panY.setValue(gs.dy > 0 ? gs.dy : gs.dy * 0.2);
            },
            onPanResponderRelease: (_, gs) => {
                panY.flattenOffset();
                if (gs.dy > 100 || gs.vy > 0.5) {
                    close();
                } else {
                    Animated.spring(panY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
                }
            },
        })
    ).current;

    // ── Open / close animations ─────────────────────────────────────────────
    useEffect(() => {
        if (visible && isLayoutReady) open();
    }, [visible, isLayoutReady]);

    // Only capture height once — keyboard open/close re-triggers onLayout
    // with a smaller value which permanently corrupts the animation target.
    const onLayout = (event: LayoutChangeEvent) => {
        if (isLayoutReady) return;
        const { height } = event.nativeEvent.layout;
        if (height > 0) {
            setContentHeight(height);
            setIsLayoutReady(true);
        }
    };

    const open = () => {
        panY.setValue(contentHeight || SCREEN_HEIGHT);
        Animated.parallel([
            Animated.timing(backdropOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.spring(panY, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 12 }),
        ]).start();
    };

    const close = () => {
        Keyboard.dismiss();
        Animated.parallel([
            Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
            Animated.timing(panY, { toValue: contentHeight || SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
        ]).start(() => onClose());
    };

    if (!visible) return null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={close}
            statusBarTranslucent
        >
            <View style={styles.overlay}>
                <TouchableWithoutFeedback onPress={close}>
                    <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
                </TouchableWithoutFeedback>

                <Animated.View
                    onLayout={onLayout}
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: colors.card,
                            transform: [
                                { translateY: panY },
                                { translateY: keyboardOffset },
                            ],
                        },
                    ]}
                >
                    {/* Drag handle area captures gestures for dismissing */}
                    <View style={styles.handleWrapper} {...panResponder.panHandlers}>
                        <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    </View>

                    <View style={styles.content}>
                        {title && (
                            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                        )}
                        {scrollable ? (
                            <ScrollView 
                                style={{ maxHeight: SCREEN_HEIGHT * 0.75 }}
                                showsVerticalScrollIndicator={false}
                            >
                                 {children}
                            </ScrollView>
                        ) : (
                            <View style={{ maxHeight: SCREEN_HEIGHT * 0.75 }}>
                                 {children}
                            </View>
                        )}
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    sheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: 30,
        width: '100%',
        maxHeight: '90%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    handleWrapper: {
        alignItems: 'center',
        paddingVertical: 10,
    },
    handle: {
        width: 40,
        height: 5,
        borderRadius: 2.5,
    },
    content: {
        paddingHorizontal: 20,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 15,
        textAlign: 'center',
    },
});
