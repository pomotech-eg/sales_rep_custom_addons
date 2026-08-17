import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { Toast, ToastType, ToastOptions } from '../components/Toast';

interface ToastContextType {
    showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
    hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Create a mutable ref to hold the toast functions
const toastRef = React.createRef<ToastContextType>();

export const showToast = (message: string, type?: ToastType, options?: ToastOptions) => {
    toastRef.current?.showToast(message, type, options);
};

export const hideToast = () => {
    toastRef.current?.hideToast();
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toast, setToast] = useState<{ message: string; type: ToastType; options?: ToastOptions } | null>(null);

    const showToastCallback = (message: string, type: ToastType = 'info', options?: ToastOptions) => {
        setToast({ message, type, options });
    };

    const hideToastCallback = () => {
        setToast(null);
    };

    // Expose functions to the global ref
    useEffect(() => {
        // @ts-ignore - assigning to readonly ref for this specific pattern
        toastRef.current = {
            showToast: showToastCallback,
            hideToast: hideToastCallback
        };
    }, []);

    return (
        <ToastContext.Provider value={{ showToast: showToastCallback, hideToast: hideToastCallback }}>
            {children}
            {toast && (
                <Toast
                    key={Date.now()} // Force re-render on new toast
                    message={toast.message}
                    type={toast.type}
                    options={toast.options}
                    onDismiss={hideToastCallback}
                />
            )}
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

