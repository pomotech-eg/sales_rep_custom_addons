import { View, ViewProps } from 'react-native';
import { RADIUS, SPACING } from '../theme';
import { useThemeStore } from '../store/useThemeStore';

export function Card({ style, ...props }: ViewProps) {
    const { colors } = useThemeStore();
    return (
        <View style={[{
            backgroundColor: colors.card,
            borderRadius: RADIUS.l,
            padding: SPACING.m,
            borderWidth: 1,
            borderColor: colors.border,
            // ...SHADOW // often less visible in dark mode, border is better
        }, style]} {...props} />
    );
}
