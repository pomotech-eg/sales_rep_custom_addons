import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Dimensions, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/useAuthStore';
import { SPACING } from '@/theme';
import { useThemeStore } from '@/store/useThemeStore';
import { loginService } from '@/services/auth/loginService';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { CustomDropdown } from '@/components/CustomDropdown';
import { CustomTextInput } from '@/components/CustomTextInput';
import { Ionicons } from '@expo/vector-icons';
import { setApiBaseUrl } from '@/services/apiClient';
import { SafeAreaView } from 'react-native-safe-area-context';
// import { EXPO_PUBLIC_BASE_URL } from '@env';
import i18n from '@/i18n';
import Checkbox from 'expo-checkbox';
import { storage } from '@/utils/storage';

import { CustomAlert } from '@/components/CustomAlert';
import { useToast } from '@/context/ToastContext';

const { width } = Dimensions.get('window');

export default function LoginScreen() {
    const router = useRouter();
    const { login, isAuthenticated, subscriptionError, setSubscriptionError } = useAuthStore();
    const { colors, mode, toggleTheme } = useThemeStore();

    const [protocol, setProtocol] = useState('https');
    const [url, setUrl] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [savedCredentials, setSavedCredentials] = useState<{ url: string, email: string, password?: string | null } | null>(null);
    const [loading, setLoading] = useState(false);
    const [language, setLanguage] = useState('en');

    // Alert State
    const [alertConfig, setAlertConfig] = useState({
        visible: false,
        title: '',
        message: '',
        confirmText: '',
        cancelText: '',
        onConfirm: () => { },
        onCancel: undefined as (() => void) | undefined,
    });

    // Toast Hook
    const { showToast } = useToast();

    const showAlert = (title: string, message: string, onConfirm?: () => void, confirmText?: string) => {
        setAlertConfig({
            visible: true,
            title,
            message,
            onConfirm: () => {
                setAlertConfig(prev => ({ ...prev, visible: false }));
                if (onConfirm) onConfirm();
            },
            onCancel: undefined,
            confirmText: confirmText || 'OK',
            cancelText: '',
        });
    };

    useEffect(() => {
        const loadCredentials = async () => {
            try {
                const savedUrl = await storage.getItem('saved_url');
                const savedEmail = await storage.getItem('saved_email');
                const savedPassword = await storage.getItem('saved_password');

                if (savedUrl && savedEmail) {
                    setSavedCredentials({
                        url: savedUrl,
                        email: savedEmail,
                        password: savedPassword
                    });
                }
            } catch (error) {
                console.error('Error loading saved credentials:', error);
            }
        };

        loadCredentials();
    }, []);

    useEffect(() => {
        if (isAuthenticated) {
            router.replace('/');
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (subscriptionError) {
            showAlert(
                i18n.t('auth.subscription_expired'),
                i18n.t('auth.subscription_expired_msg'),
                () => setSubscriptionError(false)
            );
        }
    }, [subscriptionError]);

    const handleLogin = async () => {
        if (!url || !email || !password) {
            showToast(i18n.t('auth.fill_all_fields'), 'error');
            return;
        }

        let formattedUrl = url.trim();
        formattedUrl = formattedUrl.replace(/^https?:\/\//, '');
        formattedUrl = formattedUrl.replace(/\/$/, "");

        const fullUrl = `${protocol}://${formattedUrl}`;

        setLoading(true);

        try {
            console.log('Attempting to login with URL:', fullUrl);

            // Important: Authenticate against the central contract server, not the tenant URL
            setApiBaseUrl(process.env.EXPO_PUBLIC_BASE_URL);

            // console.log('Base URL:', EXPO_PUBLIC_BASE_URL);

            const result = await loginService.authenticate(fullUrl, email, password);

            if (result.success && result.data) {
                const { access_token, token_expiration, database_name, database_user, database_password } = result.data;
                // console.log('Login success:', result.data);

                // Step 2: Provision the token to the tenant server locally
                console.log('Provisioning token to tenant...');
                const provisionResult = await loginService.provisionToken(
                    fullUrl,
                    database_name,
                    database_user,
                    database_password,
                    access_token,
                    email
                );
                const finalToken = provisionResult.access_token || access_token;

                if (!provisionResult.success) {
                    console.warn('Token provisioning failed, but continuing login:', provisionResult.message);
                }

                // Set the API base URL to the tenant instance for all future requests
                setApiBaseUrl(fullUrl);

                await login(result.data, finalToken, token_expiration, fullUrl);

                if (rememberMe) {
                    await storage.setItem('saved_url', fullUrl);
                    await storage.setItem('saved_email', email);
                    await storage.setItem('saved_password', password);
                } else {
                    await storage.deleteItem('saved_url');
                    await storage.deleteItem('saved_email');
                    await storage.deleteItem('saved_password');
                }

                router.replace('/');
            } else {
                showAlert(i18n.t('auth.login_failed'), result.message || i18n.t('auth.invalid_credentials'));
            }

        } catch (error: any) {
            console.error('Login error:', error);
            if (error.message?.includes('Subscription expired')) {
                showAlert(i18n.t('auth.subscription_expired'), i18n.t('auth.subscription_expired_msg'));
            } else {
                showAlert(i18n.t('auth.connection_error'), i18n.t('auth.connection_error_desc'));
            }
        } finally {
            setLoading(false);
        }
    };

    const toggleLanguage = () => {
        setLanguage(prev => prev === 'en' ? 'ar' : 'en');
    };

    return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <KeyboardAvoidingView
                style={{ flex: 1, backgroundColor: colors.background }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
            >
                <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
                    <View style={styles.header}>
                        <TouchableOpacity onPress={toggleLanguage} style={styles.languageButton}>
                            <Text style={[styles.languageText, { color: colors.text }]}>{language === 'en' ? 'العربية' : 'English'}</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView
                        style={{ flex: 1, backgroundColor: colors.background }}
                        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.content}>
                            <View>
                                <Text style={[styles.title, { color: colors.primary }]}>Pomo Track</Text>
                                <Text style={[styles.subtitle, { color: colors.text }]}>{i18n.t('auth.sign_in_continue')}</Text>
                            </View>

                            <View style={styles.form}>
                                <View style={[styles.urlContainer, { borderColor: colors.border, backgroundColor: colors.card, height: 56 }]}>
                                    <View style={{ width: 110, height: 54, borderRightWidth: 1, borderColor: colors.border, borderTopLeftRadius: 11, borderBottomLeftRadius: 11, zIndex: 1 }}>
                                        <CustomDropdown
                                            selectedValue={protocol}
                                            onSelect={(itemValue) => setProtocol(itemValue as string)}
                                            items={[
                                                { label: "https://", value: "https" },
                                                { label: "http://", value: "http" }
                                            ]}
                                            hideBorder
                                            style={{ height: '100%' }}
                                            triggerStyle={{ height: '100%', borderRadius: 0, paddingHorizontal: 10 }}
                                        />
                                    </View>
                                    <TextInput
                                        style={[styles.input, { color: colors.text, borderColor: colors.border, paddingLeft: SPACING.m, height: 54 }]}
                                        placeholder={i18n.t('common.odoo_instance_placeholder')}
                                        placeholderTextColor={colors.text + '80'}
                                        value={url}
                                        onChangeText={(text) => {
                                            if (text.toLowerCase().startsWith('http://')) {
                                                setProtocol('http');
                                                setUrl(text.substring(7));
                                            } else if (text.toLowerCase().startsWith('https://')) {
                                                setProtocol('https');
                                                setUrl(text.substring(8));
                                            } else {
                                                setUrl(text);
                                            }
                                        }}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                </View>
                                {savedCredentials && url.length > 0 && savedCredentials.url.replace(/^https?:\/\//, '').toLowerCase().includes(url.toLowerCase()) && savedCredentials.url.replace(/^https?:\/\//, '').toLowerCase() !== url.toLowerCase() && (
                                    <TouchableOpacity
                                        style={[styles.suggestionItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                                        onPress={() => {
                                            if (savedCredentials.url.startsWith('https://')) {
                                                setProtocol('https');
                                                setUrl(savedCredentials.url.replace('https://', ''));
                                            } else if (savedCredentials.url.startsWith('http://')) {
                                                setProtocol('http');
                                                setUrl(savedCredentials.url.replace('http://', ''));
                                            } else {
                                                setUrl(savedCredentials.url);
                                            }
                                            setEmail(savedCredentials.email);
                                            if (savedCredentials.password) setPassword(savedCredentials.password);
                                            setRememberMe(true);
                                        }}
                                    >
                                        <View>
                                            <Text style={[styles.suggestionText, { color: colors.text }]}>{savedCredentials.url.replace(/^https?:\/\//, '')}</Text>
                                            <Text style={[styles.suggestionSubText, { color: colors.text + '80' }]}>{i18n.t('auth.use_saved_url')}</Text>
                                        </View>
                                        <Ionicons name="log-in-outline" size={20} color={colors.primary} />
                                    </TouchableOpacity>
                                )}

                                <CustomTextInput
                                    icon="mail-outline"
                                    placeholder={i18n.t('auth.email_placeholder')}
                                    value={email}
                                    onChangeText={setEmail}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                />

                                {savedCredentials && email.length > 0 && savedCredentials.email.toLowerCase().startsWith(email.toLowerCase()) && email !== savedCredentials.email && (
                                    <TouchableOpacity
                                        style={[styles.suggestionItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                                        onPress={() => {
                                            if (savedCredentials.url.startsWith('https://')) {
                                                setProtocol('https');
                                                setUrl(savedCredentials.url.replace('https://', ''));
                                            } else if (savedCredentials.url.startsWith('http://')) {
                                                setProtocol('http');
                                                setUrl(savedCredentials.url.replace('http://', ''));
                                            } else {
                                                setUrl(savedCredentials.url);
                                            }
                                            setEmail(savedCredentials.email);
                                            if (savedCredentials.password) setPassword(savedCredentials.password);
                                            setRememberMe(true);
                                        }}
                                    >
                                        <View>
                                            <Text style={[styles.suggestionText, { color: colors.text }]}>{savedCredentials.email}</Text>
                                            <Text style={[styles.suggestionSubText, { color: colors.text + '80' }]}>{i18n.t('auth.use_saved_login')}</Text>
                                        </View>
                                        <Ionicons name="log-in-outline" size={20} color={colors.primary} />
                                    </TouchableOpacity>
                                )}

                                <CustomTextInput
                                    icon="lock-closed-outline"
                                    placeholder={i18n.t('auth.password_placeholder')}
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry={true}
                                    showPasswordToggle={true}
                                />


                                {/* <TouchableOpacity
                                style={[styles.loginButton, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginTop: SPACING.s, marginBottom: SPACING.s }]}
                                onPress={async () => {
                                    const fullUrl = BASE_URL;

                                    setLoading(true);
                                    setApiBaseUrl(fullUrl);
                                    const result = await loginService.checkHealth(fullUrl);
                                    setLoading(false);

                                    if (result.success) {
                                        showToast(i18n.t('auth.connection_success'), 'success');
                                    } else {
                                        showAlert(i18n.t('auth.connection_failed'), result.message || i18n.t('auth.connection_error_desc'));
                                    }
                                }}
                                disabled={loading}
                            >
                                <Text style={[styles.loginButtonText, { color: colors.text }]}>{i18n.t('auth.test_connection')}</Text>
                            </TouchableOpacity> */}

                                <View style={styles.checkboxContainer}>
                                    <Checkbox
                                        style={styles.checkbox}
                                        value={rememberMe}
                                        onValueChange={setRememberMe}
                                        color={rememberMe ? colors.primary : undefined}
                                    />
                                    <TouchableOpacity onPress={() => setRememberMe(!rememberMe)}>
                                        <Text style={[styles.checkboxLabel, { color: colors.text }]}>{i18n.t('auth.remember_me')}</Text>
                                    </TouchableOpacity>
                                </View>

                                <TouchableOpacity
                                    style={[styles.loginButton, { backgroundColor: colors.primary }]}
                                    onPress={handleLogin}
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <ActivityIndicator color="#fff" />
                                    ) : (
                                        <Text style={styles.loginButtonText}>{i18n.t('auth.login_button')}</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    </ScrollView>
                </SafeAreaView>
            </KeyboardAvoidingView>

            <CustomAlert
                visible={alertConfig.visible}
                title={alertConfig.title}
                message={alertConfig.message}
                onConfirm={alertConfig.onConfirm}
                onCancel={alertConfig.onCancel}
                confirmText={alertConfig.confirmText}
                cancelText={alertConfig.cancelText}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: SPACING.l,
    },
    safeArea: {
        flex: 1,
    },
    header: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: SPACING.l,
        paddingTop: SPACING.m,
        marginBottom: SPACING.s,
    },
    iconButton: {
        padding: SPACING.s,
    },
    languageButton: {
        padding: SPACING.s,
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 8,
    },
    languageText: {
        fontWeight: 'bold',
    },
    content: {
        width: '100%',
        paddingHorizontal: SPACING.l,
        paddingBottom: SPACING.xl,
    },
    title: {
        fontSize: 42,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: SPACING.s,
    },
    subtitle: {
        fontSize: 18,
        textAlign: 'center',
        marginBottom: SPACING.xl * 2,
        opacity: 0.8,
    },
    form: {
        width: '100%',
        maxWidth: 400,
    },
    urlContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        marginBottom: SPACING.m,
        height: 56,
        zIndex: 10, // Higher zIndex to ensure dropdown overlays contents below
    },
    inputIcon: {
        marginRight: SPACING.s,
    },
    input: {
        flex: 1,
        height: '100%',
        fontSize: 16,
    },
    loginButton: {
        height: 56,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: SPACING.m,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.30,
        shadowRadius: 4.65,
        elevation: 8,
    },
    loginButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.m,
        marginTop: SPACING.s,
    },
    checkbox: {
        marginRight: SPACING.s,
    },
    checkboxLabel: {
        fontSize: 16,
    },
    suggestionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: SPACING.m,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: SPACING.m,
        marginTop: -SPACING.s,
    },
    suggestionText: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    suggestionSubText: {
        fontSize: 12,
    },
});
