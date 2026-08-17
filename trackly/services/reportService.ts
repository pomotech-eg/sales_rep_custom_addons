import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';

export interface SalesReportOrder {
    id: number;
    name: string;
    date: string;
    customer: string;
    amount_before: number;
    discount: number;
    amount_after: number;
    currency_symbol: string;
}

export interface SalesReportSummary {
    total_before: number;
    total_discount: number;
    total_after: number;
    currency_symbol: string;
}

export interface SalesReportResponse {
    orders: SalesReportOrder[];
    summary: SalesReportSummary;
    error?: string;
}

export const reportService = {
    getSalesReport: async (dateFrom: string, dateTo: string): Promise<SalesReportResponse> => {
        const { token, serverUrl } = useAuthStore.getState();

        if (!token || !serverUrl) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await axios.post(`${serverUrl}/api/mobile/report/sales`, {
                params: {
                    date_from: dateFrom,
                    date_to: dateTo
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.data.success) {
                throw new Error(response.data.message || 'Server Error');
            }
            
            return response.data;
        } catch (error: any) {
            console.error('Report Service Error:', error);
            throw error;
        }
    },
    getCustomerDebtReport: async (): Promise<any> => {
        const { token, serverUrl } = useAuthStore.getState();

        if (!token || !serverUrl) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await axios.post(`${serverUrl}/api/mobile/report/debt`, {}, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.data.success) {
                throw new Error(response.data.message || 'Server Error');
            }
            
            return response.data;
        } catch (error: any) {
            console.error('Debt Report Service Error:', error);
            throw error;
        }
    },
    getCollectionReport: async (dateFrom: string, dateTo: string): Promise<CollectionReportResponse> => {
        const { token, serverUrl } = useAuthStore.getState();

        if (!token || !serverUrl) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await axios.post(`${serverUrl}/api/mobile/report/collection`, {
                params: {
                    date_from: dateFrom,
                    date_to: dateTo
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.data.success) {
                throw new Error(response.data.message || 'Server Error');
            }
            
            return response.data;
        } catch (error: any) {
            console.error('Collection Report Service Error:', error);
            throw error;
        }
    },
    getJournalTransactionReport: async (dateFrom: string, dateTo: string): Promise<JournalTransactionReportResponse> => {
        const { token, serverUrl } = useAuthStore.getState();

        if (!token || !serverUrl) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await axios.post(`${serverUrl}/api/mobile/report/journal_transaction`, {
                params: {
                    date_from: dateFrom,
                    date_to: dateTo
                }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.data.success) {
                throw new Error(response.data.message || 'Server Error');
            }
            
            return response.data;
        } catch (error: any) {
            console.error('Journal Transaction Report Service Error:', error);
            throw error;
        }
    }
};

export interface JournalTransactionData {
    id: number;
    name: string;
    date: string;
    ref: string;
    partner: string;
    amount: number;
    type: 'inbound' | 'outbound';
    journal: string;
    currency_symbol: string;
}

export interface JournalTransactionSummary {
    total_inbound: number;
    total_outbound: number;
    net_balance: number;
    currency_symbol: string;
}

export interface JournalTransactionReportResponse {
    success: boolean;
    data: JournalTransactionData[];
    summary: JournalTransactionSummary;
    message?: string;
}

export interface CollectionReportData {
    id: number;
    date: string;
    sales_rep: string;
    customer: string;
    payment: number;
    payment_method: string;
    currency_symbol: string;
}

export interface CollectionReportSummary {
    total_payment: number;
    currency_symbol: string;
}

export interface CollectionReportResponse {
    success: boolean;
    data: CollectionReportData[];
    summary: CollectionReportSummary;
    message?: string;
}
