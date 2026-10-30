const SYMBOL_PREFIX = "symbol:";

export const symbolIcon = (name: string) => SYMBOL_PREFIX + name;

export const iconSymbol = (icon: string | null | undefined): string | null => (icon?.startsWith(SYMBOL_PREFIX) ? icon.slice(SYMBOL_PREFIX.length) : null);

const ARC_PREFIX = "arc:";

export const arcSpaceIcon = (space: { emoji?: string; icon?: string }): string | null => space.emoji || (space.icon ? ARC_PREFIX + space.icon : null);
