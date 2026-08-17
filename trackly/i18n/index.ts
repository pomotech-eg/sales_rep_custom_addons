import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18n } from 'i18n-js';
import en from './en.json';
import ar from './ar.json';
import dayjs from 'dayjs';
import 'dayjs/locale/ar';

const i18n = new I18n({
    en,
    ar
});

// Set initial locale based on system or fallback
const locale = getLocales()[0]?.languageCode || 'en';
i18n.locale = locale;
i18n.enableFallback = true;
i18n.defaultLocale = 'en';

// Set dayjs locale
dayjs.locale(locale.startsWith('ar') ? 'ar' : 'en');

export default i18n;

export const isRTL = i18n.locale.startsWith('ar');

export const loadLocale = async (locale: string) => {
    i18n.locale = locale;
    dayjs.locale(locale.startsWith('ar') ? 'ar' : 'en');
    await AsyncStorage.setItem('user-language', locale);
};
