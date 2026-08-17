import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Platform,
    StatusBar as RNStatusBar
} from 'react-native';
import { useThemeStore } from '../../../store/useThemeStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import i18n from '../../../i18n';

export default function ReportsMenu() {
    const router = useRouter();
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const { user } = useAuthStore();
    const { colors } = useThemeStore();

    console.log('ReportsMenu User:', JSON.stringify({
        id: user?.user_id,
        name: user?.name,
        access_sales: user?.access_sales_report,
        access_debt: user?.access_customer_debt_report,
        access_collection: user?.access_collection_report,
        access_journal: user?.access_journal_report
    }, null, 2));

    const reportsList = [
        {
            id: 'sales',
            title: i18n.t('reports.sales_report'),
            icon: 'cart-outline',
            route: '/(drawer)/reports/sales',
            accessKey: 'access_sales_report'
        },
        {
            id: 'customer_debt',
            title: i18n.t('reports.debt_report'),
            icon: 'people-outline',
            route: '/(drawer)/reports/debt',
            accessKey: 'access_customer_debt_report'
        },
        {
            id: 'collection',
            title: i18n.t('reports.collection_report'),
            icon: 'cash-outline',
            route: '/(drawer)/reports/collection',
            accessKey: 'access_collection_report'
        },
        {
            id: 'journal',
            title: i18n.t('reports.journal_report') || 'Journal Transaction Report',
            icon: 'journal-outline',
            route: '/(drawer)/reports/journal',
            accessKey: 'access_journal_report'
        },
    ].filter(report => {
        const hasAccess = !!user?.[report.accessKey as keyof typeof user];
        console.log(`Report ${report.id} access (${report.accessKey}): ${hasAccess}`);
        return hasAccess;
    });

    return (
        <SafeAreaProvider style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => navigation.openDrawer()} style={{ marginRight: 12 }}>
                        <Ionicons name="menu-outline" size={28} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>{i18n.t('reports.title')}</Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {reportsList.map((report) => (
                    <TouchableOpacity
                        key={report.id}
                        style={[styles.reportItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => {
                            console.log(`Navigating to: ${report.route}`);
                            router.push(report.route as any);
                        }}
                    >
                        <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
                            <Ionicons name={report.icon as any} size={24} color={colors.primary} />
                        </View>
                        <View style={styles.textContainer}>
                            <Text style={[styles.reportTitle, { color: colors.text }]}>{report.title}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 15,
        borderBottomWidth: 1,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    content: {
        padding: 20,
        gap: 15,
    },
    reportItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        gap: 15,
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    textContainer: {
        flex: 1,
    },
    reportTitle: {
        fontSize: 16,
        fontWeight: '600',
    }
});
