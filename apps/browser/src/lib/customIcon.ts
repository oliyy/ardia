const SYMBOL_PREFIX = "symbol:";

export const symbolIcon = (name: string) => SYMBOL_PREFIX + name;

export const iconSymbol = (icon: string | null | undefined): string | null => (icon?.startsWith(SYMBOL_PREFIX) ? icon.slice(SYMBOL_PREFIX.length) : null);

export const ARC_ICON_PREFIX = "arc:";

export const arcIcon = (id: string) => ARC_ICON_PREFIX + id;

export const arcSpaceIcon = (space: { emoji?: string; icon?: string }): string | null => space.emoji || (space.icon ? arcIcon(space.icon) : null);
