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
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import { reportService, CollectionReportData, CollectionReportSummary } from '../../../services/reportService';

export default function CollectionReport() {
    const router = useRouter();
    const { colors } = useThemeStore();
    
    const [dateFrom, setDateFrom] = useState(dayjs().startOf('month').toDate());
    const [dateTo, setDateTo] = useState(new Date());
    const [loading, setLoading] = useState(false);
    const [reportData, setReportData] = useState<CollectionReportData[]>([]);
    const [summary, setSummary] = useState<CollectionReportSummary | null>(null);

    const fetchReport = async () => {
        setLoading(true);
        try {
            const data = await reportService.getCollectionReport(
                dayjs(dateFrom).format('YYYY-MM-DD'),
                dayjs(dateTo).format('YYYY-MM-DD')
            );
            setReportData(data.data);
            setSummary(data.summary);
        } catch (error: any) {
            Alert.alert(i18n.t('common.error') || 'Error', error.message);
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

    const renderItem = ({ item }: { item: CollectionReportData }) => (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
                <Text style={[styles.customerName, { color: colors.text }]}>{item.customer}</Text>
                <Text style={[styles.date, { color: colors.subtext }]}>{item.date}</Text>
            </View>
            <View style={styles.cardBody}>
                <View style={styles.infoRow}>
                    <Ionicons name="person-outline" size={14} color={colors.subtext} />
                    <Text style={[styles.infoText, { color: colors.textSecondary }]}>{item.sales_rep}</Text>
                </View>
                <View style={styles.infoRow}>
                    <Ionicons name="card-outline" size={14} color={colors.subtext} />
                    <Text style={[styles.infoText, { color: colors.textSecondary }]}>{item.payment_method}</Text>
                </View>
            </View>
            <View style={[styles.cardFooter, { borderTopColor: colors.border + '50' }]}>
                <Text style={[styles.amountLabel, { color: colors.subtext }]}>{i18n.t('reports.payment') || 'Payment'}</Text>
                <Text style={[styles.amountValue, { color: colors.primary }]}>
                    {item.currency_symbol}{item.payment.toFixed(2)}
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
                    <Text style={[styles.headerTitle, { color: colors.text }]}>
                        {i18n.t('reports.collection_report') || 'Collection Report'}
                    </Text>
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
                renderItem={renderItem}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    !loading ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="cash-outline" size={64} color={colors.subtext} />
                            <Text style={[styles.emptyText, { color: colors.subtext }]}>{i18n.t('reports.no_data')}</Text>
                        </View>
                    ) : null
                }
            />

            {summary && reportData.length > 0 && (
                <View style={[styles.summaryContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryLabel, { color: colors.text, fontWeight: 'bold' }]}>
                            {i18n.t('reports.total_payment') || 'Total Payment'}
                        </Text>
                        <Text style={[styles.summaryValue, { color: colors.primary, fontWeight: 'bold' }]}>
                            {summary.currency_symbol}{summary.total_payment.toFixed(2)}
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
    card: {
        borderRadius: 12,
        padding: 15,
        marginBottom: 12,
        borderWidth: 1,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    customerName: {
        fontSize: 16,
        fontWeight: 'bold',
        flex: 1,
        marginRight: 10,
    },
    date: {
        fontSize: 12,
    },
    cardBody: {
        marginBottom: 12,
        gap: 4,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    infoText: {
        fontSize: 14,
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 12,
        borderTopWidth: 1,
    },
    amountLabel: {
        fontSize: 12,
        fontWeight: '600',
    },
    amountValue: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    summaryContainer: {
        padding: 20,
        borderTopWidth: 1,
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    summaryLabel: {
        fontSize: 18,
    },
    summaryValue: {
        fontSize: 20,
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
