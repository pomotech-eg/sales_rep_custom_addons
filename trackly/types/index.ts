export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Account {
    id: number;
    name: string;
    type: string; // 'Cash', 'Bank', 'Credit', 'Wallet'
    starting_balance: number;
    include_in_dashboard: number; // 1 or 0 (SQLite boolean)
    include_in_total: number; // 1 or 0
    // Computed
    balance?: number;
}

export interface Category {
    id: number;
    name: string;
    type: TransactionType;
    budget_limit?: number;
}

export interface Transaction {
    id: number;
    amount: number;
    type: TransactionType;
    category_id: number | null;
    account_id: number | null; // For income/expense, or "From" for transfer
    to_account_id?: number | null; // For transfer
    task_id?: number | null; // Linked task
    from_task_id?: number | null; // Source Task
    date: string; // ISO Date string
    note?: string;
    created_at: string;
}

export type TaskType = 'expense' | 'purchase' | 'saving';
export type TaskStatus = 'pending' | 'active' | 'completed';

export interface FinancialTask {
    id: number;
    title: string;
    type: TaskType;
    total_amount: number;
    paid_amount: number;
    due_date?: string;
    is_recurring: number; // 1 or 0
    recurrence_type?: string;
    status: TaskStatus;
    created_at: string;
}

export interface ShoppingList {
    id: number;
    name: string;
    icon?: string;
    color?: string;
    created_at: string;
    // Computed
    total_price?: number;
    items?: ShoppingItem[];
}

export interface ShoppingItem {
    id: number;
    text: string;
    completed: number; // 0 or 1
    list_id?: number | null;
    price: number;
    created_at: string;
}

export interface PlannedPayment {
    id: number;
    name: string;
    amount: number;
    currency: string;
    type: TransactionType;
    category_id: number | null;
    account_id: number | null;
    frequency: string; // 'Monthly', 'Weekly', 'One time', etc.
    start_date: string;
    next_payment_date: string;
    notification_enabled: number; // 1 or 0
    note?: string;
    created_at: string;
}
