export const DARK_COLORS = {
    primary: '#4F46E5', // Indigo 600 (Brand)
    secondary: '#10B981', // Emerald 500 (Income/Success)
    danger: '#EF4444', // Red 500 (Expense/Error)
    warning: '#F59E0B', // Amber 500
    background: '#121212', // Very Dark Gray (Main Background)
    card: '#1E1E1E', // Dark Gray (Card Background) - Tweaked for better contrast
    text: '#FFFFFF', // White (Primary Text)
    textSecondary: '#9CA3AF', // Gray 400 (Secondary Text)
    border: '#374151', // Gray 700 (Borders)
    accent: '#818CF8', // Indigo 400
    success: '#10B981', // Emerald 500
    subtext: '#9CA3AF', // Gray 400
};

export const LIGHT_COLORS = {
    primary: '#4F46E5', // Indigo 600 (Brand)
    secondary: '#10B981', // Emerald 500 (Income/Success)
    danger: '#EF4444', // Red 500 (Expense/Error)
    warning: '#F59E0B', // Amber 500
    background: '#F9FAFB', // Gray 50 (Main Background)
    card: '#FFFFFF', // White (Card Background)
    text: '#111827', // Gray 900 (Primary Text)
    textSecondary: '#6B7280', // Gray 500 (Secondary Text)
    border: '#E5E7EB', // Gray 200 (Borders)
    accent: '#6366F1', // Indigo 500
    success: '#10B981', // Emerald 500
    subtext: '#6B7280', // Gray 500
};

export const SPACING = {
    xs: 4,
    s: 8,
    m: 16,
    l: 24,
    xl: 32,
};

export const RADIUS = {
    s: 8,
    m: 12,
    l: 16,
    xl: 24,
};

export const SHADOW = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
};

export type ThemeColors = typeof DARK_COLORS;
