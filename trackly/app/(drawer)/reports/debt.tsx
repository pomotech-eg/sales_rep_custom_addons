import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    Platform,
    StatusBar as RNStatusBar,
    Alert
} from 'react-native';
import { useThemeStore } from '../../../store/useThemeStore';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import i18n from '../../../i18n';
import { reportService } from '../../../services/reportService';

interface DebtRecord {
    id: number;
    customer: string;
    amount_due: number;
    currency_symbol: string;
}

interface DebtSummary {
    total_debt: number;
    currency_symbol: string;
}

export default function CustomerDebtReport() {
    const router = useRouter();
    const { colors } = useThemeStore();
    
    const [loading, setLoading] = useState(false);
    const [reportData, setReportData] = useState<DebtRecord[]>([]);
    const [summary, setSummary] = useState<DebtSummary | null>(null);

    const fetchReport = async () => {
        setLoading(true);
        try {
            const data = await reportService.getCustomerDebtReport();
            setReportData(data.data);
            setSummary(data.summary);
        } catch (error: any) {
            console.error('Fetch Debt Report Error:', error);
            Alert.alert(i18n.t('common.error'), error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, []);

    const renderDebtItem = ({ item }: { item: DebtRecord }) => (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
                <Text style={[styles.customerName, { color: colors.text }]}>{item.customer}</Text>
                <Text style={[styles.amountValue, { color: colors.danger, fontWeight: 'bold' }]}>
                    {item.currency_symbol}{item.amount_due.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
            </View>
        </View>
    );

    return (
        <SafeAreaProvider style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => router.replace('/(drawer)/reports')} style={{ marginRight: 12 }}>
                        <Ionicons name="arrow-back" size={28} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>{i18n.t('reports.debt_report')}</Text>
                </View>
                <TouchableOpacity onPress={fetchReport} disabled={loading}>
                    {loading ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                        <Ionicons name="refresh" size={24} color={colors.primary} />
                    )}
                </TouchableOpacity>
            </View>

            <FlatList
                data={reportData}
                renderItem={renderDebtItem}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    !loading ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="receipt-outline" size={64} color={colors.subtext} />
                            <Text style={[styles.emptyText, { color: colors.subtext }]}>{i18n.t('reports.no_data')}</Text>
                        </View>
                    ) : null
                }
            />

            {summary && (
                <View style={[styles.summaryContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                    <View style={styles.summaryRow}>
                        <Text style={[styles.totalLabel, { color: colors.text }]}>{i18n.t('reports.total_debt')}</Text>
                        <Text style={[styles.totalValue, { color: colors.danger }]}>
                            {summary.currency_symbol}{summary.total_debt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                    </View>
                </View>
            )}
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
    listContent: {
        padding: 15,
        paddingBottom: 20,
    },
    card: {
        borderRadius: 12,
        padding: 18,
        marginBottom: 10,
        borderWidth: 1,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    customerName: {
        fontSize: 16,
        fontWeight: '600',
        flex: 1,
        marginRight: 10,
    },
    amountValue: {
        fontSize: 18,
    },
    summaryContainer: {
        padding: 20,
        paddingBottom: Platform.OS === 'ios' ? 40 : 25,
        borderTopWidth: 1,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 10,
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    totalLabel: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    totalValue: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
        gap: 15,
    },
    emptyText: {
        fontSize: 16,
    }
});
