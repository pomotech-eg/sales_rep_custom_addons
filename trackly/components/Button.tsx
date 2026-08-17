import { TouchableOpacity, Text, TouchableOpacityProps, StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '../theme';
import { useThemeStore } from '../store/useThemeStore';

interface ButtonProps extends TouchableOpacityProps {
    title: string;
    variant?: 'primary' | 'secondary' | 'danger' | 'outline';
    size?: 'small' | 'medium' | 'large';
}

export function Button({ title, variant = 'primary', size = 'medium', style, ...props }: ButtonProps) {
    const { colors } = useThemeStore();

    const getColors = () => {
        switch (variant) {
            case 'secondary': return { bg: colors.secondary, text: '#FFF' };
            case 'danger': return { bg: colors.danger, text: '#FFF' };
            case 'outline': return { bg: 'transparent', text: colors.primary, border: colors.primary };
            default: return { bg: colors.primary, text: '#FFF' };
        }
    };

    const componentColors = getColors();

    const getDimensions = () => {
        switch (size) {
            case 'small': return { py: SPACING.s, px: SPACING.m, fontSize: 14 };
            case 'large': return { py: SPACING.l, px: SPACING.xl, fontSize: 18 };
            default: return { py: SPACING.m, px: SPACING.l, fontSize: 16 };
        }
    };

    const dims = getDimensions();

    return (
        <TouchableOpacity
            style={[
                styles.container,
                {
                    backgroundColor: componentColors.bg,
                    borderColor: componentColors.border,
                    borderWidth: variant === 'outline' ? 1 : 0,
                    paddingVertical: dims.py,
                    paddingHorizontal: dims.px
                },
                style
            ]}
            {...props}
        >
            <Text style={[styles.text, { color: componentColors.text, fontSize: dims.fontSize }]}>{title}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: RADIUS.m,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        fontWeight: '600',
    }
});
