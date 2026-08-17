import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DARK_COLORS, LIGHT_COLORS, ThemeColors } from '../theme';
import i18n from '../i18n';
import { I18nManager } from 'react-native';

interface ThemeState {
    mode: 'light' | 'dark';
    colors: ThemeColors;
    toggleTheme: () => void;
    setTheme: (mode: 'light' | 'dark') => void;
    locale: 'en' | 'ar';
    setLocale: (locale: 'en' | 'ar') => void;
}

export const useThemeStore = create<ThemeState>()(
    persist(
        (set, get) => ({
            mode: 'dark',
            colors: DARK_COLORS,
            toggleTheme: () => {
                const newMode = get().mode === 'dark' ? 'light' : 'dark';
                set({
                    mode: newMode,
                    colors: newMode === 'dark' ? DARK_COLORS : LIGHT_COLORS,
                });
            },
            setTheme: (mode) => {
                set({
                    mode,
                    colors: mode === 'dark' ? DARK_COLORS : LIGHT_COLORS,
                });
            },
            locale: 'en',
            setLocale: (locale) => {
                i18n.locale = locale;
                const isRTL = locale === 'ar';
                if (I18nManager.isRTL !== isRTL) {
                    I18nManager.allowRTL(isRTL);
                    I18nManager.forceRTL(isRTL);
                }
                set({ locale });
            },
        }),
        {
            name: 'theme-storage',
            storage: createJSONStorage(() => AsyncStorage),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    i18n.locale = state.locale;
                    const isRTL = state.locale === 'ar';
                    if (I18nManager.isRTL !== isRTL) {
                        I18nManager.allowRTL(isRTL);
                        I18nManager.forceRTL(isRTL);
                    }
                }
            }
        }
    )
);
