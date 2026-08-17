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
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import { reportService, SalesReportOrder, SalesReportSummary } from '../../../services/reportService';

export default function SalesReport() {
    const router = useRouter();
    const { colors } = useThemeStore();
    
    const [dateFrom, setDateFrom] = useState(dayjs().startOf('month').toDate());
    const [dateTo, setDateTo] = useState(new Date());
    const [loading, setLoading] = useState(false);
    const [reportData, setReportData] = useState<SalesReportOrder[]>([]);
    const [summary, setSummary] = useState<SalesReportSummary | null>(null);

    const fetchReport = async () => {
        setLoading(true);
        try {
            const data = await reportService.getSalesReport(
                dayjs(dateFrom).format('YYYY-MM-DD'),
                dayjs(dateTo).format('YYYY-MM-DD')
            );
            setReportData(data.orders);
            setSummary(data.summary);
        } catch (error: any) {
            Alert.alert(i18n.t('common.error'), error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, []);

    const showDatePicker = (type: 'from' | 'to') => {
        const value = type === 'from' ? dateFrom : dateTo;
        
        if (Platform.OS === 'android') {
            DateTimePickerAndroid.open({
                value,
                onChange: (event, selectedDate) => {
                    if (event.type === 'set' && selectedDate) {
                        if (type === 'from') setDateFrom(selectedDate);
                        else setDateTo(selectedDate);
                    }
                },
                mode: 'date',
            });
        }
    };

    const renderOrderItem = ({ item }: { item: SalesReportOrder }) => (
        <View style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.orderHeader}>
                <Text style={[styles.orderName, { color: colors.text }]}>{item.name}</Text>
                <Text style={[styles.orderDate, { color: colors.subtext }]}>{item.date}</Text>
            </View>
            <Text style={[styles.customerName, { color: colors.textSecondary }]}>{item.customer}</Text>
            <View style={[styles.orderFooter, { borderTopColor: colors.border + '50' }]}>
                <View style={styles.amountCol}>
                    <Text style={[styles.amountLabel, { color: colors.subtext }]}>{i18n.t('reports.amount')}</Text>
                    <Text style={[styles.amountValue, { color: colors.text }]}>{item.currency_symbol}{item.amount_before.toFixed(2)}</Text>
                </View>
                <View style={styles.amountCol}>
                    <Text style={[styles.amountLabel, { color: colors.subtext }]}>{i18n.t('reports.discount')}</Text>
                    <Text style={[styles.amountValue, { color: colors.danger }]}>{item.currency_symbol}{item.discount.toFixed(2)}</Text>
                </View>
                <View style={styles.amountCol}>
                    <Text style={[styles.amountLabel, { color: colors.subtext }]}>{i18n.t('reports.total')}</Text>
                    <Text style={[styles.amountValue, { color: colors.primary, fontWeight: 'bold' }]}>{item.currency_symbol}{item.amount_after.toFixed(2)}</Text>
                </View>
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
                    <Text style={[styles.headerTitle, { color: colors.text }]}>{i18n.t('reports.sales_report')}</Text>
                </View>
            </View>

            <View style={[styles.filterSection, { backgroundColor: colors.card }]}>
                <View style={styles.dateRow}>
                    <TouchableOpacity 
                        style={[styles.datePicker, { borderColor: colors.border }]} 
                        onPress={() => showDatePicker('from')}
                    >
                        <Text style={[styles.dateLabel, { color: colors.subtext }]}>{i18n.t('reports.from_date')}</Text>
                        <Text style={[styles.dateValue, { color: colors.text }]}>{dayjs(dateFrom).format('YYYY-MM-DD')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[styles.datePicker, { borderColor: colors.border }]} 
                        onPress={() => showDatePicker('to')}
                    >
                        <Text style={[styles.dateLabel, { color: colors.subtext }]}>{i18n.t('reports.to_date')}</Text>
                        <Text style={[styles.dateValue, { color: colors.text }]}>{dayjs(dateTo).format('YYYY-MM-DD')}</Text>
                    </TouchableOpacity>
                </View>
                <TouchableOpacity 
                    style={[styles.fetchButton, { backgroundColor: colors.primary }]} 
                    onPress={fetchReport}
                    disabled={loading}
                >
                    {loading ? <ActivityIndicator color="white" /> : (
                        <>
                            <Ionicons name="search" size={20} color="white" />
                            <Text style={styles.fetchButtonText}>{i18n.t('reports.fetch_report')}</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>

            <FlatList
                data={reportData}
                renderItem={renderOrderItem}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    !loading ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="document-text-outline" size={64} color={colors.subtext} />
                            <Text style={[styles.emptyText, { color: colors.subtext }]}>{i18n.t('reports.no_data')}</Text>
                        </View>
                    ) : null
                }
            />

            {summary && reportData.length > 0 && (
                <View style={[styles.summaryContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                    <Text style={[styles.summaryTitle, { color: colors.text }]}>{i18n.t('reports.summary')}</Text>
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryLabel, { color: colors.subtext }]}>{i18n.t('reports.total_before')}</Text>
                        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.currency_symbol}{summary.total_before.toFixed(2)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryLabel, { color: colors.subtext }]}>{i18n.t('reports.total_discount')}</Text>
                        <Text style={[styles.summaryValue, { color: colors.danger }]}>{summary.currency_symbol}{summary.total_discount.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.summaryRow, styles.totalRow]}>
                        <Text style={[styles.totalLabel, { color: colors.primary }]}>{i18n.t('reports.total_after')}</Text>
                        <Text style={[styles.totalValue, { color: colors.primary }]}>{summary.currency_symbol}{summary.total_after.toFixed(2)}</Text>
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
    filterSection: {
        padding: 15,
        gap: 12,
    },
    dateRow: {
        flexDirection: 'row',
        gap: 10,
    },
    datePicker: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
    },
    dateLabel: {
        fontSize: 10,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    dateValue: {
        fontSize: 14,
        fontWeight: '600',
    },
    fetchButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        borderRadius: 8,
        gap: 8,
    },
    fetchButtonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    listContent: {
        padding: 15,
        paddingBottom: 20,
    },
    orderCard: {
        borderRadius: 12,
        padding: 15,
        marginBottom: 12,
        borderWidth: 1,
    },
    orderHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    orderName: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    orderDate: {
        fontSize: 12,
    },
    customerName: {
        fontSize: 14,
        marginBottom: 12,
    },
    orderFooter: {
        flexDirection: 'row',
        paddingTop: 12,
        borderTopWidth: 1,
    },
    amountCol: {
        flex: 1,
    },
    amountLabel: {
        fontSize: 10,
        marginBottom: 2,
    },
    amountValue: {
        fontSize: 13,
    },
    summaryContainer: {
        padding: 20,
        borderTopWidth: 1,
        gap: 8,
    },
    summaryTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    summaryLabel: {
        fontSize: 14,
    },
    summaryValue: {
        fontSize: 14,
        fontWeight: '500',
    },
    totalRow: {
        marginTop: 4,
        paddingTop: 8,
    },
    totalLabel: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    totalValue: {
        fontSize: 18,
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
